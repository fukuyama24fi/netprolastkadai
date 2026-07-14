//Neon 接続設定
const pool = new Pool({ //データベースへの接続情報を設定
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // SSL接続（Neonで必要）
});