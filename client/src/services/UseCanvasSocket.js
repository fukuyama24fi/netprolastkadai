import { useCallback, useEffect, useState } from "react";
import socketService from "./socketService";

export function useCanvasSocket() {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);
  const [userName, setUserNameState] = useState(
    socketService.getUserName()
  );

  // 履歴を重複させずに追加する
  const addHistoryIfNeeded = useCallback((newHistory) => {
    if (!newHistory) {
      return;
    }

    setHistory((prev) => {
      const exists =
        newHistory.id &&
        prev.some((item) => item.id === newHistory.id);

      if (exists) {
        console.log("重複履歴を無視:", newHistory.id);
        return prev;
      }

      return [...prev, newHistory];
    });
  }, []);

  useEffect(() => {
    socketService.connect();

    const handleMessage = (data) => {
      console.log("socket受信:", data);

      switch (data.action) {
        case "INIT": {
          setShapes(data.objects || []);

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
            const exists = prev.some(
              (shape) => shape.id === data.object.id
            );

            if (exists) {
              console.log(
                "重複ADDを無視:",
                data.object.id
              );

              return prev;
            }

            return [...prev, data.object];
          });

          addHistoryIfNeeded(data.history);
          break;
        }

        case "UPDATE": {
          const targetId =
            data.id || data.object?.id;

          const changes =
            data.changes || data.object || {};

          if (!targetId) {
            console.warn(
              "UPDATEにidがありません:",
              data
            );

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
          setShapes((prev) =>
            prev.filter(
              (shape) => shape.id !== data.id
            )
          );

          addHistoryIfNeeded(data.history);
          break;
        }

        case "CLEAR": {
          setShapes([]);
          addHistoryIfNeeded(data.history);
          break;
        }

        default:
          console.log(
            "不明なアクション:",
            data.action
          );
      }
    };

    socketService.onMessage(handleMessage);

    return () => {
      socketService.offMessage(handleMessage);
    };
  }, [addHistoryIfNeeded]);

  const setUserName = useCallback((name) => {
    const nextName =
      name.trim() || "名無し";

    setUserNameState(nextName);
    socketService.setUserName(nextName);
  }, []);

  // 四角・円・三角・テキスト共通の追加処理
  const addShape = useCallback(
    (type) => {
      const commonShape = {
        id: crypto.randomUUID(),
        type,
        x: 300,
        y: 300,
      };

      let newShape;

      switch (type) {
        case "circle": {
          newShape = {
            ...commonShape,
            width: 100,
            height: 100,
            fill: "#ff6b6b",
          };

          break;
        }

        case "triangle": {
          newShape = {
            ...commonShape,
            width: 120,
            height: 100,
            fill: "#f5b942",
          };

          break;
        }

        case "text": {
          newShape = {
            ...commonShape,
            width: 180,
            height: 50,
            fill: "#222222",
            text: "テキスト",
            fontSize: 24,
          };

          break;
        }

        case "rect":
        default: {
          newShape = {
            ...commonShape,
            type: "rect",
            width: 100,
            height: 100,
            fill: "#4f8cff",
          };

          break;
        }
      }

      socketService.sendMessage("ADD", {
        object: newShape,
        userName,
      });
    },
    [userName]
  );

  // 既存のApp.jsxを壊さないために残す
  const addRect = useCallback(() => {
    addShape("rect");
  }, [addShape]);

  const updateRect = useCallback(
    (id, changes) => {
      // サーバー応答を待たずに画面へ反映
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
    },
    [userName]
  );

  const deleteRect = useCallback(
    (id) => {
      socketService.sendMessage("DELETE", {
        id,
        userName,
      });
    },
    [userName]
  );

  const clearCanvas = useCallback(() => {
    socketService.sendMessage("CLEAR", {
      userName,
    });
  }, [userName]);

  const undo = useCallback(() => {
    socketService.undo();
  }, []);

  const redo = useCallback(() => {
    socketService.redo();
  }, []);

  const jumpToHistory = useCallback(
    (historyId) => {
      console.log(
        "履歴ジャンプ開始:",
        historyId
      );

      socketService.jumpToHistory(
        historyId
      );
    },
    []
  );

  return {
    shapes,
    history,
    userName,
    setUserName,

    // 新しい共通追加関数
    addShape,

    // 既存コードとの互換用
    addRect,

    updateRect,
    deleteRect,
    clearCanvas,
    undo,
    redo,
    jumpToHistory,
  };
}