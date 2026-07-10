import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';

const app = express();
//corsは別のドメインからの勝手なアクセスをブロックする
//
app.use(cors()); //JSON形式のリクエストを受け取れるようにする
app.use(express.json());
const server = http.createServer(app);

//originは通信のチェック
    // プロトコル(http, https),ホスト名(localhost, google.comなど), ポート番号(3000,8080など)のうち一つでも違うと外部とみなされる
    //"*"はどの場所から来たアクセスでも全部許可する。あとで更新
const io = new Server(server, {
    cors:{
        origin: "*",
        methods: ["GET", "POST"]
    }
});

//キャンバスの状態を保持する変数
let canvasState = [];

//現在の状態を取得するAPI
app.get('/canvas', (req, res) => {
    res.json(canvasState);
});

//状態を更新するAPI
app.post('/canvas', (req, res) => {
    canvasState = req.body;
    console.log("APIで状態が更新されました:", canvasState);
    
    //APIで更新された場合も、繋がっている全員にSocketで通知する
    io.emit('state-changed', canvasState);
    
    res.status(200).json({ message: "更新成功", data: canvasState });
});

//接続時の処理
io.on('connection', (socket) => {
    console.log('ユーザーが接続しました：'+socket.id);

    //初回接続時に現在の状態を送信
    socket.emit('init-state', canvasState);

    //要素が追加されたときの処理
    socket.on('update-canvas', (data) => {
        canvasState = data;

        //全員に最新状態を共有
        socket.broadcast.emit('state-changed', canvasState);
    });
});

//サーバ起動
const PORT = 3000;
server.listen(PORT, () => {
    console.log('サーバーがポート ${PORT} で起動しました');
});

//デバッグ用接続確認
io.on('connection', (socket) => {
    console.log("クライアントが接続しました。ID:"+socket.id);

    socket.on('message', (data) => {
        console.log("フロントからのメッセージ:"+data);
    });

    socket.on('disconnect', () => {
        console.log("切断されました");
    });

});