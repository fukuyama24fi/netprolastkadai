const ALLOWED_TYPES = new Set([
  "rect",
  "circle",
  "triangle",
  "text",
]);

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

// CSSの文字列内で使える形へ変換
function escapeCSSString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\a ");
}

// 数値として利用できない場合は初期値を返す
function toSafeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

// 色コードを確認
function toSafeColor(
  value,
  fallback = "#4f8cff"
) {
  const color = String(value ?? "");

  if (
    /^#[0-9a-fA-F]{3,8}$/.test(color)
  ) {
    return color;
  }

  return fallback;
}

// ファイル名として使えない記号を置換
function toSafeFileName(
  value,
  fallback = "pikva-canvas"
) {
  const safeName = String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_");

  return safeName || fallback;
}

// DBのsnake_caseにも対応しながら図形データを整える
function normalizeObject(obj, index) {
  const type = ALLOWED_TYPES.has(obj.type)
    ? obj.type
    : "rect";

  return {
    id: String(obj.id ?? `shape-${index}`),
    type,

    x: toSafeNumber(obj.x),
    y: toSafeNumber(obj.y),

    width: Math.max(
      1,
      toSafeNumber(obj.width, 100)
    ),

    height: Math.max(
      1,
      toSafeNumber(obj.height, 100)
    ),

    fill: toSafeColor(
      obj.fill,
      type === "text"
        ? "#222222"
        : "#4f8cff"
    ),

    text: String(obj.text ?? ""),

    rotation: toSafeNumber(
      obj.rotation,
      0
    ),

    zIndex: Math.trunc(
      toSafeNumber(
        obj.zIndex ?? obj.z_index,
        index
      )
    ),

    fontSize: Math.max(
      8,
      toSafeNumber(
        obj.fontSize ?? obj.font_size,
        24
      )
    ),

    fontWeight:
      (
        obj.fontWeight ??
        obj.font_weight
      ) === "bold"
        ? "bold"
        : "normal",

    fontStyle:
      (
        obj.fontStyle ??
        obj.font_style
      ) === "italic"
        ? "italic"
        : "normal",

    textTransform:
      (
        obj.textTransform ??
        obj.text_transform
      ) === "uppercase"
        ? "uppercase"
        : "none",
  };
}

// 出力キャンバスの大きさを計算
function calculateCanvasSize(objects) {
  const width = Math.max(
    2000,
    ...objects.map((obj) => {
      return obj.x + obj.width + 100;
    })
  );

  const height = Math.max(
    1400,
    ...objects.map((obj) => {
      return obj.y + obj.height + 100;
    })
  );

  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
  };
}

// 1個の図形用CSSを生成
function createObjectCSS(obj) {
  const selectorId =
    escapeCSSString(obj.id);

  const styleParts = [
    `left: ${obj.x}px`,
    `top: ${obj.y}px`,
    `width: ${obj.width}px`,
    `height: ${obj.height}px`,
    `transform: rotate(${obj.rotation}deg)`,
    "transform-origin: center center",
    `z-index: ${obj.zIndex}`,
  ];

  if (obj.type === "rect") {
    styleParts.push(
      `background-color: ${obj.fill}`
    );
  }

  if (obj.type === "circle") {
    styleParts.push(
      `background-color: ${obj.fill}`,
      "border-radius: 50%"
    );
  }

  if (obj.type === "triangle") {
    styleParts.push(
      `background-color: ${obj.fill}`,
      "clip-path: polygon(50% 0%, 100% 100%, 0% 100%)"
    );
  }

  if (obj.type === "text") {
    styleParts.push(
      "background-color: transparent",
      `color: ${obj.fill}`,
      `font-size: ${obj.fontSize}px`,
      `font-weight: ${obj.fontWeight}`,
      `font-style: ${obj.fontStyle}`,
      `text-transform: ${obj.textTransform}`,
      "white-space: pre-wrap",
      "overflow-wrap: anywhere",
      "line-height: 1.2",
      "overflow: hidden"
    );
  }

  return `[data-pikva-id="${selectorId}"] {
  ${styleParts.join(";\n  ")};
}`;
}

// CSSコードを生成
function generateCSSCode(objects = []) {
  const normalizedObjects = objects.map(
    normalizeObject
  );

  const canvasSize =
    calculateCanvasSize(
      normalizedObjects
    );

  const objectCSS =
    normalizedObjects
      .map(createObjectCSS)
      .join("\n\n");

  return `* {
  box-sizing: border-box;
}

html,
body {
  width: 100%;
  min-height: 100%;
  margin: 0;
}

body {
  overflow: auto;
  background-color: #f0f0f0;
  font-family: sans-serif;
}

.canvas-container {
  position: relative;

  width: ${canvasSize.width}px;
  height: ${canvasSize.height}px;

  overflow: hidden;
  background-color: #ffffff;
}

.pikva-object {
  position: absolute;
  box-sizing: border-box;
}

${objectCSS}
`;
}

// HTMLコードを生成
function generateHTMLCode(
  objects = [],
  cssFileName = "pikva-canvas.css"
) {
  const normalizedObjects = objects.map(
    normalizeObject
  );

  const safeCSSFileName =
    escapeHTML(
      toSafeFileName(
        cssFileName,
        "pikva-canvas.css"
      )
    );

  const elements =
    normalizedObjects.map((obj) => {
      const id = escapeHTML(obj.id);

      const innerText =
        obj.type === "text"
          ? escapeHTML(obj.text)
          : "";

      return `    <div
      class="pikva-object ${obj.type}"
      data-pikva-id="${id}"
    >${innerText}</div>`;
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

  <link
    rel="stylesheet"
    href="./${safeCSSFileName}"
  >
</head>

<body>
  <div class="canvas-container">
${elements.join("\n")}
  </div>
</body>
</html>
`;
}

export {
  generateHTMLCode,
  generateCSSCode,
  toSafeFileName,
};