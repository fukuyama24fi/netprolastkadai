import { io } from "socket.io-client";

//サーバのURL
const SERVER_URL = "http://localhost:3000";

//ソケットのインスタンスを作成
const socket = io(SERVER_URL, {
    reconnectionAttempts: 5, //接続エラーの再試行回数
});

//デバッグ。接続確認用のログ
socket.on("connect", () => {
  console.log("バックエンドサーバーと接続しました！ ID:", socket.id);
});

//接続エラー時
socket.on("connect_error", (err) => {
    console.error("サーバー接続エラー：", err.message);
});

//切断
socket.on("disconnect", (reason) => {
  console.log("サーバーとの接続が切断されました:", reason);
});

//他のファイルから利用できるようにする
export default socket;
