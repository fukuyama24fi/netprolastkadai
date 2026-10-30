-- データベースのCREATE TABLE権限がない場合は、DB管理者にNeonのSQL Editorで実行してもらう。
-- edit_historyにコメントを入れず、Undo/Redoから独立させる。
CREATE TABLE IF NOT EXISTS history_comments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name VARCHAR(30) NOT NULL,
  message VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
