//本番サーバーのAI機能を確認するためのテスト用スクリプト（確認したら消してOK）
//使い方: server フォルダで
//  node test-ai.mjs https://あなたのバックエンド.onrender.com
//AI_CHAT を送って返事を表示するだけ。キャンバスは変更しない（AI_APPLY は送らない）

import { io } from "socket.io-client";

const url = process.argv[2];
if (!url) {
    console.log("使い方: node test-ai.mjs https://あなたのバックエンド.onrender.com");
    process.exit(1);
}

const message = process.argv[3] || "小さな家を描いて";

console.log(`${url} に接続中...（Renderが寝ていると数十秒かかることがあります）`);
const socket = io(url, {
    query: { userId: "test-ai-script", userName: "テスト" },
    timeout: 60000
});

//60秒たっても返事がなければ終了
const timer = setTimeout(() => {
    console.log("60秒待っても返事がありませんでした。Renderのログを確認してください");
    socket.close();
    process.exit(1);
}, 60000);

socket.on("connect", () => {
    console.log("接続できました。AIに話しかけます:", message);
    socket.emit("message", { action: "AI_CHAT", requestId: "test", message, chatHistory: [] });
});

socket.on("connect_error", (err) => {
    console.log("接続エラー:", err.message);
});

socket.on("message", (data) => {
    if (data.action === "AI_REPLY") {
        console.log("\nAIの返事:", data.reply);
        console.log(`使ったAI: ${data.provider} / 操作 ${data.operations.length} 件 / 除外 ${data.skipped} 件`);
        console.log("提案された操作:");
        console.log(JSON.stringify(data.operations, null, 2));
        finish();
    } else if (data.action === "AI_ERROR") {
        console.log("\nAIエラー:", data.message);
        console.log("Renderのログに [AI] で始まる行が出ているはずなので、それを見てください");
        finish();
    }
});

function finish() {
    clearTimeout(timer);
    socket.close();
    process.exit(0);
}
