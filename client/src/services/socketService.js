import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

// Socket.ioの接続や通信を管理するクラス
class SocketService {
  constructor() {
    this.socket = null;
  }

  // ブラウザ固有のID。一度作ったらlocalStorageに保存し、以後は使い回す
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
        userName: name,
      });
    }
  }

  // Socket.io接続
  connect() {
    // すでに接続済みなら何もしない
    if (this.socket) {
      return;
    }

    const userId = this.getUserId();
    const userName = this.getUserName();

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

  // メッセージ送信
  sendMessage(action, data = {}) {
    if (!this.socket?.connected) {
      console.log("送信データ", {
        action,
        ...data,
        userId: this.getUserId(),
        userName: this.getUserName(),
      });
      console.warn("socket未接続のため送信できません:", action, data);
      return;
    }

    this.socket.emit("message", {
      action,
      ...data,
      userId: this.getUserId(),
      userName: this.getUserName(),
    });
  }

  // イベントリスナー登録
  onMessage(callback) {
    if (!this.socket) {
      return;
    }

    this.socket.on("message", callback);
  }

  // イベントリスナー解除
  offMessage(callback) {
    if (!this.socket) {
      return;
    }

    this.socket.off("message", callback);
  }

  //Undo送信（ボタン用・1回1件処理）
  undo() {
    this.sendMessage("UNDO");
  }

  //Redo送信（ボタン用・1回1件処理）
  redo() {
    this.sendMessage("REDO");
  }

  //履歴ジャンプ送信（指定した履歴IDまで巻き戻す）
  jumpToHistory(targetId) {
    this.sendMessage("JUMP_TO_HISTORY", { targetId });
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