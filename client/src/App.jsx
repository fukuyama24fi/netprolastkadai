import { useEffect, useRef, useState } from "react";
import { useCanvasSocket } from "./services/UseCanvasSocket";
import "./App.css";

const App = () => {
  const {
    shapes,
    history,
    addRect,
    updateRect,
    deleteRect,
    clearCanvas,
  } = useCanvasSocket();

  const [viewShapes, setViewShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [interaction, setInteraction] = useState(null);

  const canvasRef = useRef(null);
  const viewShapesRef = useRef([]);

  // サーバーから来たshapesを画面表示用stateに反映する
  useEffect(() => {
    // ドラッグ中・リサイズ中は、操作中の見た目を優先する
    if (!interaction) {
      setViewShapes(shapes);
      viewShapesRef.current = shapes;
    }
  }, [shapes, interaction]);

  const selectedShape = viewShapes.find((shape) => {
    return shape.id === selectedId;
  });

  const updateShapeLocal = (id, changes) => {
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
  };

  const handleAddRect = () => {
    addRect();
  };

  const handleClearCanvas = () => {
    clearCanvas();
    setSelectedId(null);
  };

  const handleDeleteSelected = () => {
    if (!selectedId) {
      return;
    }

    deleteRect(selectedId);
    setSelectedId(null);
  };

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

  const startDrag = (event, shape) => {
    setSelectedId(shape.id);

    const shapeRect = event.currentTarget.getBoundingClientRect();

    setInteraction({
      mode: "drag",
      id: shape.id,
      offsetX: event.clientX - shapeRect.left,
      offsetY: event.clientY - shapeRect.top,
    });

    event.preventDefault();
  };

  const startResize = (event, shape) => {
    event.stopPropagation();

    setSelectedId(shape.id);

    setInteraction({
      mode: "resize",
      id: shape.id,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: shape.width,
      startHeight: shape.height,
    });

    event.preventDefault();
  };

  useEffect(() => {
    if (!interaction) {
      return;
    }

    const handleMouseMove = (event) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return;
      }

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
  }, [interaction, updateRect]);

  return (
    <div className="app">
      <aside className="tool">
        <h1>Pikva</h1>

        <button type="button" onClick={handleAddRect}>
          四角形を追加
        </button>

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
      </aside>

      <main className="main">
        <div ref={canvasRef} className="canvas">
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

        <ul className="history-list">
          {history.map((h, i) => (
            <li key={i}>
              {new Date(h.createdAt).toLocaleTimeString()} - {h.action}
              {h.objectId ? `（${h.objectId}）` : ""} by {h.userId}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default App;