import { useEffect, useState } from "react";
import socketService from "./socketService";

// キャンバスの状態管理とサーバーとの通信をまとめたカスタムフック
// Javaで例えると「Service層」。画面(View = App.jsx)から通信処理を切り離すためのもの。
export function useCanvasSocket() {
  const [shapes, setShapes] = useState([]);
  const [history, setHistory] = useState([]); // 過去の操作履歴

  useEffect(() => {
    socketService.connect();

    socketService.onMessage((data) => {
      switch (data.action) {
        case "INIT":
          setShapes(data.objects);
          break;
        case "HISTORY_RESPONSE":
          setHistory(data.history);
          break;
        case "ADD":
          setShapes(prev => [...prev, data.object]);
          //リアルタイムに履歴を書く
          if (data.history) {
            setHistory(prev => [...prev, data.history]);
          }
          break;
        case "UPDATE":
          // 指定したIDの図形を更新する
          setShapes(prev => prev.map(shape =>
            shape.id === data.id ? { ...shape, ...data.changes } : shape
          ));
          if (data.history) {
            setHistory(prev => [...prev, data.history]);
          }
          break;
        case "DELETE":
          // 指定したIDの図形を削除する
          setShapes(prev => prev.filter(shape => shape.id !== data.id));
          if (data.history) {
            setHistory(prev => [...prev, data.history]);
          }
          break;
        case "CLEAR":
          // 全削除
          setShapes([]);
          if (data.history) {
            setHistory(prev => [...prev, data.history]);
          }
          break;
        default:
          console.log("不明なアクション:", data.action);
      }
    });
  }, []);

  // --- 操作用関数（画面側から呼び出す） ---

  const addRect = () => {
    const newRect = {
      id: crypto.randomUUID(),
      type: 'rect',
      x:  300,
      y:  300,
      width: 100,
      height: 100,
      fill: '#4f8cff'
    };
    socketService.sendMessage("ADD", { object: newRect });
  };

  const updateRect = (id,changes) => {
    // 例: 色をランダムに変更する処理
    socketService.sendMessage("UPDATE", {
      id: id,
      changes,
      });
  };

  const deleteRect = (id) => {
    socketService.sendMessage("DELETE", { id: id });
  };

  const clearCanvas = () => {
    socketService.sendMessage("CLEAR", {});
  };

  // App.jsx側で使いたいものだけをまとめて返す
  return { shapes, history, addRect, updateRect, deleteRect, clearCanvas };
}