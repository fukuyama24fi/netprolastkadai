import express from 'express'; //Webサーバーを構築
import { Server } from 'socket.io'; //リアルタイム通信を簡単にするためのライブラリ。WebSocketを使いやすくしたやつ
import http from 'http'; //HTTPサーバー機能（Socket.ioで必要）
import cors from 'cors'; //corsは別のドメインからの勝手なアクセスをブロックする
import pkg from 'pg'; //Neon接続用
import dotenv from 'dotenv'; //環境変数(DBのURLなど)を読み込むライブラリ


dotenv.config(); //.envファイルを適用
const { Pool } = pkg; //あらかじめ窓口を用意しておく
const app = express();
app.use(cors());
app.use(express.json());//JSON形式のリクエストを受け取れるようにする
const server = http.createServer(app);

//originは通信のチェック
//プロトコル(http, https),ホスト名(localhost, google.comなど), ポート番号(3000,8080など)のうち一つでも違うと外部とみなされる
//"*"はどの場所から来たアクセスでも全部許可する
// GETとPOST通信を許可
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"]
    }
});

//キャンバスの状態を保持する変数
let canvasState = [];

//Neon 接続設定
const pool = new Pool({ //データベースへの接続情報を設定
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // SSL接続（Neonで必要）
});

//許可する更新対象の列リスト
const ALLOWED_UPDATE_FIELDS = ['type', 'x', 'y', 'width', 'height', 'fill', 'text'];

//操作履歴をedit_historyテーブルに保存する関数
//?:プレースホルダーと同じ役割（SQLインジェクション対策）
async function saveEditHistory({ action, objectId, userId, changes }) {
    try {
        const result = await pool.query(
            `INSERT INTO edit_history (action, object_id, user_id, changes)
             VALUES ($1, $2, $3, $4)
             RETURNING action, object_id AS "objectId", user_id AS "userId", changes, created_at AS "createdAt"`,
            [action, objectId, userId, changes ? JSON.stringify(changes) : null]
        );
        return result.rows[0];
    } catch (err) {
        console.error("履歴の保存に失敗しました:", err);
    }
}

//新しく接続してきた人に、過去の操作履歴を送る関数
// 直近100件だけ取得（全件だと数が増えたとき重くなるので）
async function sendHistory(socket) {
    try {
        const result = await pool.query(
            `SELECT action, object_id AS "objectId", user_id AS "userId", changes, created_at AS "createdAt"
             FROM edit_history
             ORDER BY created_at DESC
             LIMIT 100`
        );
        socket.emit("message", {
            action: "HISTORY_RESPONSE",
            history: result.rows.reverse() //DESC(新しい順)で取ってきたので、古い順に並べ直してから渡す
        });
    } catch (err) {
        console.error("履歴の取得に失敗しました:", err);
    }
}

//サーバー起動時にDBから初期データを読み込む
async function startServer() {
    try {
        //DB接続確認
        //await:DBから返事が来るまで、次の行に進まない
        await pool.query("SELECT 1");
        console.log("データベース接続成功");

        //初期化完了を待ってからサーバー起動
        const res = await pool.query('SELECT * FROM canvas_objects');
        canvasState = res.rows;
        console.log(`初期データ読み込み完了 (${canvasState.length}件)`);

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`サーバーがポート ${process.env.PORT || 3000} で起動しました`);
        });
    } catch (err) {
        console.error("サーバー起動失敗:", err);
        process.exit(1);
    }


}
startServer(); //関数を実行


//接続・切断など各アクションの処理を一つにまとめたもの
io.on('connection', async (socket) => { // クライアントが1人接続してきたら実行
    //接続時にクライアントが送ってきたuserIdを取得（無ければsocket.idで代用）
    const connectedUserId = socket.handshake.query.userId || socket.id;
    console.log(`${socket.id} 接続しました (userId: ${connectedUserId})`);

    //接続した本人だけに、今のキャンバスの状態(全部)を渡す
    socket.emit("message", {
        action: "INIT",
        objects: canvasState
    });
    socket.emit("message", {
        action: "INIT",
        objects: canvasState
    });

    sendHistory(socket);

    //メッセージ受信とaction分岐
    socket.on("message", async (data) => { //クライアントからの操作を受信
        console.log("受信したアクション:", data.action, data);

        //送られてきたuserIdが無ければ接続時のIDを使う
        const userId = data.userId || connectedUserId;

        //メモリ(canvasState)の更新
        switch (data.action) {
            case "ADD":
                //ADDの重複チェック
                if (canvasState.find(obj => obj.id === data.object.id)) {
                    console.log("ID重複:", data.object.id);
                    break;
                }
                //DB保存したら同期
                try {
                    await pool.query(
                        'INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                        [data.object.id, data.object.type, data.object.x, data.object.y, data.object.width, data.object.height, data.object.fill, data.object.text]
                    );
                    canvasState.push(data.object);

                    const historyEntry = await saveEditHistory({
                        action: "ADD",
                        objectId: data.object.id,
                        userId,
                        changes: data.object
                    });

                    io.emit("message", { ...data, history: historyEntry }); //全員に送信
                } catch (err) {
                    console.error("ADD処理のDB保存エラー:", err);
                }
                break;

            case "UPDATE":
                if (!data.changes) {
                    break; //変更がなければスキップ
                }
                //許可された列のみを抽出する
                const updateData = {};
                for (const key of Object.keys(data.changes)) {
                    if (ALLOWED_UPDATE_FIELDS.includes(key)) {
                        updateData[key] = data.changes[key];
                    }
                }
                //変更項目が取得できなければスキップ
                if (Object.keys(updateData).length === 0) {
                    console.log("更新可能な項目がありません");
                    break;
                }

                //.find():配列の中から条件に一致する最初の1つを見つけて返すメソッド
                //その図形のidと今回の通信で送られてきた図形のidが一致するものを探している
                const obj = canvasState.find(obj => obj.id === data.id);
                if (!obj) { //updateするオブジェクトがあるか
                    console.log("オブジェクトが見つかりません:", data.id);
                    break;
                }

                try {
                    const keys = Object.keys(updateData)
                        .map((key, index) => `${key} = $${index + 2}`)
                        .join(",");
                    const values = Object.values(updateData);
                    await pool.query(
                        `UPDATE canvas_objects
                         SET ${keys}
                         WHERE id = $1`,
                        [data.id, ...values]
                    );

                    Object.assign(obj, updateData);
                    //履歴を保存
                    const historyEntry = await saveEditHistory({
                        action: "UPDATE",
                        objectId: data.id,
                        userId,
                        changes: data.changes
                    });
                    //全員に通知
                    io.emit("message", { ...data, history: historyEntry });

                } catch (err) {
                    console.error("UPDATE失敗:", err);
                }
                break;

            case "DELETE":
                try {
                    await pool.query('DELETE FROM canvas_objects WHERE id = $1', [data.id]);
                    //.filter():条件に一致するものだけを残してそれ以外を削除するメソッド
                    canvasState = canvasState.filter(obj => obj.id !== data.id);

                    const historyEntry = await saveEditHistory({
                        action: "DELETE",
                        objectId: data.id,
                        userId,
                        changes: null
                    });
                    io.emit("message", { ...data, history: historyEntry });
                } catch (err) {
                    console.error("DELETE処理のDB保存エラー:", err);
                }
                break;

            case "CLEAR":
                try {
                    await pool.query('DELETE FROM canvas_objects');
                    canvasState = [];
                    const historyEntry = await saveEditHistory({
                        action: "CLEAR",
                        objectId: null,
                        userId,
                        changes: null
                    });
                    io.emit("message", { ...data, history: historyEntry });
                } catch (err) {
                    console.error("CLEAR処理のDB保存エラー:", err);
                }
                break;

            default:
                console.log("存在しない操作です", data.action);
                return;
        }
    });

    //切断時にログを出す
    socket.on('disconnect', () => {
        console.log(`${socket.id} 接続が切断されました`);
    });
});

