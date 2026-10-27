import { useEffect, useLayoutEffect, useRef, useState } from "react";

import ProposalPreview from "./ProposalPreview";

/*
 * 右サイドバーの「AIアシスタント」タブの中身
 * 状態は親（App）で useAiChat を呼んで渡してもらう
 * （タブを切り替えても会話が消えないようにするため）
 *
 * このコンポーネントは表示と入力だけを担当する
 * 通信（送信・受信）は useAiChat が行う
 *
 * 受け取るもの（props）
 *   shapes        : 今のキャンバスの図形（プレビューを描くのに使う）
 *   messages      : 会話の一覧（useAiChat から）
 *   isWaiting     : AIの返事待ち中なら true
 *   sendChat      : AIに話しかける関数
 *   applyProposal : 提案をキャンバスに反映する関数
 *   undoProposal  : 反映した変更をまとめて元に戻す関数
 *   clearChat     : 会話をリセットする関数
 */

// 図形の種類を、提案カードに表示する日本語に変える
const TYPE_LABELS = {
  rect: "四角",
  circle: "円",
  triangle: "三角",
  text: "テキスト",
};

// 「四角2個を追加・1個を変更・1個を削除」のような要約を作る
// 追加は種類ごとに数え、変更と削除は個数だけ数える
function summarizeOperations(operations) {
  const added = {}; // { "四角": 2, "円": 1 } のように種類ごとの数
  let updated = 0;
  let deleted = 0;

  for (const op of operations) {
    if (op.op === "add") {
      const label = TYPE_LABELS[op.type] || op.type;
      added[label] = (added[label] || 0) + 1;
    } else if (op.op === "update") {
      updated += 1;
    } else if (op.op === "delete") {
      deleted += 1;
    }
  }

  const parts = Object.entries(added).map(
    ([label, count]) => `${label}${count}個を追加`
  );
  if (updated > 0) parts.push(`${updated}個を変更`);
  if (deleted > 0) parts.push(`${deleted}個を削除`);
  return parts.join("・");
}

/*
 * AIの返事の下に出る「提案カード」
 * 要約・プレビュー・今の状態・ボタン（状態によって表示が変わる）をまとめたもの
 * message.applyStatus の意味は useAiChat.js の messages の説明を参照
 */
function ProposalCard({ message, onApply, onUndo, shapes }) {
  const {
    operations,
    applyStatus,
    applyResult,
    skipped,
    undoError,
    baseShapes,
    currentHistoryIds,
    lastAction,
  } = message;

  // まだ反映していない間は、今のキャンバスに提案を当てはめてプレビューする（他の人の編集も反映される）
  // 反映した後は、反映した瞬間のキャンバス（baseShapes）を使う
  // （今のキャンバスを使うと、もうある図形をさらに足した絵になってしまうため）
  const isBeforeApply =
    applyStatus === "ready" || applyStatus === "applying" || applyStatus === "failed";
  const previewShapes = isBeforeApply ? shapes : baseShapes;

  // 「元に戻す」で打ち消す履歴（前のバージョンで保存した会話では反映時の履歴を使う）
  const undoTargetIds = currentHistoryIds ?? applyResult?.historyIds;
  const kept = lastAction?.kept ?? 0;

  return (
    <div className="ai-proposal">
      {/* 何をするかの一行要約 */}
      <div className="ai-proposal-summary">
        {summarizeOperations(operations)}
      </div>

      {/* プレビュー。反映した後も、元に戻した後も出し続ける */}
      {/* 前のバージョンで反映した提案は baseShapes が無いので出さない */}
      {previewShapes && (
        <ProposalPreview
          shapes={previewShapes}
          operations={operations}
          beforeLabel={isBeforeApply ? "今のキャンバス" : "反映前"}
        />
      )}

      {/* AIが変な提案（存在しない図形の変更など）をして、サーバーが除外した数 */}
      {skipped > 0 && (
        <div className="ai-proposal-note">
          使えない提案が{skipped}件あったので除きました
        </div>
      )}

      {/* まだ反映していない */}
      {applyStatus === "ready" && (
        <button type="button" onClick={() => onApply(message.id, shapes)}>
          キャンバスに反映
        </button>
      )}

      {/* 反映中（サーバーの返事待ち）。二重に押せないよう無効にしておく */}
      {applyStatus === "applying" && (
        <button type="button" disabled>
          反映中…
        </button>
      )}

      {/* 反映できなかった（他の人のUndo中でロックされていた、など）。もう一度押せる */}
      {applyStatus === "failed" && (
        <>
          <div className="ai-proposal-error">
            {applyResult?.error || "反映できませんでした"}
          </div>
          <button type="button" onClick={() => onApply(message.id, shapes)}>
            もう一度反映
          </button>
        </>
      )}

      {/* 反映済み：何件反映したか */}
      {applyStatus === "applied" && (
        <div className="ai-proposal-done">
          {lastAction?.type === "redo"
            ? `${lastAction.count}件を反映し直しました`
            : `${applyResult?.applied ?? 0}件を反映しました`}
          {lastAction?.type !== "redo" &&
            applyResult?.skipped > 0 &&
            `（${applyResult.skipped}件はできませんでした）`}
          {lastAction?.type === "redo" &&
            kept > 0 &&
            `（${kept}件は他の人が後から変えていたので、その部分は残しました）`}
        </div>
      )}

      {/* 元に戻した：何件戻したか。他の人が後から変えていた部分は残しているので、その数も出す */}
      {applyStatus === "undone" && (
        <div className="ai-proposal-note">
          {lastAction?.count ?? 0}件を元に戻しました
          {kept > 0 &&
            `（${kept}件は他の人が後から変えていたので、その部分は残しました）`}
        </div>
      )}

      {/* 「元に戻す」ができなかった理由（他の操作の処理中だった、など） */}
      {(applyStatus === "applied" || applyStatus === "undone") && undoError && (
        <div className="ai-proposal-error">{undoError}</div>
      )}

      {/* 「元に戻す」ボタン。反映済み ⇔ 元に戻した を押すたびに行き来する */}
      {(applyStatus === "applied" || applyStatus === "undone") &&
        undoTargetIds?.length > 0 && (
        <button
          type="button"
          className="ai-proposal-undo"
          onClick={() => onUndo(message.id)}
        >
          元に戻す
        </button>
      )}

      {/* 「元に戻す」の途中 */}
      {applyStatus === "undoing" && (
        <button type="button" className="ai-proposal-undo" disabled>
          処理中…
        </button>
      )}
    </div>
  );
}

export default function AiChatPanel({
  shapes,
  messages,
  isWaiting,
  sendChat,
  applyProposal,
  undoProposal,
  clearChat,
}) {
  // 入力欄の文字
  const [input, setInput] = useState("");
  // 会話の一番下の目印（ここまでスクロールさせる）
  const endRef = useRef(null);
  // 会話の一覧（スクロールする部分）
  const messagesRef = useRef(null);
  // タブを開いたときの会話（これと同じ間は、まだ新しいメッセージが来ていないということ）
  const initialMessagesRef = useRef(messages);

  // AIタブを開いたときは、アニメーションせずに最初から一番下（最新の会話）を表示する
  // useLayoutEffect は画面に描かれる前に動くので、上から流れていく様子が見えない
  useLayoutEffect(() => {
    const scroller = messagesRef.current;
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, []);

  // 新しいメッセージが来たら一番下までなめらかにスクロール（開いた直後は上で済ませているので何もしない）
  useEffect(() => {
    if (messages === initialMessagesRef.current && !isWaiting) {
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isWaiting]);

  // 送信ボタンを押したとき
  const handleSubmit = (event) => {
    event.preventDefault(); // フォーム送信でページが再読み込みされるのを防ぐ
    if (sendChat(input)) {
      setInput(""); // 送れたときだけ入力欄を空にする
    }
  };

  // 入力欄でキーを押したとき
  const handleKeyDown = (event) => {
    // 日本語入力の変換確定の Enter では送信しない
    // （isComposing は変換中、keyCode 229 は一部ブラウザで変換中を表す）
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    // Enter で送信、Shift+Enter で改行
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (sendChat(input)) {
        setInput("");
      }
    }
  };

  return (
    <div className="ai-chat">
      {/* 会話の一覧（ここだけスクロールする） */}
      <div className="ai-chat-messages" ref={messagesRef}>
        {messages.map((message) => (
          // role によって吹き出しの位置と色が変わる（App.css の .ai-message-user など）
          <div
            key={message.id}
            className={`ai-message ai-message-${message.role}`}
          >
            <div className="ai-message-bubble">{message.content}</div>

            {/* 提案があるAIの返事にだけ提案カードを付ける */}
            {message.operations?.length > 0 && (
              <ProposalCard
                message={message}
                onApply={applyProposal}
                onUndo={undoProposal}
                shapes={shapes}
              />
            )}
          </div>
        ))}

        {/* AIの返事待ちの間だけ出る仮の吹き出し */}
        {isWaiting && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-bubble ai-thinking">考え中…</div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* 入力欄（下に固定） */}
      <form className="ai-chat-form" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例：夜空に月と星を描いて"
          maxLength={300} // サーバー側でも300文字に切っている
          rows={3}
          disabled={isWaiting}
        />
        <div className="ai-chat-form-buttons">
          <button
            type="button"
            className="ai-chat-clear"
            onClick={clearChat}
            disabled={isWaiting}
          >
            会話をリセット
          </button>
          <button type="submit" disabled={isWaiting || !input.trim()}>
            送信
          </button>
        </div>
      </form>
    </div>
  );
}
