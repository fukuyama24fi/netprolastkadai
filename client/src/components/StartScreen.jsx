import { useState } from "react";
import socketService from "../services/socketService";
import "./StartScreen.css";

/**
 * 入室前に表示名を確定する。localStorage は既存の socketService に任せ、
 * App が mount して Socket.IO に接続するときに最新の名前を使わせる。
 */
export default function StartScreen({ onEnter }) {
  const [name, setName] = useState(() => {
    const savedName = socketService.getUserName();
    return savedName === "名無しさん" ? "" : savedName;
  });
  const [error, setError] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("表示名を入力してください。");
      return;
    }

    // サーバーに接続するより先に保存することが重要。
    socketService.setUserName(trimmedName);
    setError("");
    onEnter();
  };

  return (
    <main className="pikva-start">
      <section className="pikva-start__panel" aria-labelledby="pikva-start-title">
        <div className="pikva-start__logo">
          <img src="/pictuer/2aikon.png" alt="" aria-hidden="true" />
          <span>Pikva</span>
        </div>
        <p className="pikva-start__eyebrow">COLLABORATIVE CANVAS</p>
        <h1 id="pikva-start-title">アイデアを、みんなで形に。</h1>
        <p className="pikva-start__description">
          名前を入力して、共通キャンバスに参加しましょう。
          入力した名前は編集履歴とコメント欄に表示されます。
        </p>

        <form className="pikva-start__form" onSubmit={handleSubmit}>
          <label className="pikva-start__label" htmlFor="pikva-user-name">
            あなたの表示名 <span>（30文字以内）</span>
          </label>
          <input
            id="pikva-user-name"
            type="text"
            name="userName"
            autoComplete="nickname"
            className="pikva-start__name"
            placeholder="例：じゃぼ"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError("");
            }}
            maxLength={30}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "pikva-name-error" : undefined}
          />
          {error && (
            <p className="pikva-start__error" id="pikva-name-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="pikva-start__enter"
            type="submit"
            disabled={!name.trim()}
          >
            この名前で共通画面へ <span aria-hidden="true">→</span>
          </button>
        </form>

        <div className="pikva-start__details">
          <strong>共同編集とコメント</strong>
          <p>
            同じキャンバスを編集しながら、編集履歴タブでコメントを共有できます。
            保存ボタンでは図形をJSONファイルとしてダウンロードできます。
          </p>
        </div>
      </section>
    </main>
  );
}
