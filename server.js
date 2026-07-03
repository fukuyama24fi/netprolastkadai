import express from 'express';
import { Server } from 'socket.io';
import http from 'http';
import cors from 'cors';

const app = express();
//corsは別のドメインからの勝手なアクセスをブロックする
//アクセスsの許可証を発行
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
    //originは通信のチェック
    // プロトコル(http, https),ホスト名(localhost, google.comなど), ポート番号(3000,8080など)のうち一つでも違うと外部とみなされる
    cors:{
        origin: "*", //後で更新。どの場所から来たアクセスでも全部許可する
        methods: ["GET", "POST"]
    }
});

//キャンバスの状態を保持する変数
let canvasState = [];

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
        consoke.log("フロントからのメッセージ:"+data);
    });

    socket.on('disconnect', () => {
        console.log("切断されました");
    });

});