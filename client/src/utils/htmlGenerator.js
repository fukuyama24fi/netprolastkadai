/**
 * HTML/CSS生成ユーティリティ
 * キャンバス状態から静的HTMLコードを生成
 */

/**
 * HTML特殊文字をエスケープ
 * @param {any} value - エスケープする値
 * @returns {string} エスケープされた文字列
 */
export function escapeGeneratedHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

/**
 * 安全な数値取得
 * @param {any} value - 取得する値
 * @param {number} fallback - フォールバック値
 * @returns {number} 有効な数値
 */
export function getSafeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * 図形タイプから対応するCSS記述を生成
 * @param {string} type - 図形タイプ
 * @param {string} fill - 塗りつぶし色
 * @param {object} fontProps - フォント関連プロパティ
 * @returns {string[]} CSSプロパティの配列
 */
function getTypeSpecificStyles(type, fill, fontProps = {}) {
  const styles = [];

  if (type === "rect") {
    styles.push(`background-color: ${fill}`);
  } else if (type === "circle") {
    styles.push(`background-color: ${fill}`, "border-radius: 50%");
  } else if (type === "triangle") {
    styles.push(
      `background-color: ${fill}`,
      "clip-path: polygon(50% 0%, 100% 100%, 0% 100%)"
    );
  } else if (type === "text") {
    styles.push(
      "background-color: transparent",
      `color: ${fill}`,
      `font-size: ${getSafeNumber(fontProps.fontSize, 24)}px`,
      `font-weight: ${fontProps.fontWeight || "normal"}`,
      `font-style: ${fontProps.fontStyle || "normal"}`,
      `text-transform: ${fontProps.textTransform || "none"}`,
      "white-space: pre-wrap",
      "overflow-wrap: anywhere",
      "line-height: 1.2"
    );
  }

  return styles;
}

/**
 * 単一の図形のCSSクラスを生成
 * @param {object} shape - 図形オブジェクト
 * @param {number} index - 配列内のインデックス
 * @returns {string} CSS定義
 */
function generateShapeCssClass(shape, index) {
  const x = getSafeNumber(shape.x);
  const y = getSafeNumber(shape.y);
  const width = getSafeNumber(shape.width, 100);
  const height = getSafeNumber(shape.height, 100);
  const rotation = getSafeNumber(shape.rotation);
  const zIndex = Number.isFinite(Number(shape.zIndex))
    ? Number(shape.zIndex)
    : index;

  const fill = shape.fill || "#4f8cff";
  const type = shape.type || "rect";

  const styleParts = [
    `left: ${x}px`,
    `top: ${y}px`,
    `width: ${width}px`,
    `height: ${height}px`,
    `transform: rotate(${rotation}deg)`,
    "transform-origin: center center",
    `z-index: ${zIndex}`,
  ];

  const typeStyles = getTypeSpecificStyles(type, fill, shape);
  styleParts.push(...typeStyles);

  return `.pikva-object-${index} {\n  ${styleParts.join(";\n  ")};\n}`;
}

/**
 * 図形配列からフロントエンド用CSSを生成
 * @param {array} shapes - 図形オブジェクトの配列
 * @returns {string} 完全なCSS
 */
export function generateFrontendCss(shapes = []) {
  const shapeCss = shapes.map((shape, index) =>
    generateShapeCssClass(shape, index)
  );

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
  background: #f0f0f0;
  font-family: sans-serif;
}

.canvas-container {
  position: relative;
  width: 2000px;
  height: 1400px;
  overflow: hidden;
  background: #ffffff;
}

.pikva-object {
  position: absolute;
  box-sizing: border-box;
}

${shapeCss.join("\n\n")}
`;
}

/**
 * 図形配列からフロントエンド用HTMLを生成
 * @param {array} shapes - 図形オブジェクトの配列
 * @param {string} cssFileName - CSSファイル名
 * @returns {string} 完全なHTML
 */
export function generateFrontendHtml(shapes = [], cssFileName = "pikva-canvas.css") {
  const VALID_SHAPE_TYPES = ["rect", "circle", "triangle", "text"];

  const elements = shapes.map((shape, index) => {
    const type = VALID_SHAPE_TYPES.includes(shape.type) ? shape.type : "rect";
    const text =
      type === "text" ? escapeGeneratedHtml(shape.text || "テキスト") : "";

    return `    <div class="pikva-object pikva-object-${index} ${type}">${text}</div>`;
  });

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pikva Generated Page</title>
  <link rel="stylesheet" href="./${escapeGeneratedHtml(cssFileName)}">
</head>
<body>
  <div class="canvas-container">
${elements.join("\n")}
  </div>
</body>
</html>`;
}
