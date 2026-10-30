import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import StartScreen from "./components/StartScreen.jsx";
import socketService from "./services/socketService";
import "./index.css";
import "./EditorShell.css";

function Root() {
  const [screen, setScreen] = useState("start");

  const returnToStart = () => {
    socketService.disconnect();
    setScreen("start");
  };

  if (screen === "start") {
    return <StartScreen onEnter={() => setScreen("shared")} />;
  }

  return (
    <div className="pikva-editor-shell">
      <nav className="pikva-editor-shell__nav" aria-label="画面の切り替え">
        <button type="button" onClick={returnToStart}>
          開始画面
        </button>
        <span className="pikva-editor-shell__label">共通編集画面</span>
      </nav>
      <div className="pikva-editor-shell__app">
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
