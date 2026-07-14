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
const userNames = {}; //ユーザー名(ID,ユーザ名)

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

//  Undo/Redo用のポインター方式メモリ変数 (NEW)
let historyList = [];        //DBのedit_historyをキャッシュした配列
let historyPointer = -1;     //現在指している位置（配列のindex）

//Neon 接続設定
const pool = new Pool({ //データベースへの接続情報を設定
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // SSL接続（Neonで必要）
});

//許可する更新対象の列リスト
const ALLOWED_UPDATE_FIELDS = ['type', 'x', 'y', 'width', 'height', 'fill', 'text'];

//操作履歴をedit_historyテーブルに保存する関数
//?:プレースホルダーと同じ役割（SQLインジェクション対策）
//履歴保存関数(efore/after分離)
async function saveEditHistory({ action, objectId, userId, userName, before, after }) {
    try {
        const result = await pool.query(
            `INSERT INTO edit_history (action, object_id, user_id, user_name, before, after)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, action, object_id AS "objectId", user_id AS "userId", user_name AS "userName", 
              before, after, created_at AS "createdAt"`,
            [action, objectId, userId, userName,
                before ? JSON.stringify(before) : null,
                after ? JSON.stringify(after) : null]
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
            `SELECT 
                h.id,
                h.action, 
                h.object_id AS "objectId", 
                h.user_id AS "userId", 
                h.user_name AS "userName", 
                h.before, 
                h.after,
                h.created_at AS "createdAt"
             FROM edit_history
             ORDER BY h.created_at DESC
             LIMIT 100`
        );

        //psqlのpgライブラリはJSONBを自動的にオブジェクトに変換する
        const formattedHistory = result.rows.map(row => ({
            id: row.id,
            action: row.action,
            objectId: row.objectId,
            userId: row.userId,
            userName: row.userName,
            before: row.before,
            after: row.after,
            revertedEntryId: row.revertedEntryId,
            originalAction: row.originalAction,
            createdAt: row.createdAt
        }));

        socket.emit("message", {
            action: "HISTORY_RESPONSE",
            history: formattedHistory.reverse()
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
        //canvas_objects を読み込む
        const res = await pool.query('SELECT * FROM canvas_objects');
        canvasState = res.rows;
        console.log(`初期データ読み込み完了 (${canvasState.length}件)`);

        //NEW: edit_history をメモリに読み込む
        const historyRes = await pool.query(
            `SELECT * FROM edit_history ORDER BY id ASC` // 古い順に読み込む
        );
        historyList = historyRes.rows.map(row => ({
            id: row.id,
            action: row.action,
            objectId: row.object_id,
            userId: row.user_id,
            userName: row.user_name,
            before: row.before,
            after: row.after,
            createdAt: row.created_at
        }));
        //ポインターを最新の状態に設定（起動時は常に最新）
        historyPointer = historyList.length - 1;
        console.log(`履歴読み込み完了 (${historyList.length}件), pointer: ${historyPointer}`);

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
    const connectedUserName = socket.handshake.query.userName || "名無しさん";
    userNames[connectedUserId] = connectedUserName;
    console.log(`${socket.id} 接続しました (userId: ${connectedUserId}),, userName: ${connectedUserName})`);

    //接続した本人だけに、今のキャンバスの状態(全部)を渡す
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
        const userName = userNames[userId] || connectedUserName;

        //メモリ(canvasState)の更新
        switch (data.action) {
            case "SET_USERNAME":
                userNames[userId] = data.userName;
                io.emit("message", { action: "USER_RENAMED", userId, userName: data.userName });
                break;

            case "ADD": {
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

                    //新しい編集が来たら、ポインター後ろを削除
                    if (historyPointer < historyList.length - 1) {
                        //ポインター以降のデータをDBからも削除
                        const idsToDelete = historyList.slice(historyPointer + 1).map(h => h.id);
                        if (idsToDelete.length > 0) {
                            await pool.query(
                                `DELETE FROM edit_history WHERE id = ANY($1)`,
                                [idsToDelete]
                            );
                        }
                        // メモリ上のhistoryListも削除
                        historyList = historyList.slice(0, historyPointer + 1);
                    }

                    //履歴に記録
                    const historyEntry = await saveEditHistory({
                        action: "ADD",
                        objectId: data.object.id,
                        userId,
                        userName,
                        before: null, //Undo・redo用
                        after: data.object
                    });

                    //メモリのhistoryListに追加してポインター更新
                    historyList.push({
                        id: historyEntry.id,
                        action: historyEntry.action,
                        objectId: historyEntry.objectId,
                        userId: historyEntry.userId,
                        userName: historyEntry.userName,
                        before: historyEntry.before,
                        after: historyEntry.after,
                        createdAt: historyEntry.createdAt
                    });
                    historyPointer = historyList.length - 1;

                    io.emit("message", { ...data, history: historyEntry }); //全員に送信
                } catch (err) {
                    console.error("ADD処理のDB保存エラー:", err);
                }
                break;
            }

            case "UPDATE": {
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
                    //ポインター後ろを削除
                    if (historyPointer < historyList.length - 1) {
                        const idsToDelete = historyList.slice(historyPointer + 1).map(h => h.id);
                        if (idsToDelete.length > 0) {
                            await pool.query(
                                `DELETE FROM edit_history WHERE id = ANY($1)`,
                                [idsToDelete]
                            );
                        }
                        historyList = historyList.slice(0, historyPointer + 1);
                    }

                    // 変更前の状態を保存（undo用）
                    const beforeState = { ...obj };

                    // DB更新
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

                    // メモリ更新
                    Object.assign(obj, updateData);

                    //履歴を保存
                    const historyEntry = await saveEditHistory({
                        action: "UPDATE",
                        objectId: data.id,
                        userId,
                        userName,
                        before: beforeState,
                        after: obj
                    });
                    historyList.push({
                        id: historyEntry.id,
                        action: historyEntry.action,
                        objectId: historyEntry.objectId,
                        userId: historyEntry.userId,
                        userName: historyEntry.userName,
                        before: historyEntry.before,
                        after: historyEntry.after,
                        createdAt: historyEntry.createdAt
                    });
                    historyPointer = historyList.length - 1;

                    //全員に通知
                    io.emit("message", { ...data, history: historyEntry });

                } catch (err) {
                    console.error("UPDATE失敗:", err);
                }
                break;
            }

            case "DELETE": {
                try {
                    //ポインター後ろを削除
                    if (historyPointer < historyList.length - 1) {
                        const idsToDelete = historyList.slice(historyPointer + 1).map(h => h.id);
                        if (idsToDelete.length > 0) {
                            await pool.query(
                                `DELETE FROM edit_history WHERE id = ANY($1)`,
                                [idsToDelete]
                            );
                        }
                        historyList = historyList.slice(0, historyPointer + 1);
                    }

                    // 削除前のオブジェクトを保存（undo用）
                    const deletedObj = canvasState.find(obj => obj.id === data.id); //消す前に保持
                    //DB削除
                    await pool.query('DELETE FROM canvas_objects WHERE id = $1', [data.id]);
                    //.filter():条件に一致するものだけを残してそれ以外を削除するメソッド
                    //メモリ削除
                    canvasState = canvasState.filter(obj => obj.id !== data.id);

                    const historyEntry = await saveEditHistory({
                        action: "DELETE",
                        objectId: data.id,
                        userId,
                        userName,
                        before: deletedObj, //削除前のオブジェクト
                        after: null
                    });

                    historyList.push({
                        id: historyEntry.id,
                        action: historyEntry.action,
                        objectId: historyEntry.objectId,
                        userId: historyEntry.userId,
                        userName: historyEntry.userName,
                        before: historyEntry.before,
                        after: historyEntry.after,
                        createdAt: historyEntry.createdAt
                    });
                    historyPointer = historyList.length - 1;

                    io.emit("message", { ...data, history: historyEntry });
                } catch (err) {
                    console.error("DELETE処理のDB保存エラー:", err);
                }
                break;
            }

            case "CLEAR": {
                try {
                    //ポインター後ろを削除 
                    if (historyPointer < historyList.length - 1) {
                        const idsToDelete = historyList.slice(historyPointer + 1).map(h => h.id);
                        if (idsToDelete.length > 0) {
                            await pool.query(
                                `DELETE FROM edit_history WHERE id = ANY($1)`,
                                [idsToDelete]
                            );
                        }
                        historyList = historyList.slice(0, historyPointer + 1);
                    }

                    //[...] はスプレッド構文。消える前の全オブジェクト配列をコピーして保持
                    // クリア前の全オブジェクトを保存（undo用）
                    const beforeObjects = [...canvasState];
                    await pool.query('DELETE FROM canvas_objects');
                    //メモリクリア
                    canvasState = [];
                    const historyEntry = await saveEditHistory({
                        action: "CLEAR",
                        objectId: null,
                        userId,
                        userName,
                        before: beforeObjects,
                        after: null
                    });

                    historyList.push({
                        id: historyEntry.id,
                        action: historyEntry.action,
                        objectId: historyEntry.objectId,
                        userId: historyEntry.userId,
                        userName: historyEntry.userName,
                        before: historyEntry.before,
                        after: historyEntry.after,
                        createdAt: historyEntry.createdAt
                    });
                    historyPointer = historyList.length - 1;

                    io.emit("message", { ...data, history: historyEntry });
                } catch (err) {
                    console.error("CLEAR処理のDB保存エラー:", err);
                }
                break;
            }

            case "UNDO": {
                try {
                    // ポインターが0未満なら戻れない
                    if (historyPointer < 0) {
                        console.log("Undo対象がありません");
                        break;
                    }

                    // 現在のポインター位置の履歴を取得
                    const targetEntry = historyList[historyPointer];

                    if (!targetEntry) {
                        console.log("Undo対象がありません");
                        break;
                    }

                    let broadcastAction;

                    //逆操作を実行
                    switch (targetEntry.action) {
                        case "ADD": {
                            // ADD を取り消す → DELETE
                            await pool.query('DELETE FROM canvas_objects WHERE id = $1', [targetEntry.objectId]);
                            canvasState = canvasState.filter(obj => obj.id !== targetEntry.objectId);
                            broadcastAction = { action: "DELETE", id: targetEntry.objectId };
                            break;
                        }

                        case "UPDATE": {
                            // UPDATE を取り消す → 変更前の状態で上書き
                            const beforeData = targetEntry.before;
                            await pool.query(
                                `UPDATE canvas_objects SET x = $1, y = $2, width = $3, height = $4, fill = $5, text = $6 WHERE id = $7`,
                                [beforeData.x, beforeData.y, beforeData.width, beforeData.height, beforeData.fill, beforeData.text, targetEntry.objectId]
                            );
                            const obj = canvasState.find(o => o.id === targetEntry.objectId);
                            Object.assign(obj, beforeData);
                            broadcastAction = { action: "UPDATE", id: targetEntry.objectId, changes: beforeData };
                            break;
                        }

                        case "DELETE": {
                            // DELETE を取り消す → 復元
                            const beforeData = targetEntry.before;
                            await pool.query(
                                `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                [beforeData.id, beforeData.type, beforeData.x, beforeData.y, beforeData.width, beforeData.height, beforeData.fill, beforeData.text]
                            );
                            canvasState.push(beforeData);
                            broadcastAction = { action: "ADD", object: beforeData };
                            break;
                        }

                        case "CLEAR": {
                            // CLEAR を取り消す → 全復元
                            const beforeArray = targetEntry.before;
                            await pool.query('DELETE FROM canvas_objects');
                            for (const obj of beforeArray) {
                                await pool.query(
                                    `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                    [obj.id, obj.type, obj.x, obj.y, obj.width, obj.height, obj.fill, obj.text]
                                );
                            }
                            canvasState = beforeArray;
                            broadcastAction = { action: "INIT", objects: beforeArray };
                            break;
                        }
                    }

                    // ポインターを1つ戻す
                    historyPointer--;
                    console.log(`UNDO実行: pointer ${historyPointer + 1} → ${historyPointer}`);

                    //INIT形式でキャンバス全体を再同期する
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    console.error("UNDO処理失敗:", err);
                }
                break;
            }


            case "REDO": {
                try {
                    // ポインターが最後の1つ手前以降なら進めない
                    if (historyPointer >= historyList.length - 1) {
                        console.log("Redo対象がありません");
                        break;
                    }

                    // 次のポインター位置の履歴を取得
                    const targetEntry = historyList[historyPointer + 1];

                    if (!targetEntry) {
                        console.log("Redo対象がありません");
                        break;
                    }

                    let broadcastAction;

                    //元の操作をもう一度実行
                    switch (targetEntry.action) {
                        case "ADD": {
                            const obj = targetEntry.after;
                            await pool.query(
                                `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                [obj.id, obj.type, obj.x, obj.y, obj.width, obj.height, obj.fill, obj.text]
                            );
                            canvasState.push(obj);
                            broadcastAction = { action: "ADD", object: obj };
                            break;
                        }

                        case "UPDATE": {
                            const afterData = targetEntry.after;
                            await pool.query(
                                `UPDATE canvas_objects SET x = $1, y = $2, width = $3, height = $4, fill = $5, text = $6 WHERE id = $7`,
                                [afterData.x, afterData.y, afterData.width, afterData.height, afterData.fill, afterData.text, targetEntry.objectId]
                            );
                            const obj = canvasState.find(o => o.id === targetEntry.objectId);
                            Object.assign(obj, afterData);
                            broadcastAction = { action: "UPDATE", id: targetEntry.objectId, changes: afterData };
                            break;
                        }

                        case "DELETE": {
                            await pool.query('DELETE FROM canvas_objects WHERE id = $1', [targetEntry.objectId]);
                            canvasState = canvasState.filter(obj => obj.id !== targetEntry.objectId);
                            broadcastAction = { action: "DELETE", id: targetEntry.objectId };
                            break;
                        }

                        case "CLEAR": {
                            await pool.query('DELETE FROM canvas_objects');
                            canvasState = [];
                            broadcastAction = { action: "CLEAR" };
                            break;
                        }
                    }

                    // ポインターを1つ進める
                    historyPointer++;
                    console.log(`REDO実行: pointer ${historyPointer - 1} → ${historyPointer}`);

                    //INIT形式でキャンバス全体を再同期する
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    console.error("REDO処理失敗:", err);
                }
                break;
            }

            // 履歴からのジャンプ機能（内部でN回ループしてから最終状態を配信）
            case "JUMP_TO_HISTORY": {
                try {
                    const targetHistoryId = data.targetId; //ジャンプ先の履歴ID

                    if (!targetHistoryId) {
                        console.log("targetIdが指定されていません");
                        break;
                    }

                    // targetIdをhistoryListから検索して、その配列インデックスを取得
                    const targetIndex = historyList.findIndex(h => h.id === targetHistoryId);

                    if (targetIndex === -1) {
                        console.log("指定された履歴が見つかりません:", targetHistoryId);
                        break;
                    }

                    if (targetIndex === historyPointer) {
                        console.log("すでにその状態です");
                        break;
                    }

                    //ポインターを動かしながら逆操作を実行
                    if (targetIndex < historyPointer) {
                        // 戻る方向: targetIndex から historyPointer までを逆順で UNDO
                        for (let i = historyPointer; i > targetIndex; i--) {
                            const entry = historyList[i];

                            switch (entry.action) {
                                case "ADD": {
                                    await pool.query('DELETE FROM canvas_objects WHERE id = $1', [entry.objectId]);
                                    canvasState = canvasState.filter(obj => obj.id !== entry.objectId);
                                    break;
                                }

                                case "UPDATE": {
                                    const beforeData = entry.before;
                                    await pool.query(
                                        `UPDATE canvas_objects SET x = $1, y = $2, width = $3, height = $4, fill = $5, text = $6 WHERE id = $7`,
                                        [beforeData.x, beforeData.y, beforeData.width, beforeData.height, beforeData.fill, beforeData.text, entry.objectId]
                                    );
                                    const obj = canvasState.find(o => o.id === entry.objectId);
                                    if (obj) Object.assign(obj, beforeData);
                                    break;
                                }

                                case "DELETE": {
                                    const beforeData = entry.before;
                                    await pool.query(
                                        `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                        [beforeData.id, beforeData.type, beforeData.x, beforeData.y, beforeData.width, beforeData.height, beforeData.fill, beforeData.text]
                                    );
                                    canvasState.push(beforeData);
                                    break;
                                }

                                case "CLEAR": {
                                    const beforeArray = entry.before;
                                    await pool.query('DELETE FROM canvas_objects');
                                    for (const obj of beforeArray) {
                                        await pool.query(
                                            `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                            [obj.id, obj.type, obj.x, obj.y, obj.width, obj.height, obj.fill, obj.text]
                                        );
                                    }
                                    canvasState = beforeArray;
                                    break;
                                }
                            }
                        }
                    } else {
                        // 進む方向:historyPointerからtargetIndexまでを順番にREDO
                        for (let i = historyPointer + 1; i <= targetIndex; i++) {
                            const entry = historyList[i];

                            switch (entry.action) {
                                case "ADD": {
                                    const obj = entry.after;
                                    await pool.query(
                                        `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                        [obj.id, obj.type, obj.x, obj.y, obj.width, obj.height, obj.fill, obj.text]
                                    );
                                    canvasState.push(obj);
                                    break;
                                }

                                case "UPDATE": {
                                    const afterData = entry.after;
                                    await pool.query(
                                        `UPDATE canvas_objects SET x = $1, y = $2, width = $3, height = $4, fill = $5, text = $6 WHERE id = $7`,
                                        [afterData.x, afterData.y, afterData.width, afterData.height, afterData.fill, afterData.text, entry.objectId]
                                    );
                                    const obj = canvasState.find(o => o.id === entry.objectId);
                                    if (obj) Object.assign(obj, afterData);
                                    break;
                                }

                                case "DELETE": {
                                    await pool.query('DELETE FROM canvas_objects WHERE id = $1', [entry.objectId]);
                                    canvasState = canvasState.filter(obj => obj.id !== entry.objectId);
                                    break;
                                }

                                case "CLEAR": {
                                    await pool.query('DELETE FROM canvas_objects');
                                    canvasState = [];
                                    break;
                                }
                            }
                        }
                    }

                    // ポインターを更新
                    historyPointer = targetIndex;
                    console.log(`JUMP_TO_HISTORY実行: targetIndex ${targetIndex}, pointer更新完了`);

                    //ループが全部終わったら、最終状態をINIT形式で1回だけ送信
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    console.error("JUMP_TO_HISTORY処理失敗:", err);
                }
                break;
            }

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

