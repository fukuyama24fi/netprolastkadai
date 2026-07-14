import { useEffect, useRef, useState, useCallback } from "react";
import { useCanvasSocket } from "./services/UseCanvasSocket";
import "./App.css";

//履歴表示用
const TYPE_LABELS = {
  rect: "四角形",
  circle: "円",
  triangle: "三角形",
  text: "テキスト",
  // circle: "円", text: "テキスト" など今後増えたらここに追加
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
    undo,           //Undo関数を取得
    redo,           //Redo関数を取得
    jumpToHistory,  //履歴ジャンプ関数を取得
  } = useCanvasSocket();

  const [viewShapes, setViewShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [interaction, setInteraction] = useState(null);

  const canvasRef = useRef(null);
  const viewShapesRef = useRef([]);
  const didMoveRef = useRef(false);
  const mainRef = useRef(null);
  const historyEndRef = useRef(null);

  // サーバーから来たshapesを画面表示用stateに反映する
  useEffect(() => {
    // ドラッグ中・リサイズ中は、操作中の見た目を優先する
    if (interaction) {
      return;
    }
    setViewShapes(shapes);
    viewShapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [history]);

  const selectedShape = viewShapes.find((shape) => {
    return shape.id === selectedId;
  });

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

  const updateShapeLocal = useCallback((id, changes) => { //useCallbackでメモ化
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
  }, []);

  const autoScrollMain = useCallback((event) => { //useCallbackでメモ化
    const main = mainRef.current;

    if (!main) {
      return;
    }

    const rect = main.getBoundingClientRect();

    const edgeSize = 80;
    const scrollSpeed = 24;

    //右側に近い
    if (event.clientX > rect.right - edgeSize) {
      main.scrollLeft += scrollSpeed;
    }

    //左側に近い
    if (event.clientX < rect.left + edgeSize) {
      main.scrollLeft -= scrollSpeed;
    }

    //下側に近い
    if (event.clientY > rect.bottom - edgeSize) {
      main.scrollTop += scrollSpeed;
    }

    //上側に近い
    if (event.clientY < rect.top + edgeSize) {
      main.scrollTop -= scrollSpeed;
    }
  }, []);

  const handleAddRect = useCallback((type) => { //useCallbackでメモ化
    addRect(type);
  }, [addRect]);

  const handleClearCanvas = useCallback(() => { //useCallbackでメモ化
    clearCanvas();
    setSelectedId(null);
  }, [clearCanvas]);

  const handleDeleteSelected = useCallback(() => { //useCallbackでメモ化
    if (!selectedId) {
      return;
    }

    const targetId = selectedId;

    // 先に画面上から消す
    setViewShapes((prev) => {
      const next = prev.filter((shape) => {
        return shape.id !== targetId;
      });

      viewShapesRef.current = next;

      return next;
    });

    // 選択状態を解除
    setSelectedId(null);
    setInteraction(null);

  // サーバーへ削除通知
  deleteRect(targetId);

  }, [selectedId, deleteRect]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (!selectedId) {
        return;
      }

      const tagName = document.activeElement?.tagName;

      if (tagName === "INPUT" || tagName === "TEXTAREA") {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedId, deleteRect]);

  const handleColorChange = (event) => {
    if (!selectedId) {
      return;
    }

    const fill = event.target.value;

    updateShapeLocal(selectedId, {
      fill,
    });

    updateRect(selectedId, {
      fill,
    });
  };

  //Undoボタン処理
  const handleUndo = useCallback(() => {
    undo();
  }, [undo]);

  //Redoボタン処理
  const handleRedo = useCallback(() => {
    redo();
  }, [redo]);

  //履歴クリック時の処理（ジャンプ。状態更新タイミングを制御）
  const handleHistoryClick = useCallback((historyItem) => {
    //すでにインタラクション中なら実行しない（競合防止）
    if (interaction) {
      console.warn("ドラッグ/リサイズ中は履歴ジャンプできません");
      return;
    }
    //選択を解除してからジャンプ（UI の一貫性）
    setSelectedId(null);
    //サーバーに送信
    jumpToHistory(historyItem.id);
  }, [jumpToHistory]); 


  const startDrag = useCallback((event, shape) => {
    setSelectedId(shape.id);

    didMoveRef.current = false;

    const shapeRect = event.currentTarget.getBoundingClientRect();

    setInteraction({
      mode: "drag",
      id: shape.id,
      offsetX: event.clientX - shapeRect.left,
      offsetY: event.clientY - shapeRect.top,
    });

    event.preventDefault();
  }, []);

  const startResize = useCallback((event, shape) => {
    event.stopPropagation();

    setSelectedId(shape.id);
    didMoveRef.current = false;

    setInteraction({
      mode: "resize",
      id: shape.id,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: shape.width,
      startHeight: shape.height,
    });

    event.preventDefault();
  }, []);

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
      autoScrollMain(event);

      const canvasRect = canvas.getBoundingClientRect();

      if (interaction.mode === "drag") {
        const newX =
          event.clientX - canvasRect.left - interaction.offsetX;

        const newY =
          event.clientY - canvasRect.top - interaction.offsetY;

        updateShapeLocal(interaction.id, {
          x: newX,
          y: newY,
        });
      }

      if (interaction.mode === "resize") {
        const diffX = event.clientX - interaction.startX;
        const diffY = event.clientY - interaction.startY;

        const newWidth = Math.max(
          30,
          interaction.startWidth + diffX
        );

        const newHeight = Math.max(
          30,
          interaction.startHeight + diffY
        );

        updateShapeLocal(interaction.id, {
          width: newWidth,
          height: newHeight,
        });
      }
    };

    const handleMouseUp = () => {

      if (!didMoveRef.current) {
        setInteraction(null);
        return
      }
      const targetShape = viewShapesRef.current.find((shape) => {
        return shape.id === interaction.id;
      });

      if (targetShape) {
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
      }

      setInteraction(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [interaction, updateShapeLocal, updateRect, autoScrollMain]);

  //履歴のオブジェクトを日本語に変換するよ
  const formatObjectLabel = (h) => {
    const type = h.changes?.type;
    if (type) return TYPE_LABELS[type] || type; //対応表に無ければtypeそのまま表示
    return h.objectId ? h.objectId.slice(0, 8) : ""; //typeが無い古いデータ用の保険です
  };

  return (
    <div className="app">
      <aside className="tool">
        <h1>Pikva</h1>

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
            title="Undo"
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


        

        <label className="color-tool">
          色
          <input
            type="color"
            value={selectedShape?.fill || "#4f8cff"}
            onChange={handleColorChange}
          />
        </label>

        <button
          type="button"
          className="delete-button-main"
          onClick={handleDeleteSelected}
        >
          選択中を削除
        </button>

        <button type="button" onClick={handleClearCanvas}>
          全て消去
        </button>
      </aside >

      <main ref={mainRef} className="main">
        <div ref={canvasRef} className="canvas" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
          {viewShapes.map((shape) => {
            const isSelected = shape.id === selectedId;

            return (
              <div
                key={shape.id}
                className={[
                  "shape",
                  shape.type || "rect",
                  isSelected ? "selected" : "",
                ].join(" ")}
                onMouseDown={(event) => startDrag(event, shape)}
                style={{
                  left: `${shape.x}px`,
                  top: `${shape.y}px`,
                  width: `${shape.width}px`,
                  height: `${shape.height}px`,
                  backgroundColor: shape.fill,
                }}
              >
                <div
                  className="resize-handle"
                  onMouseDown={(event) => startResize(event, shape)}
                />
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
            onBlur={(e) => setUserName(e.target.value)}
          />
        </div>

        <ul className="history-list">
          {history.map((h, i) => (
            <li
              key={i}
              //履歴クリックで該当の時点まで巻き戻し
              onClick={() => handleHistoryClick(h)}
              style={{
                cursor: interaction ? "not-allowed" : "pointer", // 🆕 インタラクション中は無効表示
                opacity: interaction ? 0.5 : 1 // 🆕 薄くする
              }}
              title={
                interaction
                  ? "ドラッグ/リサイズ中は履歴ジャンプできません"
                  : "クリックでこの時点まで巻き戻します"
              }
            >
              {new Date(h.createdAt).toLocaleTimeString()} - {h.action}
              {h.objectId && `（${formatObjectLabel(h)}）`}
              {" by "}
              {h.userName || h.userId?.slice(0, 8)}
            </li>
          ))}
          <li ref={historyEndRef} className="history-end" />
        </ul>
      </section>
    </div >
  );
};

export default App;