import { UsecanvasSocket } from "./Usecanvasocket";
import "./App.css";

const App = () => {
  const { shapes, history, addRect, updateRect, deleteRect, clearCanvas } = useCanvasSocket();

  return (
    <div className="app-container">
      <h1>リアルタイムキャンバス</h1>
      <div className="toolbar">
        <button onClick={addRect}>四角形を追加</button>
        <button onClick={clearCanvas}>全て消去</button>
      </div>

      <div className="canvas">
        {shapes.map((shape) => (
          <div
            key={shape.id}
            className="shape"
            onClick={() => updateRect(shape.id)}
            onContextMenu={(e) => { e.preventDefault(); deleteRect(shape.id); }}
            style={{
              left: `${shape.x}px`,
              top: `${shape.y}px`,
              width: `${shape.width}px`,
              height: `${shape.height}px`,
              backgroundColor: shape.fill,
            }}
          />
        ))}
      </div>

      <div className="history-section">
        <h2>編集履歴</h2>
        <ul className="history-list">
          {history.map((h, i) => (
            <li key={i}>
              {new Date(h.createdAt).toLocaleTimeString()} - {h.action}
              {h.objectId ? `（${h.objectId}）` : ""} by {h.userId}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default App;