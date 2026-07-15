import express from 'express'; //Webサーバーを構築
import { Server } from 'socket.io'; //リアルタイム通信を簡単にするためのライブラリ。WebSocketを使いやすくしたやつ
import http from 'http'; //HTTPサーバー機能（Socket.ioで必要）
import cors from 'cors'; //corsは別のドメインからの勝手なアクセスをブロックする
import pkg from 'pg'; //Neon接続用
import dotenv from 'dotenv'; //環境変数(DBのURLなど)を読み込むライブラリ
import { pool } from './config/db.js'; //データベース接続用
import { generateHTMLCode } from './utils/codeGenerator.js'; //コード抽出用


dotenv.config(); //.envファイルを適用

const app = express();
app.use(cors());
app.use(express.json());//JSON形式のリクエストを受け取れるようにする
const server = http.createServer(app);
const userNames = {}; //ユーザー名(ID,ユーザ名)

// サーバー全体のアクション排他制御フラグ
//他の人がRedo中などはロックがかかる
let isProcessing = false;

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

//許可する更新対象の項目と、対応するDBカラム名
const UPDATE_COLUMN_MAP = {
    type: "type",
    x: "x",
    y: "y",
    width: "width",
    height: "height",
    fill: "fill",
    text: "text",
    rotation: "rotation",
    fontSize: "font_size",
    fontWeight: "font_weight",
    fontStyle: "font_style",
    textTransform: "text_transform",
    zIndex: "z_index"
};
//許可する更新対象の列リスト
const ALLOWED_UPDATE_FIELDS = Object.keys(UPDATE_COLUMN_MAP);
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

        socket.emit("message", {
            action: "HISTORY_RESPONSE",
            history: result.rows.reverse()
        });
    } catch (err) {
        console.error("履歴の取得に失敗しました:", err);
    }
}

// 履歴一覧を「今の全件」の状態で全クライアントに同期する
// pointerがどこにあるかに関係なく、historyList自体が実際に短くなっていない限り全部送る
function broadcastHistory() {
    io.emit("message", {
        action: "HISTORY_RESPONSE",
        history: historyList.map(h => ({
            id: h.id,
            action: h.action,
            objectId: h.objectId,
            userId: h.userId,
            userName: h.userName,
            before: h.before,
            after: h.after,
            createdAt: h.createdAt
        }))
    });
}

//historyListをDBから再読み込みする関数
//DBは正しく消されているが、メモリ上のhistoryListの同期タイミングに遅れが生じる
//それを回避するため、DBの内容とメモリを常に同期させるため、ジャンプ後の編集時に呼ぶ
async function reloadHistoryListFromDB() {
    try {
        const historyRes = await pool.query(
            `SELECT * FROM edit_history ORDER BY id ASC`
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
        historyPointer = Math.min(historyPointer, historyList.length - 1);
        console.log(`historyListを再読み込み: ${historyList.length}件, pointer: ${historyPointer}`);
    } catch (err) {
        console.error("historyListの再読み込み失敗:", err);
    }
}

// pointerより後ろの履歴を切り捨てる。切り捨てが発生した場合はtrueを返す
async function truncateHistoryAfterPointer() {
    if (historyPointer >= historyList.length - 1) {
        return false; // 最新地点にいるので切り捨てるものがない
    }
    //ポインター以降のデータをDBからも削除
    const idsToDelete = historyList.slice(historyPointer + 1).map(h => h.id);
    if (idsToDelete.length > 0) {
        await pool.query(`DELETE FROM edit_history WHERE id = ANY($1)`, [idsToDelete]);
    }
    historyList = historyList.slice(0, historyPointer + 1);
    return true;
}

// canvasStateの内容でcanvas_objectsテーブルを丸ごと書き換える
async function syncCanvasObjectsToDB() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            "DELETE FROM canvas_objects"
        );

        for (const obj of canvasState) {
            await client.query(
                `
                INSERT INTO canvas_objects (
                    id,
                    type,
                    x,
                    y,
                    width,
                    height,
                    fill,
                    text,
                    rotation,
                    font_size,
                    font_weight,
                    font_style,
                    text_transform,
                    z_index
                )
                VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10, $11, $12,
                    $13, $14
                )
                `,
                [
                    obj.id,
                    obj.type,
                    obj.x,
                    obj.y,
                    obj.width,
                    obj.height,
                    obj.fill,
                    obj.text,
                    obj.rotation ?? 0,
                    obj.fontSize ?? null,
                    obj.fontWeight ?? null,
                    obj.fontStyle ?? null,
                    obj.textTransform ?? null,
                    obj.zIndex ?? 0
                ]
            );
        }

        await client.query("COMMIT");
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
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

        console.log(`historyList読み込み完了 (${historyList.length}件), pointer: ${historyPointer}`);

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

        //排他制御:他のユーザーがUNDO/REDO/JUMPを処理中の場合は、通常のアクションを弾く
        if (isProcessing && ["ADD", "UPDATE", "DELETE", "CLEAR", "UNDO", "REDO", "JUMP_TO_HISTORY"].includes(data.action)) {
            console.log(`[ロック中] 他の非同期処理が実行中のため、要求をスキップしました: ${data.action}`);
            return;
        }

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
                        //追加した要素がなかったらnull
                        `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text, rotation, font_size, font_weight, font_style, text_transform, z_Index)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
                        [
                            data.object.id, data.object.type, data.object.x, data.object.y, data.object.width, data.object.height, data.object.fill, data.object.text,
                            data.object.rotation ?? 0, data.object.fontSize ?? null, data.object.fontWeight ?? null, data.object.fontStyle ?? null,
                            data.object.textTransform ?? null, data.object.zIndex ?? null
                        ]
                    );

                    canvasState.push(data.object);

                    //新しい編集が来たら、ポインター後ろを削除
                    if (await truncateHistoryAfterPointer()) {
                        await reloadHistoryListFromDB(); // 実際に切り捨てた時だけ再読み込み
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

                    historyList.push(historyEntry);
                    historyPointer = historyList.length - 1;

                    io.emit("message", { ...data, history: historyEntry }); //全員に送信
                    broadcastHistory(); //切り捨て後の履歴一覧をフロントにも反映
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
                    if (await truncateHistoryAfterPointer()) {
                        await reloadHistoryListFromDB(); // 実際に切り捨てた時だけ再読み込み
                    }

                    // 変更前の状態を保存（undo用）
                    const beforeState = { ...obj };

                    // DB更新
                    const keys = Object.keys(updateData)
                        .map((key, index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`)
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

                    //履歴に記録
                    historyList.push(historyEntry);
                    historyPointer = historyList.length - 1;

                    //全員に通知
                    io.emit("message", { ...data, history: historyEntry });
                    broadcastHistory(); //切り捨て後の履歴一覧をフロントにも反映


                } catch (err) {
                    console.error("UPDATE失敗:", err);
                }
                break;
            }

            case "DELETE": {
                try {
                    //ポインター後ろを削除
                    if (await truncateHistoryAfterPointer()) {
                        await reloadHistoryListFromDB(); // 実際に切り捨てた時だけ再読み込み
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

                    //履歴に記録
                    historyList.push(historyEntry);
                    historyPointer = historyList.length - 1;

                    io.emit("message", { ...data, history: historyEntry });
                    broadcastHistory(); //切り捨て後の履歴一覧をフロントにも反映
                } catch (err) {
                    console.error("DELETE処理のDB保存エラー:", err);
                }
                break;
            }

            case "CLEAR": {
                try {
                    //ポインター後ろを削除 
                    if (await truncateHistoryAfterPointer()) {
                        await reloadHistoryListFromDB(); // 実際に切り捨てた時だけ再読み込み
                    }

                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();

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

                    //履歴に記録
                    historyList.push(historyEntry);
                    historyPointer = historyList.length - 1;

                    io.emit("message", { ...data, history: historyEntry });
                    broadcastHistory(); //切り捨て後の履歴一覧をフロントにも反映
                } catch (err) {
                    console.error("CLEAR処理のDB保存エラー:", err);
                }
                break;
            }

            case "UNDO": {
                try {
                    isProcessing = true; // ロック開始
                    if (historyPointer < 0) {
                        console.log("Undo対象がありません");
                        break;
                    }

                    const targetEntry = historyList[historyPointer];
                    if (!targetEntry) {
                        console.log("Undo対象がありません");
                        break;
                    }

                    //メモリ(canvasState)の逆操作・書き換え
                    switch (targetEntry.action) {
                        case "ADD": {
                            canvasState = canvasState.filter(obj => obj.id !== targetEntry.objectId);
                            break;
                        }
                        case "UPDATE": {
                            const beforeData = targetEntry.before;
                            const obj = canvasState.find(o => o.id === targetEntry.objectId);
                            if (obj) Object.assign(obj, beforeData);
                            break;
                        }
                        case "DELETE": {
                            canvasState.push(targetEntry.before);
                            break;
                        }
                        case "CLEAR": {
                            canvasState = targetEntry.before;
                            break;
                        }

                    }

                    //DB(canvas_objects)へ一括反映
                    await syncCanvasObjectsToDB();

                    historyPointer--;
                    console.log(`UNDO実行: pointer → ${historyPointer}`);
                    broadcastHistory();

                    //キャンバス状態も同期
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    console.error("UNDO処理失敗:", err);
                } finally {
                    isProcessing = false; // ロック解除
                }
                break;
            }

            case "REDO": {
                try {
                    isProcessing = true; // ロック開始
                    if (historyPointer >= historyList.length - 1) {
                        console.log("Redo対象がありません");
                        break;
                    }

                    const targetEntry = historyList[historyPointer + 1];
                    if (!targetEntry) {
                        console.log("Redo対象がありません");
                        break;
                    }

                    //メモリ(canvasState)の順操作・書き換え
                    switch (targetEntry.action) {
                        case "ADD": {
                            canvasState.push(targetEntry.after);
                            break;
                        }
                        case "UPDATE": {
                            const afterData = targetEntry.after;
                            const obj = canvasState.find(o => o.id === targetEntry.objectId);
                            if (obj) Object.assign(obj, afterData);
                            break;
                        }
                        case "DELETE": {
                            canvasState = canvasState.filter(obj => obj.id !== targetEntry.objectId);
                            break;
                        }
                        case "CLEAR": {
                            canvasState = [];
                            break;
                        }
                    }

                    //DB(canvas_objects)へ一括反映
                    await syncCanvasObjectsToDB();

                    historyPointer++;
                    console.log(`REDO実行: pointer → ${historyPointer}`);
                    broadcastHistory();

                    //キャンバス状態も同期
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    console.error("REDO処理失敗:", err);
                } finally {
                    isProcessing = false; // ロック解除
                }
                break;
            }

            case "JUMP_TO_HISTORY": {
                try {
                    isProcessing = true; // ロック開始
                    const targetHistoryId = data.targetId;

                    if (!targetHistoryId) {
                        console.log("targetIdが指定されていません");
                        break;
                    }

                    const targetIndex = historyList.findIndex(h => h.id === targetHistoryId);

                    if (targetIndex === -1) {
                        console.log("指定された履歴が見つかりません:", targetHistoryId);
                        break;
                    }

                    if (targetIndex === historyPointer) {
                        console.log("すでにその状態です");
                        break;
                    }

                    //ループ内ではメモリ（canvasState）のみを高速に書き換える（DB通信は行わない）
                    if (targetIndex < historyPointer) {
                        // 戻る方向: 逆順で巻き戻しシミュレーション
                        for (let i = historyPointer; i > targetIndex; i--) {
                            const entry = historyList[i];

                            switch (entry.action) {
                                case "ADD": {
                                    canvasState = canvasState.filter(obj => obj.id !== entry.objectId);
                                    break;
                                }
                                case "UPDATE": {
                                    const beforeData = entry.before;
                                    const obj = canvasState.find(o => o.id === entry.objectId);
                                    if (obj) Object.assign(obj, beforeData);
                                    break;
                                }
                                case "DELETE": {
                                    canvasState.push(entry.before);
                                    break;
                                }
                                case "CLEAR": {
                                    canvasState = entry.before;
                                    break;
                                }
                            }
                        }
                    } else {
                        // 進む方向: 順操作で進めるシミュレーション
                        for (let i = historyPointer + 1; i <= targetIndex; i++) {
                            const entry = historyList[i];

                            switch (entry.action) {
                                case "ADD": {
                                    canvasState.push(entry.after);
                                    break;
                                }
                                case "UPDATE": {
                                    const afterData = entry.after;
                                    const obj = canvasState.find(o => o.id === entry.objectId);
                                    if (obj) Object.assign(obj, afterData);
                                    break;
                                }
                                case "DELETE": {
                                    canvasState = canvasState.filter(obj => obj.id !== entry.objectId);
                                    break;
                                }
                                case "CLEAR": {
                                    canvasState = [];
                                    break;
                                }

                            }
                        }
                    }

                    // ポインターを更新
                    historyPointer = targetIndex;

                    //ループ完了後に、最終的な状態をDB（canvas_objects）へ一括書き込みする（クエリは1回）
                    await syncCanvasObjectsToDB();

                    console.log(`JUMP_TO_HISTORY実行完了: targetIndex ${targetIndex}, DB同期完了`);

                    broadcastHistory();

                    // ループが全部終わったら、最終状態をINIT形式で1回だけ送信
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    await pool.query('ROLLBACK').catch(() => { });
                    console.error("JUMP_TO_HISTORY処理失敗:", err);
                } finally {
                    isProcessing = false; // ロック解除
                }
                break;
            }

            case "EXPORT_CODE": {
                try {
                    // 現在のキャンバス状態からコードを生成
                    const htmlCode = generateHTMLCode(canvasState);

                    // リクエストをしてきた本人にだけ生成結果を返す 
                    socket.emit("message", {
                        action: "EXPORT_RESULT",
                        html: htmlCode
                    });
                    console.log(`コード生成を実行しました (userId: ${userId})`);
                } catch (err) {
                    console.error("コード生成失敗:", err);
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

