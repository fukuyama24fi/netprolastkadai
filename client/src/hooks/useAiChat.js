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
 *   6. 「元に戻す」ボタン → undoProposal() → AI_REVERT を送る
 *      サーバーは、その提案で変わった分だけを「逆の操作」で打ち消す（新しい編集として履歴に残る）
 *      後から他の人が変えた項目は触らない（AIが変えたままの項目だけ戻す）
 *   7. 元に戻した後にもう一度「元に戻す」を押すと、打ち消しをさらに打ち消して反映した状態に戻る
 *      これを何度でも行き来できる（提案ごとの Undo / Redo のように使える）
 *
 * サーバーとの約束（アクション名）
 *   送信: AI_CHAT  { requestId, message, chatHistory }
 *         AI_APPLY { requestId, operations }
 *         AI_REVERT { requestId, historyIds, mode: "undo" | "redo" }
 *   受信: AI_REPLY        { requestId, reply, operations, skipped, provider }
 *         AI_ERROR        { requestId, message }
 *         AI_APPLY_RESULT { requestId, applied, skipped, historyIds, error? }
 *         AI_REVERT_RESULT { requestId, ok, error?, reverted, kept, skipped, historyIds }
 *
 * operations（AIの提案）の1件の形
 *   { op: "add", type, x, y, width, height, fill, rotation, ...（textのときは text, fontSize なども） }
 *   { op: "update", id, changes: { 変える項目だけ } }
 *   { op: "delete", id }
 *   ※ サーバー側でチェック済みの形で届く。add にはまだ id が無い（反映するときにサーバーが付ける）
 *
 * 会話は一人ずつ別。ブラウザの localStorage に保存し、サーバーには直近の会話を毎回送る
 * （ページを再読み込みしても会話と提案カードは残る。「会話をリセット」で消える）
 * 保存はブラウザの userId ごと。Pikva の「人」の区別も同じ userId なので、DBに保存しても見える結果は同じ
 */

// サーバーに送る会話の件数（サーバー側でも8件に切っている）
const MAX_HISTORY_FOR_SERVER = 8;
// AIの返事をこれ以上待ったら諦める（ミリ秒）
const REPLY_TIMEOUT_MS = 45000;

// localStorage に保存する会話の最大件数（多すぎると保存できる容量を超えるため）
const MAX_SAVED_MESSAGES = 60;

// 最初に表示するあいさつ。AIには送らない（sendChat の中で除外している）
const WELCOME_MESSAGE = {
  id: "welcome",
  role: "assistant",
  content:
    "こんにちは！作ってほしいデザインや、変えてほしいところを話しかけてね。例：「小さな家を描いて」「青い図形を全部赤にして」",
};

// プレビュー用に保存する図形の項目（localStorage の容量を節約するため、描画に必要なものだけ）
const PREVIEW_FIELDS = [
  "id", "type", "x", "y", "width", "height", "fill", "text", "rotation",
  "fontSize", "fontWeight", "fontStyle", "textTransform", "zIndex",
];

// 図形の一覧を、プレビュー用の小さい形にコピーする
const snapshotShapes = (shapes) =>
  (shapes || []).map((shape) =>
    Object.fromEntries(PREVIEW_FIELDS.map((key) => [key, shape[key]]))
  );

// localStorage の保存場所の名前（ブラウザの userId ごとに分ける）
const getStorageKey = () => `pikva-ai-chat:${socketService.getUserId()}`;

// 保存しておいた会話を読み込む。無い・壊れているときは最初のあいさつだけにする
const loadSavedMessages = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(getStorageKey()) || "null");
    if (!Array.isArray(saved) || saved.length === 0) {
      return [WELCOME_MESSAGE];
    }
    // サーバーの返事待ちの途中で閉じた提案カードは、結果がわからないので状態を直しておく
    return saved.map((m) => {
      if (m.applyStatus === "applying") {
        return {
          ...m,
          applyStatus: "failed",
          applyResult: { error: "反映できたか確認できませんでした。キャンバスを確認してね" },
        };
      }
      if (m.applyStatus === "undoing") {
        return {
          ...m,
          applyStatus: m.revertFrom || "applied",
          undoError: "元に戻せたか確認できませんでした。キャンバスを確認してね",
        };
      }
      return m;
    });
  } catch {
    return [WELCOME_MESSAGE];
  }
};

export function useAiChat() {
  // 会話の一覧（画面に表示する吹き出しの元データ）
  // messages の1件の形
  // { id, role: "user" | "assistant" | "error", content,
  //   requestId?, operations?, skipped?,
  //   applyStatus?: "ready" | "applying" | "applied" | "failed" | "undoing" | "undone",
  //   applyResult?, undoError?, baseShapes?, currentHistoryIds?, lastAction?, revertFrom? }
  //
  //   role        : "user" = 自分の発言、"assistant" = AIの返事、"error" = エラー表示（赤い吹き出し）
  //   requestId   : どの AI_CHAT に対する返事か（反映結果と結びつけるのに使う）
  //   operations  : AIの提案（無い・空なら提案カードは出ない）
  //   applyStatus : 提案カードの状態
  //                   "ready"    = まだ反映していない（反映ボタンを表示）
  //                   "applying" = 反映中（サーバーの返事待ち）
  //                   "applied"  = 反映できた
  //                   "failed"   = 反映できなかった（もう一度ボタンを表示）
  //                   "undoing"  = 「元に戻す」の途中（サーバーの返事待ち）
  //                   "undone"   = 元に戻した（一部だけ戻した場合も含む）
  //                   applied と undone は「元に戻す」を押すたびに行き来する
  //   applyResult : 反映の結果 { applied: 反映できた数, skipped: できなかった数, historyIds: 記録された履歴のID, error? }
  //   undoError   : 「元に戻す」ができなかった理由（反映済みのまま、理由を表示する）
  //   baseShapes  : 反映した瞬間のキャンバス（反映後もプレビューを同じ絵で出すために保存しておく）
  //   currentHistoryIds : 次に「元に戻す」を押したときに打ち消す履歴のID（最後に行った反映・取り消し・やり直しの分）
  //   lastAction  : 最後に行ったこと { type: "apply" | "undo" | "redo", count: 変えた数, kept: 他の人が変えていたので残した数, skipped }
  //   revertFrom  : 「元に戻す」を押す前の状態（"applied" か "undone"）。失敗したときにこの状態に戻す
  //
  // 最初は localStorage に保存しておいた会話を読み込む（useState に関数を渡すと、最初の1回だけ実行される）
  const [messages, setMessages] = useState(loadSavedMessages);

  // 会話が変わるたびに localStorage に保存する（古いものから捨てて最大 MAX_SAVED_MESSAGES 件）
  useEffect(() => {
    try {
      localStorage.setItem(
        getStorageKey(),
        JSON.stringify(messages.slice(-MAX_SAVED_MESSAGES))
      );
    } catch {
      // 保存できなくても（容量オーバー・プライベートモードなど）チャット自体は使えるので何もしない
    }
  }, [messages]);

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
                historyIds: Array.isArray(data.historyIds) ? data.historyIds : [],
                error: data.error,
              },
              // 次に「元に戻す」を押したら、この反映で記録された分を打ち消す
              currentHistoryIds: Array.isArray(data.historyIds) ? data.historyIds : [],
              lastAction: { type: "apply", count: data.applied ?? 0, skipped: data.skipped ?? 0 },
            }
          );
          break;
        }

        // 「元に戻す」の結果が届いた
        // 図形そのものは ADD / UPDATE / DELETE で先に届いて useCanvasSocket が描画済み
        case "AI_REVERT_RESULT": {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.requestId !== data.requestId || m.applyStatus !== "undoing") {
                return m;
              }
              const before = m.revertFrom || "applied";
              const newIds = Array.isArray(data.historyIds) ? data.historyIds : [];

              // 失敗した（他の操作の処理中など）：元の状態に戻して理由を出す
              if (!data.ok) {
                return { ...m, applyStatus: before, undoError: data.error || "元に戻せませんでした" };
              }
              // 何も変えられなかった（全部、他の人が後から変えていた・既に消えていた）：状態はそのまま
              if (newIds.length === 0) {
                return {
                  ...m,
                  applyStatus: before,
                  undoError: "戻せる変更がありませんでした（他の人が後から変えたか、もう消えていました）",
                };
              }
              // 成功：反映済み ⇔ 元に戻した を入れ替え、次に打ち消す履歴を今回の分にする
              return {
                ...m,
                applyStatus: before === "applied" ? "undone" : "applied",
                undoError: undefined,
                currentHistoryIds: newIds,
                lastAction: {
                  type: before === "applied" ? "undo" : "redo",
                  count: data.reverted ?? 0,
                  kept: data.kept ?? 0,
                  skipped: data.skipped ?? 0,
                },
              };
            })
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
   * currentShapes: 今のキャンバスの図形（反映後もプレビューを出せるよう、反映した瞬間の状態を保存する）
   * サーバーが提案をもう一度チェックしてから反映する
   */
  const applyProposal = useCallback(
    (messageId, currentShapes) => {
      const target = messages.find((m) => m.id === messageId);
      if (!target || !target.operations?.length) {
        return;
      }
      if (target.applyStatus === "applying" || target.applyStatus === "applied") {
        return; // 二重反映を防ぐ
      }

      // ボタンを「反映中…」にして、結果（AI_APPLY_RESULT）を待つ
      updateMessage((m) => m.id === messageId, {
        applyStatus: "applying",
        baseShapes: snapshotShapes(currentShapes),
      });
      socketService.sendMessage("AI_APPLY", {
        requestId: target.requestId,
        operations: target.operations,
      });
    },
    [messages, updateMessage]
  );

  /*
   * 提案カードの「元に戻す」
   * messageId: 提案カードが付いている吹き出し（AIの返事）の id
   *   反映済み   → この提案で変わった分だけを打ち消す（元に戻す）
   *   元に戻した → 打ち消しをさらに打ち消す（反映した状態に戻す）
   * どちらもサーバーで「逆の操作」を新しい編集として行い、履歴に残る
   */
  const undoProposal = useCallback(
    (messageId) => {
      const target = messages.find((m) => m.id === messageId);
      // 前のバージョンで保存した会話には currentHistoryIds が無いので、反映時の履歴IDを使う
      const historyIds =
        target?.currentHistoryIds ?? target?.applyResult?.historyIds;
      const status = target?.applyStatus;
      if (!target || (status !== "applied" && status !== "undone") || !historyIds?.length) {
        return;
      }

      // ボタンを「処理中…」にして、結果（AI_REVERT_RESULT）を待つ
      updateMessage((m) => m.id === messageId, {
        applyStatus: "undoing",
        revertFrom: status,
        undoError: undefined,
      });
      socketService.sendMessage("AI_REVERT", {
        requestId: target.requestId,
        historyIds,
        mode: status === "applied" ? "undo" : "redo", // 履歴の名前（取り消し / やり直し）に使う
      });
    },
    [messages, updateMessage]
  );

  // 会話を最初のあいさつだけに戻す（キャンバスには影響しない。保存しておいた会話も消える）
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
    undoProposal,
    clearChat,
  };
}
