import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

//Socket.ioの接続や通信を管理するクラス
class SocketService {
    constructor() { //接続状態を保持するプロパティを初期化
        this.socket = null;
    }

    //ブラウザ固有のID。一度作ったらlocalStorageに保存し、以後は使い回す
    getUserId() {
        let userId = localStorage.getItem("userId");
        if (!userId) {
            userId = crypto.randomUUID();
            localStorage.setItem("userId", userId);
        }
        return userId;
    }

    // 表示用の名前。ユーザーが自由に変更できる
    getUserName() {
        return localStorage.getItem("userName") || "名無しさん";
    }

     setUserName(name) {
        localStorage.setItem("userName", name);
        if (this.socket?.connected) {
            this.socket.emit("message", {
                action: "SET_USERNAME",
                userId: this.getUserId(),
                userName: name
            });
        }
    }

    //Socket.io接続
    connect() {
        //まだ接続してない場合
       if(this.socket){
        return;
       }
       const userId = this.getUserId();
    const userName = this.getUserName();

    // 接続は1回だけ
    this.socket = io(SOCKET_URL, {
      query: {
        userId,
        userName,
      },
    });
    this.socket.on("connect", () => {
      console.log("接続しました", this.socket.id);
    });

    this.socket.on("disconnect", (reason) => {
      console.log("接続が解除されました", reason);
    });
        }
    

    //メッセージ送信
    sendMessage(action, data = {}) {
        //接続してる場合に送信
        //.?もし左側の値が null か undefined だったら、エラーを出さずに undefined を返して処理を止める 
        //つまり、socket がまだ存在しなくてもエラーにならず、すでに繋がっているなら再接続しない
        //切断中の送信を防ぐ
         if (!this.socket?.connected) {
      console.warn("socket未接続のため送信できません:", action, data);
      return;
    }
    this.socket.emit(
        "message",{
            action,
            ...data,
            userId: this.getUserId(),
            userName: this.getUserName(),
        }
    );
    }

    //イベントリスナー登録
    onMessage(callback) {
        if (this.socket) {
            //サーバーからの"message"イベントを受け取ったらcallbackを実行
            //callback:処理の結果が出たときに、あとから実行してもらうための関数。
            // 時間のかかる処理が終わるまで他の作業ができるため、アプリがサクサク動く。
            return;
        }
        this.socket.on("message",callback);
    }

    //イベントリスナー解除
    offMessage(callback) {
        if (!this.socket) {
            return;
        }
        this.socket.off("message", callback);
    }

    disconnect() {
        if (!this.socket) {
            return;
        }
        this.socket.disconnect();
            this.socket = null;
    }
}

export default new SocketService();