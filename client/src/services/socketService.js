import { io } from "socket.io-client";

//そのうち.envからサーバーURLを読み込む
const SOCKET_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3000";

//Socket.ioの接続や通信を管理するクラス
class SocketService {
    constructor() { //接続状態を保持するプロパティを初期化
        this.socket = null;
    }

    //Socket.io接続
    connect() {
        //まだ接続してない場合
        if (!this.socket) {
            this.socket = io(SOCKET_URL);
            //接続が確立した瞬間に実行されるリスナーを登録
            this.socket.on("connect", () => {
                console.log("接続しました", this.socket.id);
            });

            //接続解除した時のデバッグログ
            this.socket.on("disconnect", (reason) => {
                console.log("接続が解除されました", reason);
            });

        }
    }

    //メッセージ送信
    sendMessage(action, data) {
        //接続してる場合に送信
        //.?もし左側の値が null か undefined だったら、エラーを出さずに undefined を返して処理を止める 
        //つまり、socket がまだ存在しなくてもエラーにならず、すでに繋がっているなら再接続しない
        //切断中の送信を防ぐ
        if (this.socket?.connected) {
            //"message"イベントでデータを送信
            this.socket.emit("message", { action, ...data });
        }
    }

    //イベントリスナー登録
    onMessage(callback) {
        if (this.socket) {
            //サーバーからの"message"イベントを受け取ったらcallbackを実行
            //callback:処理の結果が出たときに、あとから実行してもらうための関数。
            // 時間のかかる処理が終わるまで他の作業ができるため、アプリがサクサク動く。
            this.socket.on("message", callback);
        }
    }

    //イベントリスナー解除
    offMessage(callback) {
        if (this.socket) {
            this.socket.off("message", callback);
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
}

export default new SocketService();