import { useEffect, useState } from "react";
import socketService from "./services/socketService";

const App = () => {
    const [shapes, setShapes] = useState([]);
    
    useEffect(() => {
        socketService.connect();

        // サーバーからデータを受信した時の処理
        socketService.onMessage((data) => {
            if (data.action === "ADD") {
                setShapes((prev) => [...prev, data.object]);
            }
            // UPDATEなどはここに追加
        });
    }, [socketService]);

    // 四角形を追加する関数
    const addRect = () => {
        const newRect = {
            id: crypto.randomUUID(), // 一意なIDを生成
            type: 'rect',
            x: Math.random() * 300, // 適当な位置
            y: Math.random() * 300,
            width: 100,
            height: 100,
            fill: '#4f8cff'
        };

        // サーバーへ送信（これで全員の画面に同期されるはず）
        socketService.sendMessage("ADD", { object: newRect });
    };

    return (
        <div style={{ padding: '20px' }}>
            <h1>リアルタイムキャンバス</h1>
            <button onClick={addRect} style={{ marginBottom: '20px' }}>
                四角形を追加
            </button>

            {/* キャンバスエリア */}
            <div style={{ position: 'relative', width: '800px', height: '600px', border: '1px solid #ccc' }}>
                {shapes.map((shape) => (
                    <div
                        key={shape.id}
                        style={{
                            position: 'absolute',
                            left: `${shape.x}px`,
                            top: `${shape.y}px`,
                            width: `${shape.width}px`,
                            height: `${shape.height}px`,
                            backgroundColor: shape.fill
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default App;