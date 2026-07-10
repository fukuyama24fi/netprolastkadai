import React, { useEffect, useState, useMemo } from 'react';
import SocketService from './services/socketService'; // 作成したサービスをインポート

const App = () => {
    // 1. キャンバスの状態を管理するState
    const [shapes, setShapes] = useState([]);
    
    // 2. SocketServiceのインスタンスを生成（再生成を防ぐためuseMemoを使用）
    const socketService = useMemo(() => new SocketService(), []);

    useEffect(() => {
        // 3. マウント時に接続
        socketService.connect();

        // 4. "message" イベントのリスナーを登録
        socketService.onMessage((data) => {
            console.log("サーバーからデータ受信:", data);
            
            // 受信したアクションに応じてStateを更新
            // 例: ADD アクションなら新しい図形を追加
            if (data.action === "ADD") {
                setShapes((prev) => [...prev, data.object]);
            }
            // 例: UPDATE アクションなら既存図形を修正など
            else if (data.action === "UPDATE") {
                setShapes((prev) => 
                    prev.map(s => s.id === data.id ? { ...s, ...data.changes } : s)
                );
            }
        });

        // 5. アンマウント時に切断（メモリリーク防止）
        return () => {
            // 必要であれば SocketService に disconnect() を実装して呼び出す
            // socketService.disconnect(); 
        };
    }, [socketService]);

    return (
        <div>
            <h1>リアルタイムキャンバス</h1>
            {/* ここで shapes をレンダリング */}
        </div>
    );
};

export default App;