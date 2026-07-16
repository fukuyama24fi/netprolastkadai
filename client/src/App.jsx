import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useCanvasSocket } from "./services/UseCanvasSocket";
import {
  useCanvasCalculations,
  useCanvasState,
  useFileOperations,
  useInteractionHandlers,
} from "./hooks";
import { generateFrontendCss, generateFrontendHtml } from "./utils/htmlGenerator";
import "./App.css";

// ========== 定数 ==========

const TYPE_LABELS = {
  rect: "四角形",
  circle: "円",
  triangle: "三角形",
  text: "テキスト",
};

const SNAP_THRESHOLD = 6;
const EMPTY_SMART_GUIDES = { vertical: [], horizontal: [] };
const DEFAULT_CANVAS_WIDTH = 2000;
const DEFAULT_CANVAS_HEIGHT = 1400;
const CANVAS_PADDING = 400;
const MIN_SHAPE_SIZE = 30;
const MAX_FONT_SIZE = 200;
const MIN_FONT_SIZE = 8;
const ROTATION_SNAP_ANGLE = 15;
const AUTO_SCROLL_EDGE_SIZE = 80;
const AUTO_SCROLL_SPEED = 24;

// ========== コンポーネント ==========

const App = () => {
  // ========== Hooks から取得 ==========
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

  const { calculateSmartGuides, calculateLayerReorder } =
    useCanvasCalculations();
  const { updateShapeLocal, getSelectedShape, calculateCanvasSize, clearSelectionState, resetTextEditingState } =
    useCanvasState();
  const { handleSaveJsonFile, handleShowHtmlCode, handleShowCssCode, handleCopyCode } =
    useFileOperations();
  const { startDrag, startResize, startRotate, startTextEditing } =
    useInteractionHandlers();

  // ========== State ==========
  const [viewShapes, setViewShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [interaction, setInteraction] = useState(null);
  const [smartGuides, setSmartGuides] = useState(EMPTY_SMART_GUIDES);
  const [editingId, setEditingId] = useState(null);
  const [draftText, setDraftText] = useState("");
  const [fileName, setFileName] = useState("pikva-canvas");
  const [codeOutput, setCodeOutput] = useState({
    type: "",
    content: "",
  });

  // ========== Refs ==========
  const canvasRef = useRef(null);
  const mainRef = useRef(null);
  const historyEndRef = useRef(null);
  const viewShapesRef = useRef([]);
  const interactionRef = useRef(null);
  const didMoveRef = useRef(false);
  const cancelTextEditRef = useRef(false);

  // ========== Effects ==========

  // interaction参照を最新に保つ
   
  useEffect(() => {
    interactionRef.current = interaction;
  }, [interaction]);

  // サーバーから受け取った図形を画面へ反映
   
  useEffect(() => {
    if (interactionRef.current) {
      return;
    }

    setViewShapes(shapes);
    viewShapesRef.current = shapes;
  }, [shapes]);

  // 履歴が更新されたら一番下まで移動
   
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [history]);

  /**
   * サーバーからHTMLが返ってきたらダウンロード
   */
  useEffect(() => {
    if (!exportedHtml) {
      return;
    }

    const blob = new Blob([exportedHtml], { type: "text/html" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = downloadUrl;
    link.download = `${fileName.trim() || "pikva-export"}.html`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(downloadUrl);
  }, [exportedHtml, fileName]);

  // Delete・Backspaceキーで削除
   
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.key !== "Delete" &&
        event.key !== "Backspace"
      ) {
        return;
      }

      const tagName = document.activeElement?.tagName;

      if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return;
      }

      if (!selectedId) {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedId]);

  // 移動・リサイズ・回転中のマウス操作
   
  useEffect(() => {
    if (!interaction) {
      return;
    }

    const handleMouseMove = (event) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

      didMoveRef.current = true;

      if (interaction.mode !== "rotate") {
        autoScrollMain(event);
      }

      const canvasRect = canvas.getBoundingClientRect();

      switch (interaction.mode) {
        case "drag":
          handleDragMove(event, canvasRect);
          break;

        case "resize":
          handleResizeMove(event);
          break;

        case "rotate":
          handleRotateMove(event);
          break;

        default:
          break;
      }
    };

    const handleMouseUp = () => {
      setSmartGuides(EMPTY_SMART_GUIDES);
      if (!didMoveRef.current) {
        setInteraction(null);
        return;
      }

      const targetShape = viewShapesRef.current.find(
        (shape) => shape.id === interaction.id
      );

      if (!targetShape) {
        setInteraction(null);
        return;
      }

      if (interaction.mode === "drag") {
        updateRect(targetShape.id, {
          x: targetShape.x,
          y: targetShape.y,
        });
      }

      if (interaction.mode === "resize") {
        updateRect(targetShape.id, {
          width: targetShape.width,
          height: targetShape.height,
        });
      }

      if (interaction.mode === "rotate") {
        updateRect(targetShape.id, {
          rotation: targetShape.rotation || 0,
        });
      }

      setInteraction(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interaction]);

  // ========== 計算済み値 ==========

  const selectedShape = getSelectedShape(viewShapes, selectedId);
  const isSelectedText = selectedShape?.type === "text";
  const { canvasWidth, canvasHeight } = calculateCanvasSize(viewShapes);

  // ========== 内部関数 ==========

  // ドラッグ移動の処理
   
  const handleDragMove = useCallback(
    (event, canvasRect) => {
      const newX = event.clientX - canvasRect.left - interaction.offsetX;
      const newY = event.clientY - canvasRect.top - interaction.offsetY;

      const movingShape = viewShapesRef.current.find(
        (shape) => shape.id === interaction.id
      );

      if (!movingShape) {
        return;
      }

      if (event.shiftKey) {
        setSmartGuides(EMPTY_SMART_GUIDES);
        updateShapeLocal(interaction.id, { x: newX, y: newY }, setViewShapes, viewShapesRef);
        return;
      }

      const snapResult = calculateSmartGuides(
        { ...movingShape, x: newX, y: newY },
        viewShapesRef.current
      );

      setSmartGuides(snapResult.guides);
      updateShapeLocal(interaction.id, { x: snapResult.x, y: snapResult.y }, setViewShapes, viewShapesRef);
    },
    [interaction, calculateSmartGuides, updateShapeLocal]
  );

  // リサイズ移動の処理
   
  const handleResizeMove = useCallback((event) => {
    setSmartGuides(EMPTY_SMART_GUIDES);
    const diffX = event.clientX - interaction.startX;
    const diffY = event.clientY - interaction.startY;

    const newWidth = Math.max(
      MIN_SHAPE_SIZE,
      interaction.startWidth + diffX
    );

    const newHeight = Math.max(
      MIN_SHAPE_SIZE,
      interaction.startHeight + diffY
    );

    updateShapeLocal(
      interaction.id,
      { width: newWidth, height: newHeight },
      setViewShapes,
      viewShapesRef
    );
  }, [interaction, updateShapeLocal]);

  // 回転移動の処理
   
  const handleRotateMove = useCallback((event) => {
    setSmartGuides(EMPTY_SMART_GUIDES);
    const currentPointerAngle =
      (Math.atan2(
        event.clientY - interaction.centerY,
        event.clientX - interaction.centerX
      ) *
        180) /
      Math.PI;

    const angleDifference =
      currentPointerAngle - interaction.startPointerAngle;

    let newRotation = interaction.startRotation + angleDifference;

    if (event.shiftKey) {
      newRotation = Math.round(newRotation / ROTATION_SNAP_ANGLE) * ROTATION_SNAP_ANGLE;
    }

    newRotation = ((newRotation % 360) + 360) % 360;

    updateShapeLocal(
      interaction.id,
      { rotation: Math.round(newRotation) },
      setViewShapes,
      viewShapesRef
    );
  }, [interaction, updateShapeLocal]);

  // ドラッグ・リサイズ時の画面端スクロール
   
  const autoScrollMain = useCallback((event) => {
    const main = mainRef.current;

    if (!main) {
      return;
    }

    const rect = main.getBoundingClientRect();

    if (event.clientX > rect.right - AUTO_SCROLL_EDGE_SIZE) {
      main.scrollLeft += AUTO_SCROLL_SPEED;
    }

    if (event.clientX < rect.left + AUTO_SCROLL_EDGE_SIZE) {
      main.scrollLeft -= AUTO_SCROLL_SPEED;
    }

    if (event.clientY > rect.bottom - AUTO_SCROLL_EDGE_SIZE) {
      main.scrollTop += AUTO_SCROLL_SPEED;
    }

    if (event.clientY < rect.top + AUTO_SCROLL_EDGE_SIZE) {
      main.scrollTop -= AUTO_SCROLL_SPEED;
    }
  }, []);

  // 図形追加
   
  const handleAddShape = useCallback(
    (type) => {
      addShape(type);
    },
    [addShape]
  );

  // キャンバスクリア
   
  const handleClearCanvas = useCallback(() => {
    clearCanvas();
    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
  }, [clearCanvas, clearSelectionState]);

  // 選択中図形削除
   
  const handleDeleteSelected = useCallback(() => {
    if (!selectedId) {
      return;
    }

    const targetId = selectedId;

    setViewShapes((prev) => {
      const next = prev.filter((shape) => shape.id !== targetId);
      viewShapesRef.current = next;
      return next;
    });

    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
    deleteRect(targetId);
  }, [selectedId, deleteRect, clearSelectionState]);

  // 色変更
   
  const handleColorChange = useCallback(
    (event) => {
      const fill = event.target.value;
      if (!selectedId) {
        return;
      }
      updateShapeLocal(selectedId, { fill }, setViewShapes, viewShapesRef);
      updateRect(selectedId, { fill });
    },
    [selectedId, updateShapeLocal, updateRect]
  );

  // テキスト編集終了・保存
   
  const finishTextEditing = useCallback(
    (shapeId) => {
      if (cancelTextEditRef.current) {
        cancelTextEditRef.current = false;
        setEditingId(null);
        return;
      }

      updateShapeLocal(shapeId, { text: draftText }, setViewShapes, viewShapesRef);
      updateRect(shapeId, { text: draftText });
      setEditingId(null);
    },
    [draftText, updateShapeLocal, updateRect]
  );

  // テキスト編集中のキー
   
  const handleTextKeyDown = useCallback((event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelTextEditRef.current = true;
      event.currentTarget.blur();
    }
  }, []);

  // Undo
   
  const handleUndo = useCallback(() => {
    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
    undo();
  }, [undo, clearSelectionState]);

  // Redo 
   
  const handleRedo = useCallback(() => {
    clearSelectionState({ setSelectedId, setEditingId, setInteraction });
    redo();
  }, [redo, clearSelectionState]);

  // 履歴ジャンプ
   
  const handleHistoryClick = useCallback(
    (historyItem) => {
      if (interaction) {
        console.warn("操作中は履歴ジャンプできません");
        return;
      }

      clearSelectionState({ setSelectedId, setEditingId, setInteraction });
      jumpToHistory(historyItem.id);
    },
    [interaction, jumpToHistory, clearSelectionState]
  );

  // 文字サイズ変更
   
  const handleFontSizeChange = useCallback(
    (event) => {
      const fontSize = Number(event.target.value);

      if (!Number.isFinite(fontSize)) {
        return;
      }

      if (!selectedId) {
        return;
      }

      const clampedSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fontSize));
      updateShapeLocal(selectedId, { fontSize: clampedSize }, setViewShapes, viewShapesRef);
      updateRect(selectedId, { fontSize: clampedSize });
    },
    [selectedId, updateShapeLocal, updateRect]
  );

  // 太字
   
  const toggleBold = useCallback(() => {
    if (!selectedShape) return;

    if (!selectedId) {
      return;
    }

    const newWeight = selectedShape.fontWeight === "bold" ? "normal" : "bold";
    updateShapeLocal(selectedId, { fontWeight: newWeight }, setViewShapes, viewShapesRef);
    updateRect(selectedId, { fontWeight: newWeight });
  }, [selectedId, selectedShape, updateShapeLocal, updateRect]);

  // 斜体
   
  const toggleItalic = useCallback(() => {
    if (!selectedShape) return;

    if (!selectedId) {
      return;
    }

    const newStyle = selectedShape.fontStyle === "italic" ? "normal" : "italic";
    updateShapeLocal(selectedId, { fontStyle: newStyle }, setViewShapes, viewShapesRef);
    updateRect(selectedId, { fontStyle: newStyle });
  }, [selectedId, selectedShape, updateShapeLocal, updateRect]);

  // 大文字表示
   
  const toggleUppercase = useCallback(() => {
    if (!selectedShape) return;

    if (!selectedId) {
      return;
    }

    const newTransform =
      selectedShape.textTransform === "uppercase" ? "none" : "uppercase";
    updateShapeLocal(selectedId, { textTransform: newTransform }, setViewShapes, viewShapesRef);
    updateRect(selectedId, { textTransform: newTransform });
  }, [selectedId, selectedShape, updateShapeLocal, updateRect]);

  // 回転値をサーバーへ保存
   
  const saveSelectedRotation = useCallback(() => {
    if (!selectedId) {
      return;
    }

    const targetShape = viewShapesRef.current.find(
      (shape) => shape.id === selectedId
    );

    if (!targetShape) {
      return;
    }

    updateRect(targetShape.id, {
      rotation: targetShape.rotation || 0,
    });
  }, [selectedId, updateRect]);

  // 選択図形をサーバーとローカルで更新
   
  const updateSelectedShape = useCallback(
    (changes) => {
      if (!selectedId) {
        return;
      }
      updateShapeLocal(selectedId, changes, setViewShapes, viewShapesRef);
      updateRect(selectedId, changes);
    },
    [selectedId, updateShapeLocal, updateRect]
  );

  // レイヤー移動
   
  const moveSelectedLayer = useCallback(
    (direction) => {
      const result = calculateLayerReorder(
        selectedId,
        direction,
        viewShapesRef.current
      );

      if (!result) {
        return;
      }

      const { nextShapes, changedShapes } = result;

      setViewShapes(nextShapes);
      viewShapesRef.current = nextShapes;

      changedShapes.forEach(({ id, zIndex }) => {
        updateRect(id, { zIndex });
      });
    },
    [selectedId, calculateLayerReorder, updateRect]
  );

  // レイヤーを前へ
   
  const bringForward = useCallback(() => {
    moveSelectedLayer("forward");
  }, [moveSelectedLayer]);

  //レイヤーを後ろへ
   
  const sendBackward = useCallback(() => {
    moveSelectedLayer("backward");
  }, [moveSelectedLayer]);

  // HTML表示

  const handleClickShowHtml = useCallback(() => {
    handleShowHtmlCode(viewShapes, fileName, setCodeOutput);
  }, [viewShapes, fileName, handleShowHtmlCode]);

  // CSS表示
   
  const handleClickShowCss = useCallback(() => {
    handleShowCssCode(viewShapes, setCodeOutput);
  }, [viewShapes, handleShowCssCode]);

  // コード コピー
   
  const handleClickCopyCode = useCallback(async () => {
    const success = await handleCopyCode(codeOutput);
    if (success) {
      window.alert(`${codeOutput.type}コードをコピーしました`);
    } else {
      window.alert("コードをコピーできませんでした");
    }
  }, [codeOutput.type, codeOutput.content, handleCopyCode]);

  // JSONファイル保存
   
  const handleClickSaveFile = useCallback(() => {
    handleSaveJsonFile(viewShapes, fileName);
  }, [viewShapes, fileName, handleSaveJsonFile]);

  //履歴の図形名を日本語へ変換
   
  const formatObjectLabel = useCallback((historyItem) => {
    const type =
      historyItem.after?.type || historyItem.before?.type;

    if (type) {
      return TYPE_LABELS[type] || type;
    }

    return historyItem.objectId
      ? historyItem.objectId.slice(0, 8)
      : "";
  }, []);

  // ========== HTML ==========

  return (
    <div className="app">
      <header className="app-header">
        <strong className="app-header-title">
          <img src="/pictuer/2aikon.png" alt="Pikva Icon" />
          Pikva
        </strong>

        <input
          type="text"
          className="file-name-input"
          value={fileName}
          onChange={(event) => {
            setFileName(event.target.value);
          }}
          placeholder="ファイル名"
        />

        <button type="button" onClick={handleClearCanvas}>
          新規
        </button>

        <button type="button" onClick={handleClickSaveFile}>
          保存
        </button>

        <button type="button">開く</button>

        <button type="button">PNG出力</button>

        <button type="button" onClick={handleClickShowHtml}>
          HTML出力
        </button>

        <button type="button" onClick={handleClickShowCss}>
          CSS出力
        </button>
      </header>

      {codeOutput.content && (
        <section className="code-output-panel">
          <div className="code-output-header">
            <strong>{codeOutput.type}コード</strong>

            <div>
              <button type="button" onClick={handleClickCopyCode}>
                コピー
              </button>

              <button
                type="button"
                onClick={() => {
                  setCodeOutput({
                    type: "",
                    content: "",
                  });
                }}
              >
                閉じる
              </button>
            </div>
          </div>

          <textarea
            className="code-output-textarea"
            value={codeOutput.content}
            readOnly
            spellCheck={false}
          />
        </section>
      )}

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
                handleAddShape("circle")
              }
            >
              円を追加
            </button>

            <button
              type="button"
              onClick={() =>
                handleAddShape("triangle")
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

          {selectedShape && (
            <label className="rotation-tool">
              回転

              <input
                type="range"
                min="0"
                max="359"
                value={Math.round(
                  selectedShape.rotation || 0
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
                    },
                    setViewShapes,
                    viewShapesRef
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
                  selectedShape.rotation || 0
                )}
                °
              </span>
            </label>
          )}

          {selectedShape && (
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
          )}

          <label className="color-tool">
            色

            <input
              type="color"
              value={
                selectedShape?.fill || "#4f8cff"
              }
              onChange={
                handleColorChange
              }
            />
          </label>

          {isSelectedText && (
            <div className="text-format-tools">
              <label>
                文字サイズ

                <input
                  type="number"
                  min={MIN_FONT_SIZE}
                  max={MAX_FONT_SIZE}
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
          )}

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
              if (
                event.target ===
                event.currentTarget
              ) {
                setSelectedId(null);
                setEditingId(null);
              }
            }}
          >
            {smartGuides.vertical.map((guideX) => (
              <div
                key={`vertical-${guideX}`}
                className="smart-guide smart-guide-vertical"
                style={{
                  left: `${guideX}px`,
                }}
              />
            ))}

            {smartGuides.horizontal.map((guideY) => (
              <div
                key={`horizontal-${guideY}`}
                className="smart-guide smart-guide-horizontal"
                style={{
                  top: `${guideY}px`,
                }}
              />
            ))}

            {viewShapes.map((shape, shapeIndex) => {
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

                    startDrag(event, shape, {
                      canvasRef,
                      setInteraction,
                      setSelectedId,
                      setEditingId,
                    });
                  }}
                  onDoubleClick={(
                    event
                  ) => {
                    startTextEditing(
                      event,
                      shape,
                      {
                        setSelectedId,
                        setInteraction,
                        setDraftText,
                        setEditingId,
                      }
                    );
                  }}
                  style={{
                    left: `${shape.x}px`,
                    top: `${shape.y}px`,
                    width: `${shape.width}px`,
                    height: `${shape.height}px`,

                    transform: `rotate(${shape.rotation || 0
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
                        ? `${shape.fontSize ||
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
                            shape,
                            {
                              setInteraction,
                              setSelectedId,
                              setEditingId,
                            }
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
                              shape,
                              {
                                setInteraction,
                                setSelectedId,
                                setEditingId,
                              }
                            );
                          }}
                        />
                      ) : null}
                      {isSelected && !isEditing ? (
                        <div
                          className="shape-measurement"
                          style={{
                            transform: `
        translateX(-50%)
        rotate(${-(shape.rotation || 0)}deg)
      `,
                          }}
                        >
                          <span>
                            X {Math.round(shape.x)}
                          </span>

                          <span>
                            Y {Math.round(shape.y)}
                          </span>

                          <span>
                            W {Math.round(shape.width)}
                          </span>

                          <span>
                            H {Math.round(shape.height)}
                          </span>

                          <strong>px</strong>
                        </div>
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
                    `${historyItem.createdAt
                    }-${historyItem.action
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
