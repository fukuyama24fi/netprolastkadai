import { useCallback, useEffect, useRef, useState } from "react";
import socketService from "../services/socketService";
import "./HistoryComments.css";

const MAX_COMMENT_LENGTH = 500;
const KEEP_LAST = 100;

function mergeRecentComments(previous, incoming) {
  const merged = new Map();
  for (const comment of [...previous, ...incoming]) {
    if (comment && comment.id != null && typeof comment.message === "string") {
      merged.set(String(comment.id), comment);
    }
  }
  return [...merged.values()]
    .sort((a, b) => Number(a.id) - Number(b.id))
    .slice(-KEEP_LAST);
}

function formatTime(dateString) {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime())
    ? "--:--"
    : new Intl.DateTimeFormat("ja-JP", {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(date);
}

/** 編集履歴タブ内の共同コメント欄。履歴ジャンプ/Undoには影響しない。 */
export default function HistoryComments({ userName }) {
  const [comments, setComments] = useState([]);
  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const socketRef = useRef(null);

  const fetchComments = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    setLoading(true);
    socket.timeout(10000).emit("historyComments:list", {}, (timeoutError, response) => {
      setLoading(false);
      if (timeoutError || !response?.ok || !Array.isArray(response.comments)) {
        setError(response?.error || "コメントを取得できません。サーバー側の更新を確認してください。");
        return;
      }
      setError("");
      setComments((prev) => mergeRecentComments(prev, response.comments));
    });
  }, []);

  useEffect(() => {
    socketService.connect();
    const socket = socketService.socket;
    if (!socket) return;
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      setConnectionError("");
      fetchComments();
    };
    const onConnectError = (error) => {
      setConnected(false);
      setLoading(false);
      console.warn("コメント用Socket.IO接続失敗:", error?.message);
      setConnectionError("サーバーとの接続に失敗しました。公開時はVITE_SERVER_URLとRenderの稼働状態を確認してください。");
    };
    const onDisconnect = () => {
      setConnected(false);
      setLoading(false);
    };
    const onNewComment = (comment) => {
      setComments((prev) => mergeRecentComments(prev, [comment]));
    };

    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    socket.on("disconnect", onDisconnect);
    socket.on("historyComments:new", onNewComment);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
      socket.off("disconnect", onDisconnect);
      socket.off("historyComments:new", onNewComment);
      socketRef.current = null;
    };
  }, [fetchComments]);

  // 新しい投稿が来たときだけコメント欄を下にスクロール。
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [comments.length]);

  const submitComment = (event) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending || !connected) return;
    if (text.length > MAX_COMMENT_LENGTH) {
      setError("コメントは500文字以内で入力してください。");
      return;
    }
    const socket = socketRef.current;
    if (!socket?.connected) return;
    setSending(true);
    setError("");
    socket.timeout(10000).emit("historyComments:add", { message: text }, (timeoutError, response) => {
      setSending(false);
      if (timeoutError || !response?.ok) {
        setError(response?.error || "送信できませんでした。通信を確認して再試行してください。");
        return;
      }
      // サーバーがDBに保存できたときだけ入力を消す。
      setMessage((current) => current === message ? "" : current);
    });
  };

  return (
    <section className="pikva-comments" aria-label="共同コメント">
      <div className="pikva-comments__heading">
        <strong>会話一覧</strong>
        <span className={connected ? "is-connected" : ""}>
          {connected ? "接続中" : "未接続"}
        </span>
      </div>
      <p className="pikva-comments__help">
        編集について相談できます。コメントは共同で表示・保存され、Undoでは消えません。
      </p>
      <div className="pikva-comments__list" ref={listRef} role="log" aria-live="polite">
        {loading && comments.length === 0 ? (
          <p className="pikva-comments__empty">コメントを読み込み中…</p>
        ) : comments.length === 0 ? (
          <p className="pikva-comments__empty">まだコメントはありません。</p>
        ) : comments.map((comment) => (
          <div className="pikva-comments__item" key={String(comment.id)}>
            <div className="pikva-comments__meta">
              <b>{comment.userName || "名無しさん"}</b>
              <time dateTime={comment.createdAt}>{formatTime(comment.createdAt)}</time>
            </div>
            <p>{comment.message}</p>
          </div>
        ))}
      </div>
      <form onSubmit={submitComment} className="pikva-comments__form">
        <label htmlFor="pikva-comment-text">{userName || "名無しさん"}としてコメント</label>
        <textarea
          id="pikva-comment-text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="例：もう少しマイクラっぽくしてもいいんじゃない？"
          maxLength={MAX_COMMENT_LENGTH}
          rows={2}
        />
        <div className="pikva-comments__actions">
          <small>{message.length}/{MAX_COMMENT_LENGTH}</small>
          <button type="submit" disabled={!connected || sending || !message.trim()}>
            {sending ? "送信中…" : "送信"}
          </button>
        </div>
      </form>
      {!connected && connectionError && (
        <div className="pikva-comments__error" role="alert">
          {connectionError}
          <button type="button" onClick={() => socketRef.current?.connect()}>再接続</button>
        </div>
      )}
      {error && (
        <div className="pikva-comments__error" role="alert">
          <span>{error}</span>
          {connected && (
            <button type="button" onClick={fetchComments}>再読み込み</button>
          )}
        </div>
      )}
    </section>
  );
}
