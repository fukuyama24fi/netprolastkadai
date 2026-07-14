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
          //INIT時は一度だけ状態を更新（バッチ処理）
          setShapes(data.objects || []); 
          // 履歴がついてきたら更新
          if (data.history) {
            setHistory(data.history || []);
          }
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

  //履歴追加の重複チェック
  const addHistoryIfNeeded = useCallback((newHistory) => {
    if (!newHistory) {
      return;
    }

    setHistory((prev) => {
      // 同じIDの履歴がすでに存在しているかチェック
      if (newHistory.id && prev.some(item => item.id === newHistory.id)) {
        console.log("重複履歴を無視:", newHistory.id);
        return prev;
      }

      return [...prev, newHistory];
    });
  }, []);

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

  //Undo（矢印ボタン用・1回1件）
  const undo = () => {
    socketService.undo();
  };

  //Redo（矢印ボタン用・1回1件）
  const redo = () => {
    socketService.redo();
  };

  // 非同期待機なし（サーバーが INIT で応答）
  const jumpToHistory = useCallback((historyId) => {
    console.log("履歴ジャンプ開始:", historyId);
    socketService.jumpToHistory(historyId);
  }, []);

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