// HTMLへ埋め込む文字を安全な形式へ変換
function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };

      return entities[character];
    }
  );
}

// 数値として利用できない場合は初期値を返す
function toSafeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

// Pikvaのカラーピッカーで使う16進カラーを確認
function toSafeColor(value, fallback = "#4f8cff") {
  const color = String(value ?? "");

  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) {
    return color;
  }

  return fallback;
}

// キャンバスのJSON配列からHTMLコードを生成する
function generateHTMLCode(objects = []) {
  const allowedTypes = new Set([
    "rect",
    "circle",
    "triangle",
    "text",
  ]);

  const elements = objects.map((obj) => {
    const type = allowedTypes.has(obj.type)
      ? obj.type
      : "rect";

    const x = toSafeNumber(obj.x);
    const y = toSafeNumber(obj.y);
    const width = toSafeNumber(obj.width, 100);
    const height = toSafeNumber(obj.height, 100);
    const rotation = toSafeNumber(obj.rotation);
    const zIndex = toSafeNumber(obj.zIndex);

    const fill = toSafeColor(
      obj.fill,
      type === "text"
        ? "#222222"
        : "#4f8cff"
    );

    /*
     * 配列にスタイルを追加していくことで、
     * let styleの二重宣言を防ぐ
     */
    const styleParts = [
      "position: absolute",
      `left: ${x}px`,
      `top: ${y}px`,
      `width: ${width}px`,
      `height: ${height}px`,
      `transform: rotate(${rotation}deg)`,
      "transform-origin: center center",
      `z-index: ${zIndex}`,
      "box-sizing: border-box",
    ];

    // 円
    if (type === "circle") {
      styleParts.push(
        "border-radius: 50%",
        `background-color: ${fill}`
      );
    }

    // 三角形
    if (type === "triangle") {
      styleParts.push(
        "clip-path: polygon(50% 0%, 100% 100%, 0% 100%)",
        `background-color: ${fill}`
      );
    }

    // テキスト
    if (type === "text") {
      const fontSize = Math.max(
        8,
        toSafeNumber(obj.fontSize, 24)
      );

      const fontWeight =
        obj.fontWeight === "bold"
          ? "bold"
          : "normal";

      const fontStyle =
        obj.fontStyle === "italic"
          ? "italic"
          : "normal";

      const textTransform =
        obj.textTransform === "uppercase"
          ? "uppercase"
          : "none";

      styleParts.push(
        "background-color: transparent",
        `color: ${fill}`,
        `font-size: ${fontSize}px`,
        `font-weight: ${fontWeight}`,
        `font-style: ${fontStyle}`,
        `text-transform: ${textTransform}`,
        "white-space: pre-wrap",
        "overflow-wrap: anywhere",
        "line-height: 1.2"
      );
    }

    // 四角形
    if (type === "rect") {
      styleParts.push(
        `background-color: ${fill}`
      );
    }

    const id = escapeHTML(obj.id || "");
    const innerText =
      type === "text"
        ? escapeHTML(obj.text || "")
        : "";

    const style = `${styleParts.join("; ")};`;

    return `<div id="${id}" class="${type}" style="${style}">${innerText}</div>`;
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >
  <title>Pikva Generated Code</title>

  <style>
    * {
      box-sizing: border-box;
    }

    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
    }

    body {
      overflow: auto;
      font-family: sans-serif;
    }

    .canvas-container {
      position: relative;

      width: 2000px;
      min-height: 1400px;

      overflow: hidden;
      background-color: #f0f0f0;
    }
  </style>
</head>

<body>
  <div class="canvas-container">
    ${elements.join("\n    ")}
  </div>
</body>
</html>`;
}

export { generateHTMLCode };