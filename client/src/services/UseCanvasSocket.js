import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import socketService from "./socketService";

export function useCanvasSocket() {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]);

  /*
   * 古い履歴の読み込み
   * サーバーは最新200件だけを送ってくる。編集履歴を一番上までスクロールしたら、
   * loadOlderHistory() でさらに古い200件をもらって、上に付け足す
   * 読み込んだ古い履歴はこのブラウザのメモリにだけあるので、再読み込みすると最新200件に戻る
   */
  // まだ古い履歴がサーバーにあるか
  const [hasOlderHistory, setHasOlderHistory] = useState(false);
  // 古い履歴を読み込み中か（二重に頼まないため）
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  // loadOlderHistory や受信処理の中で最新の値を読むための ref
  const historyRef = useRef(history);
  const hasOlderHistoryRef = useRef(false);
  const isLoadingOlderHistoryRef = useRef(false);

  // 描画が終わるたびに ref を最新の値にしておく（描画中に ref を書き換えるのは React では避ける）
  useEffect(() => {
    historyRef.current = history;
    hasOlderHistoryRef.current = hasOlderHistory;
    isLoadingOlderHistoryRef.current = isLoadingOlderHistory;
  }, [history, hasOlderHistory, isLoadingOlderHistory]);

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
          const incoming = Array.isArray(data.history)
            ? data.history
            : [];

          /*
           * サーバーは編集のたびに最新200件を送り直してくる
           * そのまま置き換えると、さかのぼって読み込んだ古い履歴が消えてしまうので、
           * 届いた中で一番古い履歴よりさらに古いものは、手元に残してつなげる
           * （古い履歴は後から書き換わらないので、そのまま残して大丈夫）
           */
          const oldestIncomingId = incoming.length > 0
            ? Number(incoming[0].id)
            : -Infinity;
          const isOlder = (item) => Number(item.id) < oldestIncomingId;

          // 古い履歴を手元に持っていないときだけ、サーバーの「まだ古いのがあるか」をそのまま使う
          // （持っているときは、最後に読み込んだときの結果のままにする）
          if (!historyRef.current.some(isOlder)) {
            setHasOlderHistory(Boolean(data.hasOlder));
          }

          setHistory((prev) => [
            ...prev.filter(isOlder),
            ...incoming,
          ]);

          break;
        }

        // さかのぼって頼んだ古い履歴が届いた。今の一覧の上に付け足す
        case "HISTORY_OLDER_RESPONSE": {
          const older = Array.isArray(data.history)
            ? data.history
            : [];

          setHistory((prev) => {
            const oldestId = prev.length > 0
              ? Number(prev[0].id)
              : Infinity;
            // 念のため、今の一覧より古いものだけを付け足す（重複を防ぐ）
            const toAdd = older.filter(
              (item) => Number(item.id) < oldestId
            );
            return [...toAdd, ...prev];
          });
          setHasOlderHistory(Boolean(data.hasOlder));
          setIsLoadingOlderHistory(false);

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
        "rounded",
        "diamond",
        "pentagon",
        "hexagon",
        "star",
        "arrow",
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

case "rounded": {
  newShape = {
    ...commonShape,
    width: 150,
    height: 100,
    fill: "#5b8def",
  };
  break;
}

case "diamond": {
  newShape = {
    ...commonShape,
    width: 120,
    height: 120,
    fill: "#a855f7",
  };
  break;
}

case "pentagon": {
  newShape = {
    ...commonShape,
    width: 120,
    height: 120,
    fill: "#10b981",
  };
  break;
}

case "hexagon": {
  newShape = {
    ...commonShape,
    width: 140,
    height: 120,
    fill: "#f59e0b",
  };
  break;
}

case "star": {
  newShape = {
    ...commonShape,
    width: 130,
    height: 130,
    fill: "#facc15",
  };
  break;
}

case "arrow": {
  newShape = {
    ...commonShape,
    width: 160,
    height: 100,
    fill: "#ef4444",
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


    // ========================================
// JSONファイルをサーバーに読み込ませる
// ========================================

const importCanvas = useCallback((objects) => {
  return new Promise((resolve, reject) => {

    const socket = socketService.socket;

    // サーバーとの接続確認
    if (!socket?.connected) {
      reject(
        new Error("サーバーに接続されていません。")
      );
      return;
    }

    // サーバーに読み込みを依頼
    socket.timeout(90000).emit(
      "canvas:import",
      { objects },

      (error, response) => {

        if (error) {
          reject(
            new Error(
              "サーバーから応答がありませんでした。"
            )
          );
          return;
        }

        // 読み込み失敗
        if (!response?.ok) {
          reject(
            new Error(
              response?.error ||
              "読み込みに失敗しました。"
            )
          );
          return;
        }

        // 読み込み成功
        resolve(response);
      }
    );
  });
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

  /*
   * さらに古い履歴を200件読み込む（編集履歴を一番上までスクロールしたときに呼ぶ）
   * 結果は HISTORY_OLDER_RESPONSE で届く
   */
  const loadOlderHistory = useCallback(() => {
    const current = historyRef.current;
    if (
      !hasOlderHistoryRef.current ||
      isLoadingOlderHistoryRef.current ||
      current.length === 0
    ) {
      return;
    }

    setIsLoadingOlderHistory(true);
    isLoadingOlderHistoryRef.current = true;

    socketService.sendMessage(
      "HISTORY_OLDER",
      {
        beforeId: current[0].id, // 今の一覧で一番古い履歴。これより古いものをもらう
      }
    );
  }, []);

return {
  shapes,
  history,
  hasOlderHistory,
  isLoadingOlderHistory,
  loadOlderHistory,
  userName,
  setUserName,
  addShape,
  updateRect,
  deleteRect,
  clearCanvas,
  undo,
  redo,
  jumpToHistory,
  importCanvas,
  exportCode,
  exportedFile,
};
}
