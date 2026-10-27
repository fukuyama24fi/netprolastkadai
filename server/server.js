import express from 'express'; //Webサーバーを構築
import { Server } from 'socket.io'; //リアルタイム通信を簡単にするためのライブラリ。WebSocketを使いやすくしたやつ
import http from 'http'; //HTTPサーバー機能（Socket.ioで必要）
import cors from 'cors'; //corsは別のドメインからの勝手なアクセスをブロックする
import pkg from 'pg'; //Neon接続用
import dotenv from 'dotenv'; //環境変数(DBのURLなど)を読み込むライブラリ


dotenv.config(); //.envファイルを適用
import { pool } from './config/db.js'; //データベース接続用
import { generateHTMLCode, generateCSSCode } from './utils/codeGenerator.js'; //コード抽出用
import { askCanvasAi } from './ai/aiService.js'; //AIチャット用
import { validateOperations, buildShapeFromAddOperation } from './ai/validateOperations.js'; //AIの操作の検証用
const app = express();
app.use(cors());
app.use(express.json());//JSON形式のリクエストを受け取れるようにする
const server = http.createServer(app);
const userNames = {}; //ユーザー名(ID,ユーザ名)

//サーバー全体のアクション排他制御フラグ
//他の人がRedo中などはロックがかかる
let isProcessing = false;

//originは通信のチェック
//プロトコル(http, https),ホスト名(localhost, google.comなど), ポート番号(3000,8080など)のうち一つでも違うと外部とみなされる
//"*"はどの場所から来たアクセスでも全部許可する
//GETとPOST通信を許可
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "*",
        methods: ["GET", "POST"]
    }
});

//キャンバスの状態を保持する変数
let canvasState = [];

//Undo/Redo用のポインター方式メモリ変数 (NEW)
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
    textTransform: "text_transform"
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
//直近100件だけ取得（全件だと数が増えたとき重くなるので）
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
             FROM edit_history h
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

//履歴一覧を「今の全件」の状態で全クライアントに同期するヘルパー
//pointerがどこにあるかに関係なく、historyList自体が実際に短くなっていない限り全部送る
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

//pointerより後ろの履歴を切り捨てる。切り捨てが発生した場合はtrueを返す
async function truncateHistoryAfterPointer() {
    if (historyPointer >= historyList.length - 1) {
        return false; //最新地点にいるので切り捨てるものがない
    }
    //ポインター以降のデータをDBからも削除
    const idsToDelete = historyList.slice(historyPointer + 1).map(h => h.id);
    if (idsToDelete.length > 0) {
        await pool.query(`DELETE FROM edit_history WHERE id = ANY($1)`, [idsToDelete]);
    }
    historyList = historyList.slice(0, historyPointer + 1);
    return true;
}

//canvasStateの内容でcanvas_objectsテーブルを丸ごと書き換える
async function syncCanvasObjectsToDB() {
    await pool.query('BEGIN');
    await pool.query('DELETE FROM canvas_objects');
    for (const obj of canvasState) {
        await pool.query(
            `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text, rotation, font_size, font_weight, font_style, text_transform)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                obj.id, obj.type, obj.x, obj.y, obj.width, obj.height, obj.fill, obj.text,
                obj.rotation ?? 0, obj.fontSize ?? null, obj.fontWeight ?? null, obj.fontStyle ?? null, obj.textTransform ?? null
            ]
        );
    }
    await pool.query('COMMIT');
}

//==================== AI機能用☆ ====================
//既存の case "ADD" / "UPDATE" / "DELETE" と同じ処理を「関数」として切り出した新しい関数たち
//（既存の case 文はまだ触っていない。AI_APPLY からだけ呼ぶ）


//同じ人がAIに連続で頼める間隔（ミリ秒）
const AI_COOLDOWN_MS = 10000;
//サーバー全体で1分間にAIを呼べる回数（GroqはAPIキー全体で1分あたりのトークン数に上限があるため）
const AI_GLOBAL_LIMIT_PER_MINUTE = Number(process.env.AI_GLOBAL_LIMIT_PER_MINUTE) || 8;
const lastAiRequestAt = {}; //接続ID → 最後に頼んだ時刻
let aiRequestTimes = []; //直近1分間にAIを呼んだ時刻の一覧

//新しい編集の前に、ポインターより後ろの履歴を切り捨てる
async function prepareForNewEdit() {
    if (await truncateHistoryAfterPointer()) {
        await reloadHistoryListFromDB(); //実際に切り捨てた時だけ再読み込み
    }
}

//履歴を保存してメモリにも積む
//saveEditHistory が失敗すると undefined が返り、historyList に undefined が入って Undo が壊れるので、ここで止める
async function recordHistory(params) {
    const historyEntry = await saveEditHistory(params);
    if (!historyEntry) {
        throw new Error("履歴の保存に失敗しました");
    }
    historyList.push(historyEntry);
    historyPointer = historyList.length - 1;
    return historyEntry;
}

//図形を1つ追加する（case "ADD" と同じ処理）
async function applyAdd(shape, userId, userName) {
    await prepareForNewEdit();
    await pool.query(
        `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text, rotation, font_size, font_weight, font_style, text_transform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
            shape.id, shape.type, shape.x, shape.y, shape.width, shape.height, shape.fill, shape.text ?? null,
            shape.rotation ?? 0, shape.fontSize ?? null, shape.fontWeight ?? null, shape.fontStyle ?? null, shape.textTransform ?? null
        ]
    );
    canvasState.push(shape);
    const historyEntry = await recordHistory({
        action: "ADD", objectId: shape.id, userId, userName, before: null, after: shape
    });
    io.emit("message", { action: "ADD", object: shape, userId, history: historyEntry });
}

//図形を1つ変更する（case "UPDATE" と同じ処理）
async function applyUpdate(id, changes, userId, userName) {
    const obj = canvasState.find(o => o.id === id);
    if (!obj) {
        throw new Error(`オブジェクトが見つかりません: ${id}`);
    }
    //許可された列だけに絞る
    const updateData = {};
    for (const key of Object.keys(changes)) {
        if (ALLOWED_UPDATE_FIELDS.includes(key)) {
            updateData[key] = changes[key];
        }
    }
    if (Object.keys(updateData).length === 0) {
        throw new Error("更新可能な項目がありません");
    }

    await prepareForNewEdit();
    const beforeState = { ...obj };
    const keys = Object.keys(updateData)
        .map((key, index) => `${UPDATE_COLUMN_MAP[key]} = $${index + 2}`)
        .join(",");
    await pool.query(
        `UPDATE canvas_objects SET ${keys} WHERE id = $1`,
        [id, ...Object.values(updateData)]
    );
    Object.assign(obj, updateData);
    const historyEntry = await recordHistory({
        action: "UPDATE", objectId: id, userId, userName, before: beforeState, after: { ...obj }
    });
    io.emit("message", { action: "UPDATE", id, changes: updateData, userId, history: historyEntry });
}

//図形を1つ削除する（case "DELETE" と同じ処理）
async function applyDelete(id, userId, userName) {
    const deletedObj = canvasState.find(o => o.id === id);
    if (!deletedObj) {
        throw new Error(`オブジェクトが見つかりません: ${id}`);
    }
    await prepareForNewEdit();
    await pool.query('DELETE FROM canvas_objects WHERE id = $1', [id]);
    canvasState = canvasState.filter(o => o.id !== id);
    const historyEntry = await recordHistory({
        action: "DELETE", objectId: id, userId, userName, before: deletedObj, after: null
    });
    io.emit("message", { action: "DELETE", id, userId, history: historyEntry });
}

//今のキャンバスで一番大きい zIndex（AIの図形を一番手前に置くため）
function getMaxZIndex() {
    return canvasState.reduce((max, obj, index) => {
        const z = Number(obj.zIndex);
        return Math.max(max, Number.isFinite(z) ? z : index);
    }, -1);
}

//AIを呼んでよいか（連打と使いすぎの防止）。ダメなら理由の文章を返す
function checkAiRateLimit(connectionId) {
    const now = Date.now();
    const last = lastAiRequestAt[connectionId] || 0;
    if (now - last < AI_COOLDOWN_MS) {
        const waitSec = Math.ceil((AI_COOLDOWN_MS - (now - last)) / 1000);
        return `少し待ってからもう一度話しかけてね（あと${waitSec}秒）`;
    }
    aiRequestTimes = aiRequestTimes.filter(t => now - t < 60000);
    if (aiRequestTimes.length >= AI_GLOBAL_LIMIT_PER_MINUTE) {
        return "いまAIが混み合っています。30秒ほど待ってからもう一度試してね";
    }
    lastAiRequestAt[connectionId] = now;
    aiRequestTimes.push(now);
    return null;
}
//==================== AI機能用☆ ここまで ====================

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
            `SELECT * FROM edit_history ORDER BY id ASC` //古い順に読み込む
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

        //履歴を最初から最後まで順に適用し、再起動時の「本当の最新状態」をシミュレートする
        let reconstructedState = [];
        for (const history of historyList) {
            switch (history.action) {
                case "ADD":
                    //重複回避しつつ追加
                    if (!reconstructedState.find(obj => obj.id === history.objectId)) {
                        reconstructedState.push(history.after);
                    }
                    break;
                case "UPDATE":
                    const uObj = reconstructedState.find(obj => obj.id === history.objectId);
                    if (uObj) Object.assign(uObj, history.after);
                    break;
                case "DELETE":
                    reconstructedState = reconstructedState.filter(obj => obj.id !== history.objectId);
                    break;
                case "CLEAR":
                    reconstructedState = [];
                    break;
            }
        }

        //再構築した状態を正規の canvasState に代入
        canvasState = reconstructedState;

        //再起動でポインターが末尾に戻るため、DB(canvas_objects)側もこの最新状態で強制上書き同期する
        await syncCanvasObjectsToDB();

        console.log(`初期データ再構築＆同期完了 (${canvasState.length}件), pointer: ${historyPointer}`);

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`サーバーがポート ${process.env.PORT || 3000} で起動しました`);
        });
    } catch (err) {
        await pool.query('ROLLBACK').catch(() => { });
        console.error("サーバー起動失敗:", err);
        process.exit(1);
    }


}
startServer(); //関数を実行

//接続・切断など各アクションの処理を一つにまとめたもの
io.on('connection', async (socket) => { //クライアントが1人接続してきたら実行
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
                        `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text, rotation, font_size, font_weight, font_style, text_transform)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                        [
                            data.object.id, data.object.type, data.object.x, data.object.y, data.object.width, data.object.height, data.object.fill, data.object.text,
                            data.object.rotation ?? 0, data.object.fontSize ?? null, data.object.fontWeight ?? null, data.object.fontStyle ?? null, data.object.textTransform ?? null
                        ]
                    );
                    canvasState.push(data.object);

                    //新しい編集が来たら、ポインター後ろを削除
                    if (await truncateHistoryAfterPointer()) {
                        await reloadHistoryListFromDB(); //実際に切り捨てた時だけ再読み込み
                    }
                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();

                    //履歴に記録
                    const historyEntry = await saveEditHistory({
                        action: "ADD",
                        objectId: data.object.id,
                        userId,
                        userName,
                        before: null, //Undo・redo用
                        after: data.object
                    });

                    //履歴に記録
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
                        await reloadHistoryListFromDB(); //実際に切り捨てた時だけ再読み込み
                    }

                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();


                    //変更前の状態を保存（undo用）
                    const beforeState = { ...obj };

                    //DB更新
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

                    //メモリ更新
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
                        await reloadHistoryListFromDB(); //実際に切り捨てた時だけ再読み込み
                    }

                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();

                    //削除前のオブジェクトを保存（undo用）
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
                        await reloadHistoryListFromDB(); //実際に切り捨てた時だけ再読み込み
                    }

                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();

                    //[...] はスプレッド構文。消える前の全オブジェクト配列をコピーして保持
                    //クリア前の全オブジェクトを保存（undo用）
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
                    isProcessing = true; //ロック開始
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
                    await pool.query('ROLLBACK').catch(() => { });
                    console.error("UNDO処理失敗:", err);
                } finally {
                    isProcessing = false; //ロック解除
                }
                break;
            }

            case "REDO": {
                try {
                    isProcessing = true; //ロック開始
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
                    await pool.query('ROLLBACK').catch(() => { });
                    console.error("REDO処理失敗:", err);
                } finally {
                    isProcessing = false; //ロック解除
                }
                break;
            }

            case "JUMP_TO_HISTORY": {
                try {
                    isProcessing = true; //ロック開始
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
                        //戻る方向: 逆順で巻き戻しシミュレーション
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
                        //進む方向: 順操作で進めるシミュレーション
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

                    //ポインターを更新
                    historyPointer = targetIndex;

                    //ループ完了後に、最終的な状態をDB（canvas_objects）へ一括書き込みする（クエリは1回）
                    await syncCanvasObjectsToDB();

                    console.log(`JUMP_TO_HISTORY実行完了: targetIndex ${targetIndex}, DB同期完了`);

                    broadcastHistory();

                    //ループが全部終わったら、最終状態をINIT形式で1回だけ送信
                    io.emit("message", {
                        action: "INIT",
                        objects: canvasState
                    });

                } catch (err) {
                    await pool.query('ROLLBACK').catch(() => { });
                    console.error("JUMP_TO_HISTORY処理失敗:", err);
                } finally {
                    isProcessing = false; //ロック解除
                }
                break;
            }

            //AIに話しかける。キャンバスはまだ変えず、頼んだ本人にだけ「返事」と「操作の提案」を返す
            case "AI_CHAT": {
                const requestId = data.requestId ?? null;
                const message = typeof data.message === "string" ? data.message.trim().slice(0, 300) : "";
                if (!message) {
                    socket.emit("message", { action: "AI_ERROR", requestId, message: "メッセージが空です" });
                    break;
                }

                //連打防止は、なりすましできない接続ごとのIDで判定する
                const limitMessage = checkAiRateLimit(connectedUserId);
                if (limitMessage) {
                    socket.emit("message", { action: "AI_ERROR", requestId, message: limitMessage });
                    break;
                }

                try {
                    const result = await askCanvasAi({
                        message,
                        chatHistory: data.chatHistory,
                        canvasState
                    });
                    //AIの提案をこの時点で一度チェックして、使える操作だけをクライアントに見せる
                    const { operations, skipped } = validateOperations(result.operations, canvasState);
                    socket.emit("message", {
                        action: "AI_REPLY",
                        requestId,
                        reply: result.reply || "（返事がありませんでした）",
                        operations,
                        skipped,
                        provider: result.provider
                    });
                    console.log(`[AI] ${userName} への返答 (${result.provider}): 操作${operations.length}件, 除外${skipped}件`);
                } catch (err) {
                    console.error("[AI] AI_CHAT 失敗:", err);
                    socket.emit("message", {
                        action: "AI_ERROR",
                        requestId,
                        message: err.status === 429
                            ? "いまAIが混み合っています。少し待ってからもう一度試してね"
                            : "AIとの通信に失敗しました。もう一度試してね"
                    });
                }
                break;
            }

            //AIの提案をキャンバスに反映する。ロックをかけて1つずつ順番に適用する
            //履歴には「○○のAI」という名前で残る（Undoは図形1つにつき1回）
            case "AI_APPLY": {
                const requestId = data.requestId ?? null;
                if (isProcessing) {
                    socket.emit("message", {
                        action: "AI_APPLY_RESULT", requestId, applied: 0, skipped: 0,
                        error: "他の操作の処理中です。少し待ってからもう一度押してね"
                    });
                    break;
                }

                //クライアントから来た操作なので、もう一度チェックする（提案の後にキャンバスが変わっている可能性もある）
                const { operations, skipped } = validateOperations(data.operations, canvasState);
                if (operations.length === 0) {
                    socket.emit("message", {
                        action: "AI_APPLY_RESULT", requestId, applied: 0, skipped,
                        error: "反映できる操作がありませんでした"
                    });
                    break;
                }

                isProcessing = true; //ロック開始（この間、他の人の ADD/UPDATE/DELETE/UNDO などは弾かれる）
                const aiUserName = `${userName}のAI`;
                let applied = 0;
                try {
                    let zIndex = getMaxZIndex();
                    for (const operation of operations) {
                        //1つ失敗しても残りは続ける
                        try {
                            if (operation.op === "add") {
                                zIndex += 1;
                                await applyAdd(buildShapeFromAddOperation(operation, zIndex), userId, aiUserName);
                            } else if (operation.op === "update") {
                                await applyUpdate(operation.id, operation.changes, userId, aiUserName);
                            } else if (operation.op === "delete") {
                                await applyDelete(operation.id, userId, aiUserName);
                            }
                            applied++;
                        } catch (err) {
                            console.error(`[AI] 操作の適用に失敗 (${operation.op}):`, err.message);
                        }
                    }
                } finally {
                    isProcessing = false; //ロック解除（途中で例外が出ても必ず外す）
                    broadcastHistory(); //履歴一覧をまとめて全員に送る
                }

                socket.emit("message", {
                    action: "AI_APPLY_RESULT",
                    requestId,
                    applied,
                    skipped: skipped + (operations.length - applied)
                });
                console.log(`[AI] ${aiUserName} が ${applied} 件の操作を反映しました`);
                break;
            }

            case "EXPORT_CODE": {
                try {
                    const format = data.format; //"html" または "css"
                    const fileName = data.fileName?.trim() || "pikva-canvas";

                    let content;
                    let extension;

                    if (format === "html") {
                        content = generateHTMLCode(canvasState);
                        extension = "html";
                    } else if (format === "css") {
                        content = generateCSSCode(canvasState);
                        extension = "css";
                    } else {
                        console.log("不正な出力形式:", format);
                        break;
                    }

                    //リクエストをしてきた本人にだけ生成結果を返す
                    socket.emit("message", {
                        action: "EXPORT_RESULT",
                        file: {
                            name: `${fileName}.${extension}`,
                            content,
                            format,
                        },
                    });
                    console.log(`コード生成を実行しました (userId: ${userId}, format: ${format})`);
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