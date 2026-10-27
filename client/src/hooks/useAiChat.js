import { useCallback, useEffect, useRef, useState } from "react";

import socketService from "../services/socketService";

/*
 * AIチャット用のフック
 * useCanvasSocket とは別にして、既存の通信処理には触らない
 *
 * 【このフックの役割】
 *   - AIとの会話（messages）を持つ
 *   - AIに話しかける（sendChat）
 *   - AIの提案をキャンバスに反映する（applyProposal）
 *   - サーバーから来たAI関係のメッセージだけを受け取って、会話に反映する
 *
 * 【流れ】
 *   1. sendChat("家を描いて") → サーバーに AI_CHAT を送る
 *   2. サーバーがAIに聞いて、頼んだ本人にだけ AI_REPLY を返す
 *      （この時点ではキャンバスはまだ何も変わらない）
 *   3. 画面の「キャンバスに反映」ボタン → applyProposal() → AI_APPLY を送る
 *   4. サーバーが図形を1つずつ追加・変更・削除して、全員に ADD / UPDATE / DELETE を送る
 *      （キャンバスへの反映は今まで通り useCanvasSocket が受け取って行う）
 *   5. 最後に頼んだ本人にだけ AI_APPLY_RESULT（何件反映できたか）が届く
 *
 * サーバーとの約束（アクション名）
 *   送信: AI_CHAT  { requestId, message, chatHistory }
 *         AI_APPLY { requestId, operations }
 *   受信: AI_REPLY        { requestId, reply, operations, skipped, provider }
 *         AI_ERROR        { requestId, message }
 *         AI_APPLY_RESULT { requestId, applied, skipped, error? }
 *
 * operations（AIの提案）の1件の形
 *   { op: "add", type, x, y, width, height, fill, rotation, ...（textのときは text, fontSize なども） }
 *   { op: "update", id, changes: { 変える項目だけ } }
 *   { op: "delete", id }
 *   ※ サーバー側でチェック済みの形で届く。add にはまだ id が無い（反映するときにサーバーが付ける）
 *
 * 会話は一人ずつ別。ブラウザ側だけで持ち、サーバーには直近の会話を毎回送る
 * （ページを再読み込みすると会話は消える）
 */

// サーバーに送る会話の件数（サーバー側でも8件に切っている）
const MAX_HISTORY_FOR_SERVER = 8;
// AIの返事をこれ以上待ったら諦める（ミリ秒）
const REPLY_TIMEOUT_MS = 45000;

// 最初に表示するあいさつ。AIには送らない（sendChat の中で除外している）
const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content:
    "こんにちは！作ってほしいデザインや、変えてほしいところを話しかけてね。例：「小さな家を描いて」「青い図形を全部赤にして」",
};

export function useAiChat() {
  // 会話の一覧（画面に表示する吹き出しの元データ）
  // messages の1件の形
  // { id, role: "user" | "assistant" | "error", content,
  //   requestId?, operations?, skipped?,
  //   applyStatus?: "ready" | "applying" | "applied" | "failed", applyResult? }
  //
  //   role        : "user" = 自分の発言、"assistant" = AIの返事、"error" = エラー表示（赤い吹き出し）
  //   requestId   : どの AI_CHAT に対する返事か（反映結果と結びつけるのに使う）
  //   operations  : AIの提案（無い・空なら提案カードは出ない）
  //   applyStatus : 提案カードの状態
  //                   "ready"    = まだ反映していない（反映ボタンを表示）
  //                   "applying" = 反映中（サーバーの返事待ち）
  //                   "applied"  = 反映できた
  //                   "failed"   = 反映できなかった（もう一度ボタンを表示）
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);

  // AIの返事を待っている間 true（入力欄を無効にして「考え中…」を出す）
  const [isWaiting, setIsWaiting] = useState(false);

  // 今返事を待っている requestId（古い返事を無視するため）
  // useState ではなく useRef にしているのは、受信処理（handleMessage）の中で
  // いつでも最新の値を読みたいから。useRef は値が変わっても再描画しない
  const pendingRequestIdRef = useRef(null);

  // 返事待ちのタイムアウト用タイマー
  const timeoutRef = useRef(null);

  // 条件に合うメッセージだけ、一部の項目を書き換える
  // 例: updateMessage((m) => m.id === "abc", { applyStatus: "applied" })
  const updateMessage = useCallback((matcher, changes) => {
    setMessages((prev) =>
      prev.map((m) => (matcher(m) ? { ...m, ...changes } : m))
    );
  }, []);

  // 返事待ちの状態を終わらせる（返事が来た・エラー・タイムアウト・リセットのとき）
  const stopWaiting = useCallback(() => {
    pendingRequestIdRef.current = null;
    clearTimeout(timeoutRef.current);
    setIsWaiting(false);
  }, []);

  /*
   * サーバーからの受信
   * socketService は1つの接続を useCanvasSocket と共有している
   * ここではAI関係のアクションだけを拾い、それ以外は無視する
   */
  useEffect(() => {
    // useCanvasSocket が先に接続しているはずだが、念のため（2回呼んでも大丈夫な作り）
    socketService.connect();

    const handleMessage = (data) => {
      switch (data.action) {
        // AIの返事（文章と提案）が届いた
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
              skipped: data.skipped ?? 0, // サーバーのチェックで除外された提案の数
              // 提案があるときだけ反映ボタンを出す。雑談だけの返事なら undefined
              applyStatus: operations.length > 0 ? "ready" : undefined,
            },
          ]);
          break;
        }

        // AIを呼べなかった（連打・混雑・通信失敗など）。message はサーバーが用意した表示用の文章
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

        // 「キャンバスに反映」の結果が届いた
        // 図形そのものは ADD / UPDATE / DELETE で先に届いて useCanvasSocket が描画済み
        // ここでは提案カードの表示（何件反映できたか）だけを更新する
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

    // 画面から消えるときに受信をやめる（二重に受け取らないように）
    return () => {
      socketService.offMessage(handleMessage);
      clearTimeout(timeoutRef.current);
    };
  }, [stopWaiting, updateMessage]);

  /*
   * AIに話しかける
   * 送れたら true、送れなかったら（空文字・返事待ち中）false を返す
   * 呼び出し側は true のときだけ入力欄を空にする
   */
  const sendChat = useCallback(
    (text) => {
      const message = text.trim();
      if (!message || pendingRequestIdRef.current) {
        return false;
      }

      // この発言の番号。返事（AI_REPLY / AI_ERROR）にも同じ番号が付いて返ってくる
      const requestId = crypto.randomUUID();

      // サーバーに送る会話履歴（エラーと最初のあいさつは送らない）
      // AIは前の会話を覚えていないので、「さっきの家に窓を付けて」のような続きの依頼が通じるように毎回送る
      const chatHistory = messages
        .filter(
          (m) =>
            (m.role === "user" || m.role === "assistant") &&
            m.id !== WELCOME_MESSAGE.id
        )
        .slice(-MAX_HISTORY_FOR_SERVER)
        .map((m) => ({ role: m.role, content: m.content }));

      // 自分の発言を先に画面に出す
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", content: message },
      ]);

      pendingRequestIdRef.current = requestId;
      setIsWaiting(true);

      // 返事が来ないまま固まらないようにする
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        // もう返事が来ている（別の発言を待っている）なら何もしない
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
   * messageId: 提案カードが付いている吹き出し（AIの返事）の id
   * サーバーが提案をもう一度チェックしてから反映する
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

      // ボタンを「反映中…」にして、結果（AI_APPLY_RESULT）を待つ
      updateMessage((m) => m.id === messageId, { applyStatus: "applying" });
      socketService.sendMessage("AI_APPLY", {
        requestId: target.requestId,
        operations: target.operations,
      });
    },
    [messages, updateMessage]
  );

  // 会話を最初のあいさつだけに戻す（キャンバスには影響しない）
  const clearChat = useCallback(() => {
    stopWaiting();
    setMessages([WELCOME_MESSAGE]);
  }, [stopWaiting]);

  // App から AiChatPanel にそのまま渡す（<AiChatPanel {...aiChat} />）
  return {
    messages,
    isWaiting,
    sendChat,
    applyProposal,
    clearChat,
  };
}
