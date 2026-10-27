import { useEffect, useRef, useState } from "react";

/*
 * 右サイドバーの「AIアシスタント」タブの中身
 * 状態は親（App）で useAiChat を呼んで渡してもらう
 * （タブを切り替えても会話が消えないようにするため）
 *
 * このコンポーネントは表示と入力だけを担当する
 * 通信（送信・受信）は useAiChat が行う
 *
 * 受け取るもの（props）
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
 * 要約と反映ボタン（状態によって表示が変わる）をまとめたもの
 * message.applyStatus の意味は useAiChat.js の messages の説明を参照
 */
function ProposalCard({ message, onApply, onUndo }) {
  const { operations, applyStatus, applyResult, skipped, undoError, revertResult } = message;

  return (
    <div className="ai-proposal">
      {/* 何をするかの一行要約 */}
      <div className="ai-proposal-summary">
        {summarizeOperations(operations)}
      </div>

      {/* AIが変な提案（存在しない図形の変更など）をして、サーバーが除外した数 */}
      {skipped > 0 && (
        <div className="ai-proposal-note">
          使えない提案が{skipped}件あったので除きました
        </div>
      )}

      {/* まだ反映していない */}
      {applyStatus === "ready" && (
        <button type="button" onClick={() => onApply(message.id)}>
          キャンバスに反映
        </button>
      )}

      {/* 反映中（サーバーの返事待ち）。二重に押せないよう無効にしておく */}
      {applyStatus === "applying" && (
        <button type="button" disabled>
          反映中…
        </button>
      )}

      {/* 反映できた。この提案の分だけを戻すボタンを出す（1つずつ戻したいときは今まで通り Undo や編集履歴でもできる） */}
      {applyStatus === "applied" && (
        <>
          <div className="ai-proposal-done">
            {applyResult?.applied}件を反映しました
            {applyResult?.skipped > 0 && `（${applyResult.skipped}件はできませんでした）`}
          </div>
          {/* 戻せなかった理由（他の操作の処理中だった、など） */}
          {undoError && <div className="ai-proposal-error">{undoError}</div>}
          {applyResult?.historyIds?.length > 0 && (
            <button
              type="button"
              className="ai-proposal-undo"
              onClick={() => onUndo(message.id)}
            >
              元に戻す
            </button>
          )}
        </>
      )}

      {/* 元に戻している途中 */}
      {applyStatus === "undoing" && (
        <button type="button" className="ai-proposal-undo" disabled>
          元に戻しています…
        </button>
      )}

      {/* 元に戻した。他の人が後から変えていた図形は残しているので、その数も出す */}
      {applyStatus === "undone" && (
        <div className="ai-proposal-note">
          {revertResult?.reverted > 0
            ? `${revertResult.reverted}件を元に戻しました`
            : "元に戻せる変更はありませんでした"}
          {revertResult?.kept > 0 &&
            `（${revertResult.kept}件は他の人が後から変えていたので、その部分は残しました）`}
        </div>
      )}

      {/* 反映できなかった（他の人のUndo中でロックされていた、など）。もう一度押せる */}
      {applyStatus === "failed" && (
        <>
          <div className="ai-proposal-error">
            {applyResult?.error || "反映できませんでした"}
          </div>
          <button type="button" onClick={() => onApply(message.id)}>
            もう一度反映
          </button>
        </>
      )}
    </div>
  );
}

export default function AiChatPanel({
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

  // 新しいメッセージが来たら一番下までスクロール
  useEffect(() => {
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
      <div className="ai-chat-messages">
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
