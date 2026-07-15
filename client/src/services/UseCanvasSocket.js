import {
  useCallback,
  useEffect,
  useState,
} from "react";

import socketService from "./socketService";

export function useCanvasSocket() {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);

  const [userName, setUserNameState] =
    useState(
      socketService.getUserName()
    );

  const [exportedFile, setExportedFile] =
    useState(null);

  /*
   * 履歴の重複追加を防ぐ
   */
  const addHistoryIfNeeded =
    useCallback((historyEntry) => {
      if (!historyEntry) {
        return;
      }

      setHistory((prev) => {
        const alreadyExists = prev.some(
          (item) =>
            item.id === historyEntry.id
        );

        if (alreadyExists) {
          return prev;
        }

        return [
          ...prev,
          historyEntry,
        ];
      });
    }, []);

  /*
   * Socket接続と受信
   */
  useEffect(() => {
    socketService.connect();

    const handleMessage = (data) => {
      console.log(
        "socket受信:",
        data
      );

      switch (data.action) {
        case "INIT": {
          setShapes(
            Array.isArray(data.objects)
              ? data.objects
              : []
          );

          if (
            Array.isArray(data.history)
          ) {
            setHistory(data.history);
          }

          break;
        }

        case "HISTORY_RESPONSE": {
          setHistory(
            Array.isArray(data.history)
              ? data.history
              : []
          );

          break;
        }

        case "ADD": {
          if (!data.object?.id) {
            console.warn(
              "ADDデータが不正です",
              data
            );

            break;
          }

          setShapes((prev) => {
            const alreadyExists =
              prev.some(
                (shape) =>
                  shape.id ===
                  data.object.id
              );

            if (alreadyExists) {
              return prev;
            }

            return [
              ...prev,
              data.object,
            ];
          });

          addHistoryIfNeeded(
            data.history
          );

          break;
        }

        case "UPDATE": {
          const targetId =
            data.id ||
            data.object?.id;

          const changes =
            data.changes ||
            data.object ||
            {};

          if (!targetId) {
            break;
          }

          setShapes((prev) => {
            return prev.map((shape) => {
              if (
                shape.id !== targetId
              ) {
                return shape;
              }

              return {
                ...shape,
                ...changes,
              };
            });
          });

          addHistoryIfNeeded(
            data.history
          );

          break;
        }

        case "DELETE": {
          if (!data.id) {
            break;
          }

          setShapes((prev) => {
            return prev.filter(
              (shape) =>
                shape.id !== data.id
            );
          });

          addHistoryIfNeeded(
            data.history
          );

          break;
        }

        case "CLEAR": {
          setShapes([]);

          addHistoryIfNeeded(
            data.history
          );

          break;
        }

        case "EXPORT_RESULT": {
          if (!data.file) {
            console.warn(
              "出力データがありません",
              data
            );

            break;
          }

          /*
           * 同じ内容を連続出力しても
           * Reactが更新を認識するようにする
           */
          setExportedFile({
            ...data.file,
            receivedAt: Date.now(),
          });

          break;
        }

        default: {
          console.log(
            "未処理のaction:",
            data.action
          );
        }
      }
    };

    socketService.onMessage(
      handleMessage
    );

    return () => {
      socketService.offMessage(
        handleMessage
      );
    };
  }, [addHistoryIfNeeded]);

  /*
   * 表示名変更
   */
  const setUserName = useCallback(
    (nextName) => {
      const trimmedName =
        nextName.trim() ||
        "名無しさん";

      socketService.setUserName(
        trimmedName
      );

      setUserNameState(trimmedName);

      socketService.sendMessage(
        "SET_USERNAME",
        {
          userName: trimmedName,
        }
      );
    },
    []
  );

  /*
   * 図形追加
   */
  const addShape = useCallback(
    (type) => {
      const allowedTypes = [
        "rect",
        "circle",
        "triangle",
        "text",
      ];

      const safeType =
        allowedTypes.includes(type)
          ? type
          : "rect";

      const maxZIndex =
        shapes.reduce(
          (
            currentMax,
            shape,
            index
          ) => {
            const zIndex = Number(
              shape.zIndex
            );

            return Math.max(
              currentMax,
              Number.isFinite(zIndex)
                ? zIndex
                : index
            );
          },
          -1
        );

      const commonShape = {
        id: crypto.randomUUID(),
        type: safeType,

        x: 300,
        y: 300,

        rotation: 0,
        zIndex: maxZIndex + 1,
      };

      let newShape;

      switch (safeType) {
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
            height: 60,

            fill: "#222222",
            text: "テキスト",

            fontSize: 24,
            fontWeight: "normal",
            fontStyle: "normal",
            textTransform: "none",
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
        }
      }

      console.log(
        "ADD送信:",
        newShape
      );

      /*
       * App側では先に追加せず、
       * サーバーから返ったADDだけで追加する。
       * これで二重追加を防ぐ。
       */
      socketService.sendMessage(
        "ADD",
        {
          object: newShape,
        }
      );
    },
    [shapes]
  );

  /*
   * 図形更新
   */
  const updateRect = useCallback(
    (id, changes) => {
      if (!id || !changes) {
        return;
      }

      socketService.sendMessage(
        "UPDATE",
        {
          id,
          changes,
        }
      );
    },
    []
  );

  const deleteRect = useCallback(
    (id) => {
      if (!id) {
        return;
      }

      socketService.sendMessage(
        "DELETE",
        {
          id,
        }
      );
    },
    []
  );

  const clearCanvas =
    useCallback(() => {
      socketService.sendMessage(
        "CLEAR",
        {}
      );
    }, []);

  const undo = useCallback(() => {
    socketService.sendMessage(
      "UNDO",
      {}
    );
  }, []);

  const redo = useCallback(() => {
    socketService.sendMessage(
      "REDO",
      {}
    );
  }, []);

  const jumpToHistory =
    useCallback((targetId) => {
      socketService.sendMessage(
        "JUMP_TO_HISTORY",
        {
          targetId,
        }
      );
    }, []);

  /*
   * HTML・CSS出力
   */
  const exportCode = useCallback(
    (format, fileName) => {
      if (
        format !== "html" &&
        format !== "css"
      ) {
        console.warn(
          "不正な出力形式:",
          format
        );

        return;
      }

      console.log(
        "EXPORT_CODE送信:",
        {
          format,
          fileName,
        }
      );

      socketService.sendMessage(
        "EXPORT_CODE",
        {
          format,
          fileName:
            fileName?.trim() ||
            "pikva-canvas",
        }
      );
    },
    []
  );

  return {
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

    exportedFile,
    exportCode,
  };
}