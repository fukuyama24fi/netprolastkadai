import { useEffect, useRef, useState } from "react";

/*
 * 右サイドバーの「AI」タブの中身
 * 状態は親（App）で useAiChat を呼んで渡してもらう
 * （タブを切り替えても会話が消えないようにするため）
 */

const TYPE_LABELS = {
  rect: "四角",
  circle: "円",
  triangle: "三角",
  text: "テキスト",
};

// 「四角を2個追加・色を1個変更」のような要約を作る
function summarizeOperations(operations) {
  const added = {};
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

function ProposalCard({ message, onApply }) {
  const { operations, applyStatus, applyResult, skipped } = message;

  return (
    <div className="ai-proposal">
      <div className="ai-proposal-summary">
        {summarizeOperations(operations)}
      </div>

      {skipped > 0 && (
        <div className="ai-proposal-note">
          使えない提案が{skipped}件あったので除きました
        </div>
      )}

      {applyStatus === "ready" && (
        <button type="button" onClick={() => onApply(message.id)}>
          キャンバスに反映
        </button>
      )}

      {applyStatus === "applying" && (
        <button type="button" disabled>
          反映中…
        </button>
      )}

      {applyStatus === "applied" && (
        <div className="ai-proposal-done">
          {applyResult?.applied}件を反映しました
          {applyResult?.skipped > 0 && `（${applyResult.skipped}件はできませんでした）`}
          。戻すときは Undo で1つずつ戻せます
        </div>
      )}

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
  clearChat,
}) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  // 新しいメッセージが来たら一番下までスクロール
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isWaiting]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (sendChat(input)) {
      setInput("");
    }
  };

  const handleKeyDown = (event) => {
    // 日本語入力の変換確定の Enter では送信しない
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
      <div className="ai-chat-messages">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`ai-message ai-message-${message.role}`}
          >
            <div className="ai-message-bubble">{message.content}</div>

            {message.operations?.length > 0 && (
              <ProposalCard message={message} onApply={applyProposal} />
            )}
          </div>
        ))}

        {isWaiting && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-bubble ai-thinking">考え中…</div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <form className="ai-chat-form" onSubmit={handleSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例：夜空に月と星を描いて"
          maxLength={300}
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
