import { useEffect, useRef, useState } from "react";

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
 * 要約・プレビュー・反映ボタン（状態によって表示が変わる）をまとめたもの
 * message.applyStatus の意味は useAiChat.js の messages の説明を参照
 */
function ProposalCard({ message, onApply, shapes }) {
  const { operations, applyStatus, applyResult, skipped } = message;

  return (
    <div className="ai-proposal">
      {/* 何をするかの一行要約 */}
      <div className="ai-proposal-summary">
        {summarizeOperations(operations)}
      </div>

      {/* 反映前だけプレビューを出す（反映後は本物のキャンバスに出ているので不要） */}
      {applyStatus !== "applied" && (
        <ProposalPreview shapes={shapes} operations={operations} />
      )}

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

      {/* 反映できた */}
      {applyStatus === "applied" && (
        <div className="ai-proposal-done">
          {applyResult?.applied}件を反映しました
          {applyResult?.skipped > 0 && `（${applyResult.skipped}件はできませんでした）`}
          。戻すときは Undo で1つずつ戻せます
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
  shapes,
  messages,
  isWaiting,
  sendChat,
  applyProposal,
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
