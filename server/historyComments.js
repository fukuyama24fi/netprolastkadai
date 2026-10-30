/**
 * 履歴コメント用の独立した Socket.IO チャンネル。
 * edit_history にコメントを混ぜると UNDO / REDO / 履歴ジャンプを壊すため、
 * history_comments テーブルに分けて永続化する。
 */
const COMMENT_LIMIT = 100;
const MAX_COMMENT_LENGTH = 500;
const MAX_NAME_LENGTH = 30;
const COOLDOWN_MS = 1500;

// 既存DBのcanvas_objects/edit_historyは変更しない。
export async function initializeHistoryComments(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history_comments (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name VARCHAR(30) NOT NULL,
      message VARCHAR(500) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function toClientRow(row) {
  return {
    id: String(row.id),
    userId: row.user_id,
    userName: row.user_name,
    message: row.message,
    createdAt: row.created_at,
  };
}

export function attachHistoryComments(socket, io, pool, getUserName, userId) {
  let lastSentAt = 0;

  // 履歴タブを開いたとき・再接続したときに過去100件を返す。
  socket.on("historyComments:list", async (_payload, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    try {
      const result = await pool.query(
        `SELECT * FROM (
           SELECT id, user_id, user_name, message, created_at
           FROM history_comments ORDER BY id DESC LIMIT $1
         ) AS recent ORDER BY id ASC`,
        [COMMENT_LIMIT]
      );
      acknowledge({ ok: true, comments: result.rows.map(toClientRow) });
    } catch (error) {
      console.error("コメント読み込みエラー:", error);
      acknowledge({ ok: false, error: "コメントを読み込めませんでした。" });
    }
  });

  socket.on("historyComments:add", async (data, acknowledge) => {
    const respond = typeof acknowledge === "function" ? acknowledge : () => {};
    const message = typeof data?.message === "string" ? data.message.trim() : "";

    if (!message || message.length > MAX_COMMENT_LENGTH) {
      respond({ ok: false, error: "コメントは1〜500文字で入力してください。" });
      return;
    }
    if (Date.now() - lastSentAt < COOLDOWN_MS) {
      respond({ ok: false, error: "連続投稿は少し時間を空けてください。" });
      return;
    }

    // SET_USERNAMEで更新された名前を採用。クライアント送信本文のuserNameは信用しない。
    const rawName = getUserName();
    const userName = typeof rawName === "string"
      ? (rawName.trim().slice(0, MAX_NAME_LENGTH) || "名無しさん")
      : "名無しさん";
    try {
      // 同一ソケットの二重送信対策。失敗したときはリトライ可能に戻す。
      lastSentAt = Date.now();
      const result = await pool.query(
        `INSERT INTO history_comments (user_id, user_name, message)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, user_name, message, created_at`,
        [String(userId), userName, message]
      );
      const comment = toClientRow(result.rows[0]);
      io.emit("historyComments:new", comment);
      respond({ ok: true });
    } catch (error) {
      lastSentAt = 0;
      console.error("コメント保存エラー:", error);
      respond({ ok: false, error: "コメントを保存できませんでした。" });
    }
  });
}
