import express from 'express'; //Webサーバーを構築
import { Server } from 'socket.io'; //リアルタイム通信を簡単にするためのライブラリ。WebSocketを使いやすくしたやつ
import http from 'http'; //HTTPサーバー機能（Socket.ioで必要）
import cors from 'cors'; //corsは別のドメインからの勝手なアクセスをブロックする

const app = express();
app.use(cors());
app.use(express.json());//JSON形式のリクエストを受け取れるようにする
const server = http.createServer(app);

//originは通信のチェック
//プロトコル(http, https),ホスト名(localhost, google.comなど), ポート番号(3000,8080など)のうち一つでも違うと外部とみなされる
//"*"はどの場所から来たアクセスでも全部許可する。あとで更新
// GETとPOST通信を許可
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

//キャンバスの状態を保持する変数
let canvasState = [];

//接続・切断など各アクションの処理を一つにまとめたもの
io.on('connection', (socket) => { // クライアントが1人接続してきたら実行
    console.log(`${socket.id} 接続しました`); // 誰が接続したかコンソールに表示

    //接続した本人だけに、今のキャンバスの状態(全部)を渡す
    socket.emit("message", {
        action: "SYNC_RESPONSE",
        objects: canvasState
    });

    //メッセージ受信とaction分岐
    socket.on("message", (data) => {
        console.log("操作命令を受け取りました:", data.action, data);

        // サーバー側の状態を更新
        switch (data.action) {
            case "ADD":
                //ADDの重複チェック
                if (!canvasState.find(obj => obj.id === data.object.id)) {
                    canvasState.push(data.object);
                } else {
                    console.log("IDが重複しています:", data.object.id);
                }
                break;

            case "UPDATE":
                //.find():配列の中から条件に一致する最初の1つを見つけて返すメソッド
                //その図形のidと今回の通信で送られてきた図形のidが一致するものを探している
                const obj = canvasState.find(obj => obj.id === data.id);
                if (obj) { //updateするオブジェクトがあるか
                    //Object.assign(コピー先, コピー元)。更新
                    Object.assign(obj, data.changes);
                } else {
                    console.log("オブジェクトが見つかりません:", data.id);
                }
                break;

            case "DELETE":
                //.filter():条件に一致するものだけを残してそれ以外を削除するメソッド
                canvasState = canvasState.filter(obj => obj.id !== data.id);
                break;

            case "CLEAR":
                canvasState = [];
                break;

            default:
                console.log("存在しない操作です", data.action);
                return;
        }

        //つながっている全員(自分含む)に操作内容を再送
        io.emit("message", data);
    });

    //切断時にログを出す
    socket.on('disconnect', () => {
        console.log(`${socket.id} 接続が切断されました`);
    });
});

//サーバ起動
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました`);
});
