import React, { useState } from 'react';

function App() {
  const [shapes, setShapes] = useState([]);

  // 図形を追加する関数
  const addShape = (type) => {
    const newShape = {
      id: crypto.randomUUID(),
      type,
      x: 50,
      y: 50,
      color: '#4f8cff'
    };
    setShapes([...shapes, newShape]);
  };

  return (
    <div>
      <div className="toolbar">
        <button onClick={() => addShape('rect')}>四角を追加</button>
        <button onClick={() => addShape('circle')}>丸を追加</button>
      </div>
      
      <div id="canvas" style={{ position: 'relative', width: '800px', height: '600px', border: '1px solid #ccc' }}>
        {shapes.map((shape) => (
          <div
            key={shape.id}
            style={{
              position: 'absolute',
              left: shape.x,
              top: shape.y,
              width: '100px',
              height: '100px',
              backgroundColor: shape.color,
              borderRadius: shape.type === 'circle' ? '50%' : '0%'
            }}
          >
            {shape.type}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;