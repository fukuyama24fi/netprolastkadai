const ALLOWED_TYPES = new Set([
  "rect",
  "circle",
  "triangle",
  "text",
]);

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

function toSafeNumber(
  value,
  fallback = 0
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

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

export function toSafeFileName(
  value,
  fallback = "pikva-canvas"
) {
  const safeName = String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_");

  return safeName || fallback;
}

function normalizeShape(shape, index) {
  const type = ALLOWED_TYPES.has(
    shape.type
  )
    ? shape.type
    : "rect";

  return {
    id: String(
      shape.id ?? `shape-${index}`
    ),

    type,

    x: toSafeNumber(shape.x),
    y: toSafeNumber(shape.y),

    width: Math.max(
      1,
      toSafeNumber(
        shape.width,
        100
      )
    ),

    height: Math.max(
      1,
      toSafeNumber(
        shape.height,
        100
      )
    ),

    fill: toSafeColor(
      shape.fill,
      type === "text"
        ? "#222222"
        : "#4f8cff"
    ),

    text: String(
      shape.text ?? ""
    ),

    rotation: toSafeNumber(
      shape.rotation
    ),

    zIndex: Math.trunc(
      toSafeNumber(
        shape.zIndex,
        index
      )
    ),

    fontSize: Math.max(
      8,
      toSafeNumber(
        shape.fontSize,
        24
      )
    ),

    fontWeight:
      shape.fontWeight === "bold"
        ? "bold"
        : "normal",

    fontStyle:
      shape.fontStyle === "italic"
        ? "italic"
        : "normal",

    textTransform:
      shape.textTransform ===
      "uppercase"
        ? "uppercase"
        : "none",
  };
}

function getCanvasSize(shapes) {
  const width = Math.max(
    2000,
    ...shapes.map((shape) => {
      return (
        shape.x +
        shape.width +
        100
      );
    })
  );

  const height = Math.max(
    1400,
    ...shapes.map((shape) => {
      return (
        shape.y +
        shape.height +
        100
      );
    })
  );

  return {
    width: Math.ceil(width),
    height: Math.ceil(height),
  };
}

export function generateCSSCode(
  sourceShapes = []
) {
  const shapes = sourceShapes.map(
    normalizeShape
  );

  const canvasSize =
    getCanvasSize(shapes);

  const shapeRules = shapes.map(
    (shape) => {
      const styleParts = [
        `left: ${shape.x}px`,
        `top: ${shape.y}px`,
        `width: ${shape.width}px`,
        `height: ${shape.height}px`,
        `transform: rotate(${shape.rotation}deg)`,
        "transform-origin: center center",
        `z-index: ${shape.zIndex}`,
      ];

      if (shape.type === "rect") {
        styleParts.push(
          `background-color: ${shape.fill}`
        );
      }

      if (shape.type === "circle") {
        styleParts.push(
          `background-color: ${shape.fill}`,
          "border-radius: 50%"
        );
      }

      if (
        shape.type === "triangle"
      ) {
        styleParts.push(
          `background-color: ${shape.fill}`,
          "clip-path: polygon(50% 0%, 100% 100%, 0% 100%)"
        );
      }

      if (shape.type === "text") {
        styleParts.push(
          "background-color: transparent",
          `color: ${shape.fill}`,
          `font-size: ${shape.fontSize}px`,
          `font-weight: ${shape.fontWeight}`,
          `font-style: ${shape.fontStyle}`,
          `text-transform: ${shape.textTransform}`,
          "white-space: pre-wrap",
          "overflow-wrap: anywhere",
          "line-height: 1.2",
          "overflow: hidden"
        );
      }

      return `[data-pikva-id="${shape.id}"] {
  ${styleParts.join(";\n  ")};
}`;
    }
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

${shapeRules.join("\n\n")}
`;
}

export function generateHTMLCode(
  sourceShapes = [],
  cssFileName = "pikva-canvas.css"
) {
  const shapes = sourceShapes.map(
    normalizeShape
  );

  const safeCSSFileName =
    escapeHTML(cssFileName);

  const elements = shapes.map(
    (shape) => {
      const id =
        escapeHTML(shape.id);

      const text =
        shape.type === "text"
          ? escapeHTML(shape.text)
          : "";

      return `    <div class="pikva-object ${shape.type}" data-pikva-id="${id}">${text}</div>`;
    }
  );

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

export function downloadTextFile({
  content,
  fileName,
  mimeType,
}) {
  const blob = new Blob(
    [content],
    {
      type: mimeType,
    }
  );

  const downloadUrl =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = downloadUrl;
  link.download = fileName;

  document.body.appendChild(link);
  link.click();
  link.remove();

  /*
   * click直後に解放すると、
   * 一部環境で保存が失敗する場合があるため
   * 少し遅らせる。
   */
  window.setTimeout(() => {
    URL.revokeObjectURL(
      downloadUrl
    );
  }, 1000);
}