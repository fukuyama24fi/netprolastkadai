import { useCallback, useEffect, useRef, useState } from "react";

import socketService from "../services/socketService";

/*
 * AIチャット用のフック
 * useCanvasSocket とは別にして、既存の通信処理には触らない
 *
 * サーバーとの約束（アクション名）
 *   送信: AI_CHAT  { requestId, message, chatHistory }
 *         AI_APPLY { requestId, operations }
 *   受信: AI_REPLY        { requestId, reply, operations, skipped }
 *         AI_ERROR        { requestId, message }
 *         AI_APPLY_RESULT { requestId, applied, skipped, error? }
 *
 * 会話は一人ずつ別。ブラウザ側だけで持ち、サーバーには直近の会話を毎回送る
 */

// サーバーに送る会話の往復数（サーバー側でも8件に切っている）
const MAX_HISTORY_FOR_SERVER = 8;
// AIの返事をこれ以上待ったら諦める（ミリ秒）
const REPLY_TIMEOUT_MS = 45000;

const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content:
    "こんにちは！作ってほしいデザインや、変えてほしいところを話しかけてね。例：「小さな家を描いて」「青い図形を全部赤にして」",
};

export function useAiChat() {
  // messages の1件の形
  // { id, role: "user" | "assistant" | "error", content,
  //   requestId?, operations?, applyStatus?: "ready" | "applying" | "applied" | "failed", applyResult? }
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [isWaiting, setIsWaiting] = useState(false);

  // 今返事を待っている requestId（古い返事を無視するため）
  const pendingRequestIdRef = useRef(null);
  const timeoutRef = useRef(null);

  const updateMessage = useCallback((matcher, changes) => {
    setMessages((prev) =>
      prev.map((m) => (matcher(m) ? { ...m, ...changes } : m))
    );
  }, []);

  const stopWaiting = useCallback(() => {
    pendingRequestIdRef.current = null;
    clearTimeout(timeoutRef.current);
    setIsWaiting(false);
  }, []);

  /*
   * サーバーからの受信
   */
  useEffect(() => {
    // useCanvasSocket が先に接続しているはずだが、念のため（2回呼んでも大丈夫な作り）
    socketService.connect();

    const handleMessage = (data) => {
      switch (data.action) {
        case "AI_REPLY": {
          if (data.requestId !== pendingRequestIdRef.current) {
            return; // 古い返事・他の人宛ては無視
          }
          stopWaiting();
          const operations = Array.isArray(data.operations)
            ? data.operations
            : [];
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: data.reply,
              requestId: data.requestId,
              operations,
              skipped: data.skipped ?? 0,
              applyStatus: operations.length > 0 ? "ready" : undefined,
            },
          ]);
          break;
        }

        case "AI_ERROR": {
          if (data.requestId !== pendingRequestIdRef.current) {
            return;
          }
          stopWaiting();
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "error",
              content: data.message || "AIとの通信に失敗しました",
            },
          ]);
          break;
        }

        case "AI_APPLY_RESULT": {
          const ok = !data.error && data.applied > 0;
          updateMessage(
            (m) => m.requestId === data.requestId && m.applyStatus === "applying",
            {
              applyStatus: ok ? "applied" : "failed",
              applyResult: {
                applied: data.applied ?? 0,
                skipped: data.skipped ?? 0,
                error: data.error,
              },
            }
          );
          break;
        }

        default:
          break; // それ以外は useCanvasSocket が処理する
      }
    };

    socketService.onMessage(handleMessage);
    return () => {
      socketService.offMessage(handleMessage);
      clearTimeout(timeoutRef.current);
    };
  }, [stopWaiting, updateMessage]);

  /*
   * AIに話しかける
   */
  const sendChat = useCallback(
    (text) => {
      const message = text.trim();
      if (!message || pendingRequestIdRef.current) {
        return false;
      }

      const requestId = crypto.randomUUID();

      // サーバーに送る会話履歴（エラーと最初のあいさつは送らない）
      const chatHistory = messages
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            m.id !== WELCOME_MESSAGE.id
        )
        .slice(-MAX_HISTORY_FOR_SERVER)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: message },
      ]);

      pendingRequestIdRef.current = requestId;
      setIsWaiting(true);

      // 返事が来ないまま固まらないようにする
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (pendingRequestIdRef.current !== requestId) return;
        stopWaiting();
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "error",
            content: "AIから返事がありませんでした。もう一度試してね",
          },
        ]);
      }, REPLY_TIMEOUT_MS);

      socketService.sendMessage("AI_CHAT", {
        requestId,
        message,
        chatHistory,
      });
      return true;
    },
    [messages, stopWaiting]
  );

  /*
   * AIの提案をキャンバスに反映する
   */
  const applyProposal = useCallback(
    (messageId) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target || !target.operations?.length) {
        return;
      }
      if (target.applyStatus === "applying" || target.applyStatus === "applied") {
        return; // 二重反映を防ぐ
      }

      updateMessage((m) => m.id === messageId, { applyStatus: "applying" });
      socketService.sendMessage("AI_APPLY", {
        requestId: target.requestId,
        operations: target.operations,
      });
    },
    [messages, updateMessage]
  );

  const clearChat = useCallback(() => {
    stopWaiting();
    setMessages([WELCOME_MESSAGE]);
  }, [stopWaiting]);

  return {
    messages,
    isWaiting,
    sendChat,
    applyProposal,
    clearChat,
  };
}
