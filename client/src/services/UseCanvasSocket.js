import { useEffect, useState } from "react";
import socketService from "./socketService";

export function useCanvasSocket() {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    socketService.connect();

    const handleMessage = (data) => {
      console.log("socket受信:", data);

      switch (data.action) {
        case "INIT": {
          setShapes(data.objects || []);
          break;
        }

        case "HISTORY_RESPONSE": {
          setHistory(data.history || []);
          break;
        }

        case "ADD": {
          setShapes((prev) => {
            if (prev.find((shape) => shape.id === data.object.id)) {
              return prev;
            }

            return [...prev, data.object];
          });

          if (data.history) {
            setHistory((prev) => [...prev, data.history]);
          }

          break;
        }

        case "UPDATE": {
          const targetId = data.id || data.object?.id;

          /*
            バックエンドが
            { id, changes }
            で返しても、
            { object }
            で返しても対応できるようにする
          */
          const changes = data.changes || data.object || {};

          if (!targetId) {
            console.warn("UPDATEにidがありません:", data);
            return;
          }

          setShapes((prev) =>
            prev.map((shape) =>
              shape.id === targetId
                ? {
                    ...shape,
                    ...changes,
                  }
                : shape
            )
          );

          if (data.history) {
            setHistory((prev) => [...prev, data.history]);
          }

          break;
        }

        case "DELETE": {
          setShapes((prev) => prev.filter((shape) => shape.id !== data.id));

          if (data.history) {
            setHistory((prev) => [...prev, data.history]);
          }

          break;
        }

        case "CLEAR": {
          setShapes([]);

          if (data.history) {
            setHistory((prev) => [...prev, data.history]);
          }

          break;
        }

        default:
          console.log("不明なアクション:", data.action);
      }
    };

    socketService.onMessage(handleMessage);

    return () => {
      socketService.offMessage(handleMessage);
    };
  }, []);

  const addRect = () => {
    const newRect = {
      id: crypto.randomUUID(),
      type: "rect",
      x: 300,
      y: 300,
      width: 100,
      height: 100,
      fill: "#4f8cff",
    };

    socketService.sendMessage("ADD", {
      object: newRect,
    });
  };

  const updateRect = (id, changes) => {
    /*
      先にフロント側のshapesも更新する。
      これを入れると、サーバー応答待ちで初期位置に戻りにくくなる。
    */
    setShapes((prev) =>
      prev.map((shape) =>
        shape.id === id
          ? {
              ...shape,
              ...changes,
            }
          : shape
      )
    );

    socketService.sendMessage("UPDATE", {
      id,
      changes,
    });
  };

  const deleteRect = (id) => {
    socketService.sendMessage("DELETE", {
      id,
    });
  };

  const clearCanvas = () => {
    socketService.sendMessage("CLEAR", {});
  };

  return {
    shapes,
    history,
    addRect,
    updateRect,
    deleteRect,
    clearCanvas,
  };
}