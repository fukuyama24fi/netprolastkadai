// pg モジュールから Pool をインポート
import pkg from 'pg';
const { Pool } = pkg;

// Neon 接続設定
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // SSL接続（Neonで必要）
});

// 他のファイルで使えるように export
export { pool };