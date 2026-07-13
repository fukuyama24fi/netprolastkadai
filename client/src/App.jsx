import { useEffect, useRef, useState } from "react";
import socketService from "./services/socketService";
import "./App.css";

const App = () => {
  const [shapes, setShapes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  const canvasRef = useRef(null);
  const shapesRef = useRef([]);

  const [interaction, setInteraction] = useState(null);

  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

  useEffect(() => {
    socketService.connect();

    const handleMessage = (data) => {
      switch (data.action) {
        case "INIT":
          setShapes(data.objects || []);
          break;

        case "ADD":
          setShapes((prev) => {
            if (prev.find((shape) => shape.id === data.object.id)) {
              return prev;
            }

            return [...prev, data.object];
          });
          break;

        case "UPDATE":
          setShapes((prev) =>
            prev.map((shape) =>
              shape.id === data.id
                ? {
                    ...shape,
                    ...data.changes,
                  }
                : shape
            )
          );
          break;

        case "DELETE":
          setShapes((prev) => prev.filter((shape) => shape.id !== data.id));

          if (selectedId === data.id) {
            setSelectedId(null);
          }

          break;

        case "CLEAR":
          setShapes([]);
          setSelectedId(null);
          break;

        default:
          console.log("不明なアクション:", data.action);
      }
    };

    socketService.onMessage(handleMessage);

    return () => {
      socketService.offMessage(handleMessage);
    };
  }, [selectedId]);

  const selectedShape = shapes.find((shape) => shape.id === selectedId);

  const addRect = () => {
    const newRect = {
      id: crypto.randomUUID(),
      type: "rect",
      x: 100,
      y: 100,
      width: 120,
      height: 80,
      fill: "#4f8cff",
    };

    socketService.sendMessage("ADD", {
      object: newRect,
    });
  };

  const updateShapeLocal = (id, changes) => {
    setShapes((prev) => {
      const next = prev.map((shape) =>
        shape.id === id
          ? {
              ...shape,
              ...changes,
            }
          : shape
      );

      shapesRef.current = next;

      return next;
    });
  };

  const sendShapeUpdate = (id, changes) => {
    socketService.sendMessage("UPDATE", {
      id,
      changes,
    });
  };

  const deleteSelectedShape = () => {
    if (!selectedId) {
      return;
    }

    socketService.sendMessage("DELETE", {
      id: selectedId,
    });

    setSelectedId(null);
  };

  const clearCanvas = () => {
    socketService.sendMessage("CLEAR", {});
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

    sendShapeUpdate(selectedId, {
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
        const newX = event.clientX - canvasRect.left - interaction.offsetX;
        const newY = event.clientY - canvasRect.top - interaction.offsetY;

        updateShapeLocal(interaction.id, {
          x: newX,
          y: newY,
        });
      }

      if (interaction.mode === "resize") {
        const diffX = event.clientX - interaction.startX;
        const diffY = event.clientY - interaction.startY;

        const newWidth = Math.max(30, interaction.startWidth + diffX);
        const newHeight = Math.max(30, interaction.startHeight + diffY);

        updateShapeLocal(interaction.id, {
          width: newWidth,
          height: newHeight,
        });
      }
    };

    const handleMouseUp = () => {
      const targetShape = shapesRef.current.find(
        (shape) => shape.id === interaction.id
      );

      if (targetShape) {
        if (interaction.mode === "drag") {
          sendShapeUpdate(targetShape.id, {
            x: targetShape.x,
            y: targetShape.y,
          });
        }

        if (interaction.mode === "resize") {
          sendShapeUpdate(targetShape.id, {
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
  }, [interaction]);

  return (
    <div className="app">
      <aside className="tool">
        <h1>Pikva</h1>

        <button type="button" onClick={addRect}>
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
          onClick={deleteSelectedShape}
        >
          選択中を削除
        </button>

        <button type="button" onClick={clearCanvas}>
          全て消去
        </button>
      </aside>

      <main className="main">
        <div ref={canvasRef} className="canvas">
          {shapes.map((shape) => {
            const isSelected = shape.id === selectedId;

            return (
              <div
                key={shape.id}
                className={`shape ${isSelected ? "selected" : ""}`}
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
    </div>
  );
};

export default App;