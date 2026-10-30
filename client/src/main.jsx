import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import StartScreen from "./components/StartScreen.jsx";
import socketService from "./services/socketService";
import "./index.css";
import "./EditorShell.css";
// スマホ用CSSは必ず最後に読み込む。App.jsx の既存機能は変更しない。
import "./MobileSupport.css";

function Root() {
  const [screen, setScreen] = useState("start");
  const [mobilePanel, setMobilePanel] = useState("canvas");

  const returnToStart = () => {
    socketService.disconnect();
    setMobilePanel("canvas");
    setScreen("start");
  };

  if (screen === "start") {
    return <StartScreen onEnter={() => {
      setMobilePanel("canvas");
      setScreen("shared");
    }} />;
  }

  const mobileViews = [
    { id: "canvas", label: "キャンバス" },
    { id: "tools", label: "図形・編集" },
    { id: "history", label: "コメント・履歴" },
  ];

  return (
    <div className="pikva-editor-shell">
      <nav className="pikva-editor-shell__nav" aria-label="画面の切り替え">
        <button type="button" onClick={returnToStart}>
          開始画面
        </button>
        <span className="pikva-editor-shell__label">共通編集画面</span>
        {/* 横画面スマホのみ表示。既存 App は再マウントしない */}
        <div className="pikva-editor-shell__mobile-tabs" role="group" aria-label="表示するパネル">
          {mobileViews.map(({ id, label }) => (
            <button
              type="button"
              key={id}
              className={mobilePanel === id ? "is-active" : ""}
              aria-pressed={mobilePanel === id}
              onClick={() => setMobilePanel(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className={`pikva-editor-shell__app mobile-view-${mobilePanel}`}>
        <App />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
