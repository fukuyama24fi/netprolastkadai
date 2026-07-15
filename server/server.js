import express from 'express'; //Webサーバーを構築
import { Server } from 'socket.io'; //リアルタイム通信を簡単にするためのライブラリ。WebSocketを使いやすくしたやつ
import http from 'http'; //HTTPサーバー機能（Socket.ioで必要）
import cors from 'cors'; //corsは別のドメインからの勝手なアクセスをブロックする
import pkg from 'pg'; //Neon接続用
import dotenv from 'dotenv'; //環境変数(DBのURLなど)を読み込むライブラリ


dotenv.config(); //.envファイルを適用
import { pool } from './config/db.js'; //データベース接続用
import {
  generateHTMLCode,
  generateCSSCode,
  toSafeFileName,
} from "./utils/codeGenerator.js"; //コード抽出用
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
    `
    SELECT
        h.id,
        h.action,
        h.object_id AS "objectId",
        h.user_id AS "userId",
        h.user_name AS "userName",
        h.before,
        h.after,
        h.created_at AS "createdAt"
    FROM edit_history AS h
    ORDER BY h.created_at DESC
    LIMIT 100
    `
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

// 履歴一覧を「今の全件」の状態で全クライアントに同期するヘルパー
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
                    obj.text ?? null,
                    obj.rotation ?? 0,
                    obj.fontSize ?? 24,
                    obj.fontWeight ?? "normal",
                    obj.fontStyle ?? "normal",
                    obj.textTransform ?? "none",
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
      const res = await pool.query(
    `
    SELECT
        id,
        type,
        x,
        y,
        width,
        height,
        fill,
        text,
        rotation,
        font_size AS "fontSize",
        font_weight AS "fontWeight",
        font_style AS "fontStyle",
        text_transform AS "textTransform",
        z_index AS "zIndex"
    FROM canvas_objects
    ORDER BY z_index ASC, id ASC
    `
);

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

        //履歴を最初から最後まで順に適用し、再起動時の「本当の最新状態」をシミュレートする
       /*
 * 履歴がある場合だけ、履歴から最新状態を再構築する。
 * 履歴が空の場合はcanvas_objectsから読み込んだ状態を残す。
 */
if (historyList.length > 0) {
    let reconstructedState = [];

    for (const history of historyList) {
        switch (history.action) {
           case "ADD": {
    if (!data.object?.id) {
        console.warn(
            "ADDデータが不正です:",
            data
        );

        break;

        
    }
    
    const idAlreadyExists =
        canvasState.some(
            (obj) =>
                obj.id === data.object.id
        );

    if (idAlreadyExists) {
        console.log(
            "ID重複:",
            data.object.id
        );

        break;
    }

    const newObject = {
        id: String(data.object.id),

        type: [
            "rect",
            "circle",
            "triangle",
            "text"
        ].includes(data.object.type)
            ? data.object.type
            : "rect",

        x:
            Number(data.object.x) || 0,

        y:
            Number(data.object.y) || 0,

        width:
            Number(data.object.width) ||
            100,

        height:
            Number(data.object.height) ||
            100,

        fill:
            data.object.fill ||
            "#4f8cff",

        text:
            data.object.text ?? null,

        rotation:
            Number(data.object.rotation) ||
            0,

        fontSize:
            Number(data.object.fontSize) ||
            24,

        fontWeight:
            data.object.fontWeight ===
            "bold"
                ? "bold"
                : "normal",

        fontStyle:
            data.object.fontStyle ===
            "italic"
                ? "italic"
                : "normal",

        textTransform:
            data.object.textTransform ===
            "uppercase"
                ? "uppercase"
                : "none",

        zIndex:
            Number.isFinite(
                Number(
                    data.object.zIndex
                )
            )
                ? Number(
                    data.object.zIndex
                )
                : canvasState.length
    };

    try {
        /*
         * Undo後に新規編集した場合は、
         * 現在位置より後ろの履歴を削除する。
         */
        const wasTruncated =
            await truncateHistoryAfterPointer();

        if (wasTruncated) {
            await reloadHistoryListFromDB();
        }

        await pool.query(
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
                newObject.id,
                newObject.type,
                newObject.x,
                newObject.y,
                newObject.width,
                newObject.height,
                newObject.fill,
                newObject.text,
                newObject.rotation,
                newObject.fontSize,
                newObject.fontWeight,
                newObject.fontStyle,
                newObject.textTransform,
                newObject.zIndex
            ]
        );

        canvasState.push(newObject);

        const historyEntry =
            await saveEditHistory({
                action: "ADD",
                objectId:
                    newObject.id,
                userId,
                userName,
                before: null,
                after: newObject
            });

        if (historyEntry) {
            historyList.push(
                historyEntry
            );

            historyPointer =
                historyList.length - 1;
        }

        io.emit("message", {
            action: "ADD",
            object: newObject,
            history:
                historyEntry || null
        });

        broadcastHistory();

        console.log(
            "ADD完了:",
            newObject
        );
    } catch (err) {
        console.error(
            "ADD処理のDB保存エラー:",
            err
        );
    }

    break;
}

            case "UPDATE": {
                const targetObject =
                    reconstructedState.find(
                        (obj) =>
                            obj.id ===
                            history.objectId
                    );

                if (
                    targetObject &&
                    history.after
                ) {
                    Object.assign(
                        targetObject,
                        history.after
                    );
                }

                break;
            }

            case "DELETE": {
                reconstructedState =
                    reconstructedState.filter(
                        (obj) =>
                            obj.id !==
                            history.objectId
                    );

                break;
            }

            case "CLEAR": {
                reconstructedState = [];
                break;
            }

            case "IMPORT": {
    reconstructedState =
        Array.isArray(
            history.after
        )
            ? history.after.map(
                (object) => ({
                    ...object
                })
            )
            : [];

    break;
}

            default:
                break;
        }
    }

    canvasState = reconstructedState;

    await syncCanvasObjectsToDB();
}

        console.log(`初期データ再構築＆同期完了 (${canvasState.length}件), pointer: ${historyPointer}`);

        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`サーバーがポート ${process.env.PORT || 3000} で起動しました`);
        });
    } catch (err) {
    console.error(
        "サーバー起動失敗:",
        err
    );

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
                        `INSERT INTO canvas_objects (id, type, x, y, width, height, fill, text, rotation, font_size, font_weight, font_style, text_transform)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                        [
                            data.object.id, data.object.type, data.object.x, data.object.y, data.object.width, data.object.height, data.object.fill, data.object.text,
                            data.object.rotation ?? 0, data.object.fontSize ?? null, data.object.fontWeight ?? null, data.object.fontStyle ?? null, data.object.textTransform ?? null
                        ]
                    );

                    const newObject = {
    ...data.object,
    rotation: data.object.rotation ?? 0,
    fontSize: data.object.fontSize ?? 24,
    fontWeight: data.object.fontWeight ?? "normal",
    fontStyle: data.object.fontStyle ?? "normal",
    textTransform: data.object.textTransform ?? "none",
    zIndex: data.object.zIndex ?? canvasState.length
};
                    canvasState.push(newObject);

                    //新しい編集が来たら、ポインター後ろを削除
                    if (await truncateHistoryAfterPointer()) {
                        await reloadHistoryListFromDB(); // 実際に切り捨てた時だけ再読み込み
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

                  
                    if (historyEntry) {
                         historyList.push(historyEntry);
                         historyPointer = historyList.length - 1;
                        }

                        io.emit("message", {

                            action: "ADD",

                            object: newObject,

                            history: historyEntry || null

                        });
 //全員に送信
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

                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();


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

                    //DBから再読み込みしてメモリとDBを同期
                    await reloadHistoryListFromDB();

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

            case "IMPORT_CANVAS": {
    if (
        !Array.isArray(
            data.objects
        )
    ) {
        console.warn(
            "IMPORT_CANVASのobjectsが不正です"
        );

        break;
    }

    /*
     * 大量データによる負荷を防ぐ
     */
    if (
        data.objects.length >
        5000
    ) {
        console.warn(
            "読み込める図形は5000件までです"
        );

        break;
    }

    const usedIds = new Set();

    const importedObjects =
        data.objects.map(
            (source, index) => {
                let id = String(
                    source.id ??
                    `import-${Date.now()}-${index}`
                );

                if (
                    !id ||
                    usedIds.has(id)
                ) {
                    id =
                        `import-${Date.now()}-${index}`;
                }

                usedIds.add(id);

                const allowedTypes = [
                    "rect",
                    "circle",
                    "triangle",
                    "text"
                ];

                const type =
                    allowedTypes.includes(
                        source.type
                    )
                        ? source.type
                        : "rect";

                const safeNumber = (
                    value,
                    fallback
                ) => {
                    const number =
                        Number(value);

                    return Number.isFinite(
                        number
                    )
                        ? number
                        : fallback;
                };

                return {
                    id,
                    type,

                    x: safeNumber(
                        source.x,
                        100
                    ),

                    y: safeNumber(
                        source.y,
                        100
                    ),

                    width: Math.max(
                        30,
                        safeNumber(
                            source.width,
                            type === "text"
                                ? 180
                                : 100
                        )
                    ),

                    height: Math.max(
                        30,
                        safeNumber(
                            source.height,
                            type === "text"
                                ? 60
                                : 100
                        )
                    ),

                    fill:
                        typeof source.fill ===
                        "string"
                            ? source.fill
                            : type === "text"
                                ? "#222222"
                                : "#4f8cff",

                    text:
                        type === "text"
                            ? String(
                                source.text ??
                                "テキスト"
                            )
                            : source.text ??
                              null,

                    rotation:
                        safeNumber(
                            source.rotation,
                            0
                        ),

                    zIndex:
                        safeNumber(
                            source.zIndex ??
                            source.z_index,
                            index
                        ),

                    fontSize: Math.max(
                        8,
                        safeNumber(
                            source.fontSize ??
                            source.font_size,
                            24
                        )
                    ),

                    fontWeight:
                        (
                            source.fontWeight ??
                            source.font_weight
                        ) === "bold"
                            ? "bold"
                            : "normal",

                    fontStyle:
                        (
                            source.fontStyle ??
                            source.font_style
                        ) === "italic"
                            ? "italic"
                            : "normal",

                    textTransform:
                        (
                            source.textTransform ??
                            source.text_transform
                        ) === "uppercase"
                            ? "uppercase"
                            : "none"
                };
            }
        );

    const beforeObjects =
        canvasState.map(
            (object) => ({
                ...object
            })
        );

    try {
        if (
            await truncateHistoryAfterPointer()
        ) {
            await reloadHistoryListFromDB();
        }

        /*
         * メモリ上のキャンバスを置き換える
         */
        canvasState =
            importedObjects.map(
                (object) => ({
                    ...object
                })
            );

        /*
         * DBもキャンバス全体で置き換える
         */
        await syncCanvasObjectsToDB();

        const historyEntry =
            await saveEditHistory({
                action: "IMPORT",
                objectId: null,
                userId,
                userName,
                before:
                    beforeObjects,
                after:
                    importedObjects
            });

        if (historyEntry) {
            historyList.push(
                historyEntry
            );

            historyPointer =
                historyList.length - 1;
        }

        /*
         * 全ユーザーの画面を同期
         */
        io.emit("message", {
            action: "INIT",
            objects:
                canvasState
        });

        broadcastHistory();

        console.log(
            "JSON読み込み完了:",
            importedObjects.length,
            "件"
        );
    } catch (error) {
        /*
         * 失敗したらメモリを元に戻す
         */
        canvasState =
            beforeObjects;

        console.error(
            "IMPORT_CANVAS失敗:",
            error
        );
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
                        case "IMPORT": {
                            canvasState =
                            Array.isArray(
                                targetEntry.before
                            )
                            ? targetEntry.before.map(
                                (object) => ({
                                    ...object
                                })
                            )
                            : [];
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
                        case "IMPORT": {
                            canvasState =
                            Array.isArray(
                                targetEntry.after
                            )
                            ? targetEntry.after.map(
                                (object) => ({
                                    ...object
                                })
                            )
                            : [];
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
                                case "IMPORT": {
                                    canvasState =
                                    Array.isArray(
                                        entry.before
                                    )
                                    ? entry.before.map(
                                        (object) => ({
                                            ...object
                                        })
                                    )
                                    : [];
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

                                case "IMPORT": {
                                    canvasState =
                                    Array.isArray(
                                        entry.after
                                    )
                                    ? entry.after.map(
                                        (object) => ({
                                            ...object
                                        })
                                    ): [];
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
  const format = data.format;

  const baseName = toSafeFileName(
    data.fileName,
    "pikva-canvas"
  );

  console.log("EXPORT_CODE受信:",{
    format,
    baseName,
    objectCount: canvasState.length
  });

  let content;
  let outputFileName;
  let mimeType;

  if (format === "html") {
    content = generateHTMLCode(
      canvasState,
      `${baseName}.css`
    );

    outputFileName =
      `${baseName}.html`;

    mimeType =
      "text/html;charset=utf-8";
  } else if (format === "css") {
    content =
      generateCSSCode(canvasState);

    outputFileName =
      `${baseName}.css`;

    mimeType =
      "text/css;charset=utf-8";
  } else {
    console.warn(
      "未対応の出力形式:",
      format
    );

    break;
  }

  /*
   * 出力を依頼したユーザーだけへ返す。
   * io.emitではなくsocket.emitを使う。
   */
  socket.emit("message", {
    action: "EXPORT_RESULT",

    file: {
      format,
      fileName: outputFileName,
      mimeType,
      content,
    },
  });

  console.log("EXPORT_RESULT送信:",outputFileName);
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

