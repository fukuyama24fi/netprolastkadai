import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useCanvasSocket } from "./services/UseCanvasSocket";
import "./App.css";

const TYPE_LABELS = {
  rect: "四角形",
  circle: "円",
  triangle: "三角形",
  text: "テキスト",
};

const App = () => {
  const {
    shapes,
    history,
    userName,
    setUserName,
    addShape,
    updateRect,
    deleteRect,
    clearCanvas,
    undo,
    redo,
    jumpToHistory,
    exportedHtml,
    exportCode,
  } = useCanvasSocket();

  const [viewShapes, setViewShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [interaction, setInteraction] = useState(null);

  // テキスト編集用
  const [editingId, setEditingId] = useState(null);
  const [draftText, setDraftText] = useState("");

  // ファイル保存用
  const [fileName, setFileName] = useState("pikva-canvas");

  const canvasRef = useRef(null);
  const mainRef = useRef(null);
  const historyEndRef = useRef(null);

  const viewShapesRef = useRef([]);
  const interactionRef = useRef(null);

  const didMoveRef = useRef(false);
  const cancelTextEditRef = useRef(false);

  /*
   * interactionの最新値をRefにも保存する。
   * shapes更新時にドラッグ中かどうかを安全に判断するため。
   */
  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  /*
   * サーバーから受け取った図形を画面へ反映する。
   * ドラッグ・リサイズ・回転中は操作中の表示を優先する。
   */
  useEffect(() => {
    if (interactionRef.current) {
      return;
    }

    setViewShapes(shapes);
    viewShapesRef.current = shapes;
  }, [shapes]);

  /*
   * 履歴が更新されたら一番下まで移動する。
   */
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [history]);

  /*
   * サーバーからHTMLが返ってきたらダウンロードする。
   */
  useEffect(() => {
    if (!exportedHtml) {
      return;
    }

    const blob = new Blob([exportedHtml], {
      type: "text/html",
    });

    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `${
      fileName.trim() || "pikva-export"
    }.html`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadUrl);
  }, [exportedHtml, fileName]);

  const selectedShape = viewShapes.find((shape) => {
    return shape.id === selectedId;
  });

  const isSelectedText =
    selectedShape?.type === "text";

  /*
   * 図形が右・下へ移動したらキャンバスを広げる。
   */
  const canvasWidth = Math.max(
    2000,
    ...viewShapes.map((shape) => {
      return shape.x + shape.width + 400;
    })
  );

  const canvasHeight = Math.max(
    1400,
    ...viewShapes.map((shape) => {
      return shape.y + shape.height + 400;
    })
  );

  /*
   * JSONファイル保存
   */
  const handleSaveFile = useCallback(() => {
    const saveData = {
      version: 1,
      fileName:
        fileName.trim() || "pikva-canvas",
      savedAt: new Date().toISOString(),
      objects: viewShapes,
    };

    const json = JSON.stringify(
      saveData,
      null,
      2
    );

    const blob = new Blob([json], {
      type: "application/json",
    });

    const downloadUrl =
      URL.createObjectURL(blob);

    const link =
      document.createElement("a");

    link.href = downloadUrl;
    link.download = `${
      fileName.trim() || "pikva-canvas"
    }.json`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadUrl);
  }, [fileName, viewShapes]);

  /*
   * サーバーを待たず、画面側だけ先に変更する。
   */
  const updateShapeLocal = useCallback(
    (id, changes) => {
      setViewShapes((prev) => {
        const next = prev.map((shape) => {
          if (shape.id !== id) {
            return shape;
          }

          return {
            ...shape,
            ...changes,
          };
        });

        viewShapesRef.current = next;

        return next;
      });
    },
    []
  );

  /*
   * 選択中図形を画面とサーバーの両方で変更する。
   */
  const updateSelectedShape = useCallback(
    (changes) => {
      if (!selectedId) {
        return;
      }

      updateShapeLocal(
        selectedId,
        changes
      );

      updateRect(
        selectedId,
        changes
      );
    },
    [
      selectedId,
      updateShapeLocal,
      updateRect,
    ]
  );

  
  //図形の優先
 const moveSelectedLayer = useCallback(
  (direction) => {
    if (!selectedId) {
      return;
    }

    const currentShapes =
      viewShapesRef.current;

    /*
     * zIndexがまだない古い図形は、
     * 現在の配列順を仮のzIndexとして使う
     */
    const orderedShapes = currentShapes
      .map((shape, index) => {
        const parsedZIndex =
          Number(shape.zIndex);

        return {
          ...shape,

          calculatedZIndex:
            Number.isFinite(parsedZIndex)
              ? parsedZIndex
              : index,
        };
      })
      .sort((shapeA, shapeB) => {
        return (
          shapeA.calculatedZIndex -
          shapeB.calculatedZIndex
        );
      });

    const currentIndex =
      orderedShapes.findIndex(
        (shape) =>
          shape.id === selectedId
      );

    if (currentIndex === -1) {
      return;
    }

    /*
     * 前へ：配列の次
     * 後ろへ：配列の前
     */
    const targetIndex =
      direction === "forward"
        ? currentIndex + 1
        : currentIndex - 1;

    /*
     * すでに最前面・最背面なら何もしない
     */
    if (
      targetIndex < 0 ||
      targetIndex >=
        orderedShapes.length
    ) {
      return;
    }

    const selectedShapeForLayer =
      orderedShapes[currentIndex];

    const targetShape =
      orderedShapes[targetIndex];

    /*
     * 選択中図形と隣の図形の
     * zIndexを交換する
     */
    const selectedNewZIndex =
      targetShape.calculatedZIndex;

    const targetNewZIndex =
      selectedShapeForLayer
        .calculatedZIndex;

    const nextShapes =
      currentShapes.map((shape) => {
        if (
          shape.id ===
          selectedShapeForLayer.id
        ) {
          return {
            ...shape,
            zIndex:
              selectedNewZIndex,
          };
        }

        if (
          shape.id === targetShape.id
        ) {
          return {
            ...shape,
            zIndex: targetNewZIndex,
          };
        }

        return shape;
      });

    /*
     * 画面側を先に更新
     */
    setViewShapes(nextShapes);
    viewShapesRef.current =
      nextShapes;

    /*
     * サーバー側も2つとも更新
     */
    updateRect(
      selectedShapeForLayer.id,
      {
        zIndex:
          selectedNewZIndex,
      }
    );

    updateRect(targetShape.id, {
      zIndex: targetNewZIndex,
    });
  },
  [selectedId, updateRect]
  );

const bringForward = useCallback(() => {
  moveSelectedLayer("forward");
}, [moveSelectedLayer]);

const sendBackward = useCallback(() => {
  moveSelectedLayer("backward");
}, [moveSelectedLayer]);
  /*
   * ドラッグ・リサイズ時の画面端スクロール。
   */
  const autoScrollMain = useCallback(
    (event) => {
      const main = mainRef.current;

      if (!main) {
        return;
      }

      const rect =
        main.getBoundingClientRect();

      const edgeSize = 80;
      const scrollSpeed = 24;

      if (
        event.clientX >
        rect.right - edgeSize
      ) {
        main.scrollLeft += scrollSpeed;
      }

      if (
        event.clientX <
        rect.left + edgeSize
      ) {
        main.scrollLeft -= scrollSpeed;
      }

      if (
        event.clientY >
        rect.bottom - edgeSize
      ) {
        main.scrollTop += scrollSpeed;
      }

      if (
        event.clientY <
        rect.top + edgeSize
      ) {
        main.scrollTop -= scrollSpeed;
      }
    },
    []
  );

  const handleAddShape = useCallback(
    (type) => {
      addShape(type);
    },
    [addShape]
  );

  const handleClearCanvas = useCallback(() => {
    clearCanvas();

    setSelectedId(null);
    setEditingId(null);
    setInteraction(null);
  }, [clearCanvas]);

  /*
   * 選択中図形の削除
   */
  const handleDeleteSelected =
    useCallback(() => {
      if (!selectedId) {
        return;
      }

      const targetId = selectedId;

      setViewShapes((prev) => {
        const next = prev.filter(
          (shape) => {
            return shape.id !== targetId;
          }
        );

        viewShapesRef.current = next;

        return next;
      });

      setSelectedId(null);
      setEditingId(null);
      setInteraction(null);

      deleteRect(targetId);
    }, [selectedId, deleteRect]);

  /*
   * Delete・Backspaceキーで削除
   */
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key !== "Delete" &&
        event.key !== "Backspace"
      ) {
        return;
      }

      const tagName =
        document.activeElement?.tagName;

      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA"
      ) {
        return;
      }

      if (!selectedId) {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    window.addEventListener(
      "keydown",
      handleKeyDown
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
    };
  }, [
    selectedId,
    handleDeleteSelected,
  ]);

  /*
   * 色変更
   */
  const handleColorChange = useCallback(
    (event) => {
      if (!selectedId) {
        return;
      }

      const fill = event.target.value;

      updateSelectedShape({
        fill,
      });
    },
    [
      selectedId,
      updateSelectedShape,
    ]
  );

  /*
   * テキスト編集開始
   */
  const startTextEditing = useCallback(
    (event, shape) => {
      event.stopPropagation();

      if (shape.type !== "text") {
        return;
      }

      cancelTextEditRef.current = false;

      setSelectedId(shape.id);
      setInteraction(null);
      setDraftText(shape.text || "");
      setEditingId(shape.id);
    },
    []
  );

  /*
   * テキスト編集終了・保存
   */
  const finishTextEditing = useCallback(
    (shapeId) => {
      if (
        cancelTextEditRef.current
      ) {
        cancelTextEditRef.current =
          false;

        setEditingId(null);
        return;
      }

      updateShapeLocal(shapeId, {
        text: draftText,
      });

      updateRect(shapeId, {
        text: draftText,
      });

      setEditingId(null);
    },
    [
      draftText,
      updateShapeLocal,
      updateRect,
    ]
  );

  /*
   * テキスト編集中のキー
   *
   * Enter: 保存
   * Shift + Enter: 改行
   * Escape: キャンセル
   */
  const handleTextKeyDown = useCallback(
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        cancelTextEditRef.current =
          true;

        event.currentTarget.blur();
      }
    },
    []
  );

  const handleUndo = useCallback(() => {
    setSelectedId(null);
    setEditingId(null);
    undo();
  }, [undo]);

  const handleRedo = useCallback(() => {
    setSelectedId(null);
    setEditingId(null);
    redo();
  }, [redo]);

  /*
   * 履歴ジャンプ
   */
  const handleHistoryClick =
    useCallback(
      (historyItem) => {
        if (interaction) {
          console.warn(
            "操作中は履歴ジャンプできません"
          );
          return;
        }

        setSelectedId(null);
        setEditingId(null);

        jumpToHistory(historyItem.id);
      },
      [
        interaction,
        jumpToHistory,
      ]
    );

  /*
   * 図形移動開始
   */
  const startDrag = useCallback(
    (event, shape) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      setSelectedId(shape.id);
      setEditingId(null);

      didMoveRef.current = false;

      const canvasRect =
        canvas.getBoundingClientRect();

      /*
       * 回転後の図形でも移動開始時に
       * 大きくずれないよう、shape.x/yを基準にする。
       */
      setInteraction({
        mode: "drag",
        id: shape.id,

        offsetX:
          event.clientX -
          canvasRect.left -
          shape.x,

        offsetY:
          event.clientY -
          canvasRect.top -
          shape.y,
      });

      event.preventDefault();
    },
    []
  );

  /*
   * リサイズ開始
   */
  const startResize = useCallback(
    (event, shape) => {
      event.stopPropagation();
      event.preventDefault();

      setSelectedId(shape.id);
      setEditingId(null);

      didMoveRef.current = false;

      setInteraction({
        mode: "resize",
        id: shape.id,

        startX: event.clientX,
        startY: event.clientY,

        startWidth: shape.width,
        startHeight: shape.height,
      });
    },
    []
  );

  /*
   * 回転開始
   */
  const startRotate = useCallback(
    (event, shape) => {
      event.stopPropagation();
      event.preventDefault();

      const shapeElement =
        event.currentTarget.closest(
          ".shape"
        );

      if (!shapeElement) {
        return;
      }

      const shapeRect =
        shapeElement.getBoundingClientRect();

      const centerX =
        shapeRect.left +
        shapeRect.width / 2;

      const centerY =
        shapeRect.top +
        shapeRect.height / 2;

      const startPointerAngle =
        Math.atan2(
          event.clientY - centerY,
          event.clientX - centerX
        ) *
        (180 / Math.PI);

      didMoveRef.current = false;

      setSelectedId(shape.id);
      setEditingId(null);

      setInteraction({
        mode: "rotate",
        id: shape.id,

        centerX,
        centerY,

        startPointerAngle,

        startRotation:
          shape.rotation || 0,
      });
    },
    []
  );

  /*
   * 文字サイズ変更
   */
  const handleFontSizeChange =
    useCallback(
      (event) => {
        const fontSize = Number(
          event.target.value
        );

        if (
          !Number.isFinite(fontSize)
        ) {
          return;
        }

        updateSelectedShape({
          fontSize: Math.max(
            8,
            Math.min(200, fontSize)
          ),
        });
      },
      [updateSelectedShape]
    );

  /*
   * 太字
   */
  const toggleBold = useCallback(() => {
    if (!isSelectedText) {
      return;
    }

    updateSelectedShape({
      fontWeight:
        selectedShape?.fontWeight ===
        "bold"
          ? "normal"
          : "bold",
    });
  }, [
    isSelectedText,
    selectedShape,
    updateSelectedShape,
  ]);

  /*
   * 斜体
   */
  const toggleItalic = useCallback(() => {
    if (!isSelectedText) {
      return;
    }

    updateSelectedShape({
      fontStyle:
        selectedShape?.fontStyle ===
        "italic"
          ? "normal"
          : "italic",
    });
  }, [
    isSelectedText,
    selectedShape,
    updateSelectedShape,
  ]);

  /*
   * 大文字表示
   */
  const toggleUppercase =
    useCallback(() => {
      if (!isSelectedText) {
        return;
      }

      updateSelectedShape({
        textTransform:
          selectedShape
            ?.textTransform ===
          "uppercase"
            ? "none"
            : "uppercase",
      });
    }, [
      isSelectedText,
      selectedShape,
      updateSelectedShape,
    ]);

  /*
   * 回転スライダーの値をサーバーへ確定保存する。
   */
  const saveSelectedRotation =
    useCallback(() => {
      if (!selectedId) {
        return;
      }

      const targetShape =
        viewShapesRef.current.find(
          (shape) => {
            return (
              shape.id === selectedId
            );
          }
        );

      if (!targetShape) {
        return;
      }

      updateRect(targetShape.id, {
        rotation:
          targetShape.rotation || 0,
      });
    }, [selectedId, updateRect]);

  /*
   * 移動・リサイズ・回転中のマウス操作
   */
  useEffect(() => {
    if (!interaction) {
      return;
    }

    const handleMouseMove = (event) => {
      const canvas =
        canvasRef.current;

      if (!canvas) {
        return;
      }

      didMoveRef.current = true;

      /*
       * 回転中に自動スクロールすると、
       * 回転中心がずれやすいため除外する。
       */
      if (
        interaction.mode !== "rotate"
      ) {
        autoScrollMain(event);
      }

      const canvasRect =
        canvas.getBoundingClientRect();

      /*
       * 移動
       */
      if (
        interaction.mode === "drag"
      ) {
        const newX =
          event.clientX -
          canvasRect.left -
          interaction.offsetX;

        const newY =
          event.clientY -
          canvasRect.top -
          interaction.offsetY;

        updateShapeLocal(
          interaction.id,
          {
            x: newX,
            y: newY,
          }
        );
      }

      /*
       * リサイズ
       */
      if (
        interaction.mode === "resize"
      ) {
        const diffX =
          event.clientX -
          interaction.startX;

        const diffY =
          event.clientY -
          interaction.startY;

        const newWidth = Math.max(
          30,
          interaction.startWidth +
            diffX
        );

        const newHeight = Math.max(
          30,
          interaction.startHeight +
            diffY
        );

        updateShapeLocal(
          interaction.id,
          {
            width: newWidth,
            height: newHeight,
          }
        );
      }

      /*
       * 回転
       */
      if (
        interaction.mode === "rotate"
      ) {
        const currentPointerAngle =
          Math.atan2(
            event.clientY -
              interaction.centerY,

            event.clientX -
              interaction.centerX
          ) *
          (180 / Math.PI);

        const angleDifference =
          currentPointerAngle -
          interaction.startPointerAngle;

        let newRotation =
          interaction.startRotation +
          angleDifference;

        /*
         * Shiftキーを押している間は
         * 15度単位で回転する。
         */
        if (event.shiftKey) {
          newRotation =
            Math.round(
              newRotation / 15
            ) * 15;
        }

        /*
         * 0〜359度に直す。
         */
        newRotation =
          ((newRotation % 360) +
            360) %
          360;

        updateShapeLocal(
          interaction.id,
          {
            rotation:
              Math.round(
                newRotation
              ),
          }
        );
      }
    };

    const handleMouseUp = () => {
      if (!didMoveRef.current) {
        setInteraction(null);
        return;
      }

      const targetShape =
        viewShapesRef.current.find(
          (shape) => {
            return (
              shape.id ===
              interaction.id
            );
          }
        );

      if (!targetShape) {
        setInteraction(null);
        return;
      }

      if (
        interaction.mode === "drag"
      ) {
        updateRect(targetShape.id, {
          x: targetShape.x,
          y: targetShape.y,
        });
      }

      if (
        interaction.mode === "resize"
      ) {
        updateRect(targetShape.id, {
          width: targetShape.width,
          height: targetShape.height,
        });
      }

      if (
        interaction.mode === "rotate"
      ) {
        updateRect(targetShape.id, {
          rotation:
            targetShape.rotation ||
            0,
        });
      }

      setInteraction(null);
    };

    window.addEventListener(
      "mousemove",
      handleMouseMove
    );

    window.addEventListener(
      "mouseup",
      handleMouseUp
    );

    return () => {
      window.removeEventListener(
        "mousemove",
        handleMouseMove
      );

      window.removeEventListener(
        "mouseup",
        handleMouseUp
      );
    };
  }, [
    interaction,
    updateShapeLocal,
    updateRect,
    autoScrollMain,
  ]);

  /*
   * 履歴の図形名を日本語へ変換する。
   *
   * 現在のサーバーはchangesではなく
   * before・afterを返す構造。
   */
  const formatObjectLabel = (
    historyItem
  ) => {
    const type =
      historyItem.after?.type ||
      historyItem.before?.type;

    if (type) {
      return TYPE_LABELS[type] || type;
    }

    return historyItem.objectId
      ? historyItem.objectId.slice(
          0,
          8
        )
      : "";
  };

  return (
    <div className="app">
      <header className="app-header">
        <strong className="app-header-title" >
          <img src="/picture/2aikon.png"></img>
          Pikva
        </strong>

        <input
          type="text"
          className="file-name-input"
          value={fileName}
          onChange={(event) => {
            setFileName(
              event.target.value
            );
          }}
          placeholder="ファイル名"
        />

        <button
          type="button"
          onClick={handleClearCanvas}
        >
          新規
        </button>

        <button
          type="button"
          onClick={handleSaveFile}
        >
          保存
        </button>

        <button type="button">
          開く
        </button>

        <button type="button">
          PNG出力
        </button>

        <button
          type="button"
          onClick={exportCode}
        >
          HTML出力
        </button>

        <button
          type="button"
          onClick={exportCode}
        >
          CSS出力
        </button>
      </header>

      <div className="app-body">
        <aside className="tool">
          <h1>TOOL</h1>

          <div className="history-buttons">
            <button
              type="button"
              className="icon-button"
              onClick={handleUndo}
              title="Undo"
            >
              ↶
            </button>

            <button
              type="button"
              className="icon-button"
              onClick={handleRedo}
              title="Redo"
            >
              ↷
            </button>
          </div>

          <div className="shape-buttons">
            <button
              type="button"
              onClick={() =>
                handleAddShape("rect")
              }
            >
              四角形を追加
            </button>

            <button
              type="button"
              onClick={() =>
                handleAddShape(
                  "circle"
                )
              }
            >
              円を追加
            </button>

            <button
              type="button"
              onClick={() =>
                handleAddShape(
                  "triangle"
                )
              }
            >
              三角形を追加
            </button>

            <button
              type="button"
              onClick={() =>
                handleAddShape("text")
              }
            >
              テキストを追加
            </button>
          </div>

          {selectedShape ? (
            <label className="rotation-tool">
              回転

              <input
                type="range"
                min="0"
                max="359"
                value={Math.round(
                  selectedShape.rotation ||
                    0
                )}
                onChange={(event) => {
                  if (!selectedId) {
                    return;
                  }

                  updateShapeLocal(
                    selectedId,
                    {
                      rotation: Number(
                        event.target.value
                      ),
                    }
                  );
                }}
                onPointerUp={
                  saveSelectedRotation
                }
                onBlur={
                  saveSelectedRotation
                }
              />

              <span>
                {Math.round(
                  selectedShape.rotation ||
                    0
                )}
                °
              </span>
            </label>
          ) : null}

         {selectedShape ? (
  <div className="layer-tools">
    <span>重なり順</span>

    <div className="layer-buttons">
      <button
        type="button"
        onClick={sendBackward}
        title="選択中の図形を1つ後ろへ移動"
      >
        ↓ 後ろへ
      </button>

      <button
        type="button"
        onClick={bringForward}
        title="選択中の図形を1つ前へ移動"
      >
        ↑ 前へ
      </button>
    </div>
  </div>
) : null}

          <label className="color-tool">
            色

            <input
              type="color"
              value={
                selectedShape?.fill ||
                "#4f8cff"
              }
              onChange={
                handleColorChange
              }
            />
          </label>

          {isSelectedText ? (
            <div className="text-format-tools">
              <label>
                文字サイズ

                <input
                  type="number"
                  min="8"
                  max="200"
                  value={
                    selectedShape
                      ?.fontSize || 24
                  }
                  onChange={
                    handleFontSizeChange
                  }
                />
              </label>

              <div className="text-format-buttons">
                <button
                  type="button"
                  className={
                    selectedShape
                      ?.fontWeight ===
                    "bold"
                      ? "active"
                      : ""
                  }
                  onClick={toggleBold}
                  title="太字"
                >
                  B
                </button>

                <button
                  type="button"
                  className={
                    selectedShape
                      ?.fontStyle ===
                    "italic"
                      ? "active"
                      : ""
                  }
                  onClick={toggleItalic}
                  title="斜体"
                >
                  <i>I</i>
                </button>

                <button
                  type="button"
                  className={
                    selectedShape
                      ?.textTransform ===
                    "uppercase"
                      ? "active"
                      : ""
                  }
                  onClick={
                    toggleUppercase
                  }
                  title="大文字表示"
                >
                  AA
                </button>
              </div>
            </div>
          ) : null}

          <button
            type="button"
            className="delete-button-main"
            onClick={
              handleDeleteSelected
            }
            disabled={!selectedId}
          >
            選択中を削除
          </button>

          <button
            type="button"
            onClick={handleClearCanvas}
          >
            全て消去
          </button>
        </aside>

        <main
          ref={mainRef}
          className="main"
        >
          <div
            ref={canvasRef}
            className="canvas"
            style={{
              width: `${canvasWidth}px`,
              height: `${canvasHeight}px`,
            }}
            onMouseDown={(event) => {
              /*
               * 図形以外のキャンバスを押したら
               * 選択を解除する。
               */
              if (
                event.target ===
                event.currentTarget
              ) {
                setSelectedId(null);
                setEditingId(null);
              }
            }}
          >
            {viewShapes.map((shape,shapeIndex) => {
              const isSelected =
                shape.id === selectedId;

              const shapeType =
                shape.type || "rect";

              const isText =
                shapeType === "text";

              const isEditing =
                editingId === shape.id;

              return (
                <div
                  key={shape.id}
                  className={[
                    "shape",
                    shapeType,
                    isSelected
                      ? "selected"
                      : "",
                    isEditing
                      ? "editing"
                      : "",
                  ].join(" ")}
                  onMouseDown={(
                    event
                  ) => {
                    if (isEditing) {
                      event.stopPropagation();
                      return;
                    }

                    startDrag(
                      event,
                      shape
                    );
                  }}
                  onDoubleClick={(
                    event
                  ) => {
                    startTextEditing(
                      event,
                      shape
                    );
                  }}
                  style={{
                    left: `${shape.x}px`,
                    top: `${shape.y}px`,
                    width: `${shape.width}px`,
                    height: `${shape.height}px`,

                    transform: `rotate(${
                      shape.rotation || 0
                    }deg)`,

                    transformOrigin:
                      "center center",

                      zIndex: Number.isFinite(Number(shape.zIndex))
                      ? Number(shape.zIndex)
                      : shapeIndex,
                  }}
                >
                  <div
                    className="shape-body"
                    style={{
                      backgroundColor:
                        isText
                          ? "transparent"
                          : shape.fill,

                      color: isText
                        ? shape.fill
                        : undefined,

                      fontSize: isText
                        ? `${
                            shape.fontSize ||
                            24
                          }px`
                        : undefined,

                      fontWeight: isText
                        ? shape.fontWeight ||
                          "normal"
                        : undefined,

                      fontStyle: isText
                        ? shape.fontStyle ||
                          "normal"
                        : undefined,

                      textTransform: isText
                        ? shape.textTransform ||
                          "none"
                        : undefined,
                    }}
                  >
                    {isText &&
                    isEditing ? (
                      <textarea
                        autoFocus
                        className="text-editor"
                        value={draftText}
                        onChange={(
                          event
                        ) => {
                          setDraftText(
                            event.target
                              .value
                          );
                        }}
                        onBlur={() => {
                          finishTextEditing(
                            shape.id
                          );
                        }}
                        onKeyDown={
                          handleTextKeyDown
                        }
                        onMouseDown={(
                          event
                        ) => {
                          event.stopPropagation();
                        }}
                        onDoubleClick={(
                          event
                        ) => {
                          event.stopPropagation();
                        }}
                      />
                    ) : null}

                    {isText &&
                    !isEditing ? (
                      <span className="text-value">
                        {shape.text ||
                          "テキスト"}
                      </span>
                    ) : null}
                  </div>

                  {!isEditing ? (
                    <>
                      <div
                        className="resize-handle"
                        onMouseDown={(
                          event
                        ) => {
                          startResize(
                            event,
                            shape
                          );
                        }}
                      />

                      {isSelected ? (
                        <div
                          className="rotate-handle"
                          title="ドラッグして回転"
                          onMouseDown={(
                            event
                          ) => {
                            startRotate(
                              event,
                              shape
                            );
                          }}
                        />
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </main>

        <section className="history-section">
          <h2>編集履歴</h2>

          <div className="user-settings">
            表示名：

            <input
              defaultValue={userName}
              onBlur={(event) => {
                setUserName(
                  event.target.value
                );
              }}
            />
          </div>

          <ul className="history-list">
            {history.map(
              (historyItem) => (
                <li
                  key={
                    historyItem.id ||
                    `${
                      historyItem.createdAt
                    }-${
                      historyItem.action
                    }`
                  }
                  onClick={() => {
                    handleHistoryClick(
                      historyItem
                    );
                  }}
                  style={{
                    cursor: interaction
                      ? "not-allowed"
                      : "pointer",

                    opacity: interaction
                      ? 0.5
                      : 1,
                  }}
                  title={
                    interaction
                      ? "操作中は履歴ジャンプできません"
                      : "クリックしてこの時点へ移動"
                  }
                >
                  {historyItem.createdAt
                    ? new Date(
                        historyItem.createdAt
                      ).toLocaleTimeString()
                    : "--:--:--"}

                  {" - "}

                  {historyItem.action}

                  {historyItem.objectId &&
                    `（${formatObjectLabel(
                      historyItem
                    )}）`}

                  {" by "}

                  {historyItem.userName ||
                    historyItem.userId?.slice(
                      0,
                      8
                    ) ||
                    "不明"}
                </li>
              )
            )}

            <li
              ref={historyEndRef}
              className="history-end"
            />
          </ul>
        </section>
      </div>
    </div>
  );
};

export default App;