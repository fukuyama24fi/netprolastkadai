import { useEffect, useState } from "react";
import socketService from "./socketService";

export function useCanvasSocket() {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);
  const [userName, setUserNameState] = useState(socketService.getUserName());

  useEffect(() => {
    socketService.connect();

    const handleMessage = (data) => {
      console.log("socket受信:", data);

      switch (data.action) {
        case "INIT": {
          setShapes(data.objects || []);
          setHistory(data.history || []);
          break;
        }

        case "HISTORY_RESPONSE": {
          setHistory(data.history || []);
          break;
        }

        case "ADD": {
          if (!data.object) {
            return;
          }

          setShapes((prev) => {
            const exists = prev.some((shape) => {
              return shape.id === data.object.id;
            });

            if (exists) {
              console.log("重複ADDを無視:", data.object.id);
              return prev;
            }

            return [...prev, data.object];
          });

          addHistoryIfNeeded(data.history);

          break;
        }

        case "UPDATE": {
          const targetId = data.id || data.object?.id;
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

          addHistoryIfNeeded(data.history);

          break;
        }

        case "DELETE": {
          setShapes((prev) => {
            return prev.filter((shape) => shape.id !== data.id);
          });

          addHistoryIfNeeded(data.history);

          break;
        }

        case "CLEAR": {
          setShapes([]);

          addHistoryIfNeeded(data.history);

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

  const addHistoryIfNeeded = (newHistory) => {
    if (!newHistory) {
      return;
    }

    setHistory((prev) => {
      const key =
        newHistory.id ||
        `${newHistory.action}-${newHistory.objectId}-${newHistory.createdAt}`;

      const exists = prev.some((item) => {
        const itemKey =
          item.id ||
          `${item.action}-${item.objectId}-${item.createdAt}`;

        return itemKey === key;
      });

      if (exists) {
        return prev;
      }

      return [...prev, newHistory];
    });
  };

  const setUserName = (name) => {
    const nextName = name.trim() || "名無し";

    setUserNameState(nextName);
    socketService.setUserName(nextName);
  };

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
      userName,
    });
  };

  const updateRect = (id, changes) => {
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
      userName,
    });
  };

  const deleteRect = (id) => {
    socketService.sendMessage("DELETE", {
      id,
      userName,
    });
  };

  const clearCanvas = () => {
    socketService.sendMessage("CLEAR", {
      userName,
    });
  };

  return {
    shapes,
    history,
    userName,
    setUserName,
    addRect,
    updateRect,
    deleteRect,
    clearCanvas,
  };
}

const undo = () => {
    socket.emit("message", { action: "UNDO", userId });
};

const redo = () => {
    socket.emit("message", { action: "REDO", userId });
};