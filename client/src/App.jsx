import { useEffect, useState } from "react";
import socketService from "./services/socketService";

const App = () => {
  const [shapes, setShapes] = useState([]);

  useEffect(() => {
    socketService.connect();

    // コールバック関数を変数として定義する
    // → こうすることで、後でoffMessageに同じ関数を渡して解除できる
    const handleMessage = (data) => {
      switch (data.action) {
        case "INIT":
          setShapes(data.objects);
          break;
        case "ADD":
          setShapes(prev => {
            // 念のための重複チェック（保険）
            if (prev.find(shape => shape.id === data.object.id)) {
              return prev;
            }
            return [...prev, data.object];
          });
          break;
        case "UPDATE":
          // 指定したIDの図形を更新する
          setShapes(prev => prev.map(shape => 
            shape.id === data.id ? { ...shape, ...data.changes } : shape
          ));
          break;
        case "DELETE":
          // 指定したIDの図形を削除する
          setShapes(prev => prev.filter(shape => shape.id !== data.id));
          break;
        case "CLEAR":
          // 全削除
          setShapes([]);
          break;
        default:
          console.log("不明なアクション:", data.action);
      }
    };

    socketService.onMessage(handleMessage);

    // クリーンアップ処理
    // コンポーネントが再実行・アンマウントされる前に、リスナーを解除する
    // これがないと、useEffectが2回走ったときにリスナーが2重登録されてしまう
    return () => {
      socketService.offMessage(handleMessage);
    };
  }, []);

  // --- 操作用関数 ---

  const addRect = () => {
    const newRect = {
      id: crypto.randomUUID(),
      type: 'rect',
      x: Math.random() * 300,
      y: Math.random() * 300,
      width: 100,
      height: 100,
      fill: '#4f8cff'
    };
    socketService.sendMessage("ADD", { object: newRect });
  };

  const updateRect = (id) => {
    // 例: 色をランダムに変更する処理
    socketService.sendMessage("UPDATE", { 
      id: id, 
      changes: { fill: '#' + Math.floor(Math.random()*16777215).toString(16) } 
    });
  };

  const deleteRect = (id) => {
    socketService.sendMessage("DELETE", { id: id });
  };

  const clearCanvas = () => {
    socketService.sendMessage("CLEAR", {});
  };

  return (
    <div style={{ padding: '20px' }}>
      <h1>リアルタイムキャンバス</h1>
      <div style={{ marginBottom: '20px' }}>
        <button onClick={addRect}>四角形を追加</button>
        <button onClick={clearCanvas} style={{ marginLeft: '10px' }}>全て消去</button>
      </div>

      <div style={{ position: 'relative', width: '800px', height: '600px', border: '1px solid #ccc' }}>
        {shapes.map((shape) => (
          <div
            key={shape.id}
            onClick={() => updateRect(shape.id)} // クリックで更新テスト
            onContextMenu={(e) => { e.preventDefault(); deleteRect(shape.id); }} // 右クリックで削除テスト
            style={{
              position: 'absolute',
              left: `${shape.x}px`,
              top: `${shape.y}px`,
              width: `${shape.width}px`,
              height: `${shape.height}px`,
              backgroundColor: shape.fill,
              cursor: 'pointer'
            }}
          />
        ))}
      </div>
      <p>操作方法: クリックで色変更 / 右クリックで削除</p>
    </div>
  );
};

export default App;