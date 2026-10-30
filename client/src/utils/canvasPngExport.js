/**
 * Pikva PNG出力（追加npmパッケージ不要）。
 * 編集用のガイド線や選択枠は描かず、図形データそのものから生成する。
 * 注意: HTMLのレンダリング結果を複製する方式ではないため、テキストの折り返しは簡易実装。
 */

const CLIP_POLYGONS = {
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  diamond: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  pentagon: [[0.5, 0], [1, 0.38], [0.82, 1], [0.18, 1], [0, 0.38]],
  hexagon: [[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]],
  star: [[0.5, 0], [0.61, 0.35], [0.98, 0.35], [0.68, 0.57], [0.79, 0.91], [0.5, 0.70], [0.21, 0.91], [0.32, 0.57], [0.02, 0.35], [0.39, 0.35]],
  arrow: [[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]],
};

function normalizeRadius(shape, saved) {
  const local = saved?.[String(shape.id)];
  if (typeof local === "number" && Number.isFinite(local)) {
    return Math.max(0, Math.min(100, Math.round(local)));
  }
  return shape.type === "rounded" ? 18 : 0;
}

function drawPolygon(ctx, vertices, width, height) {
  ctx.beginPath();
  vertices.forEach(([fx, fy], i) => {
    if (i === 0) ctx.moveTo(fx * width, fy * height);
    else ctx.lineTo(fx * width, fy * height);
  });
  ctx.closePath();
  ctx.fill();
}

function drawRoundedRect(ctx, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();
}

function drawText(ctx, shape, width, height) {
  const size = Math.max(8, Math.min(200, Number(shape.fontSize) || 24));
  const weight = shape.fontWeight === "bold" ? "bold" : "normal";
  const style = shape.fontStyle === "italic" ? "italic" : "normal";
  ctx.font = `${style} ${weight} ${size}px sans-serif`;
  ctx.fillStyle = shape.fill || "#222222";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const text = shape.text || "テキスト";
  const content = shape.textTransform === "uppercase" ? text.toUpperCase() : text;
  const lineHeight = size * 1.2;
  const available = Math.max(0, width - 16);
  let y = 4;
  // CSS側のpadding: 4px 8px, line-height:1.2, white-space:pre-wrap に近づける
  for (const paragraph of String(content).split(/\r?\n/)) {
    let line = "";
    if (!paragraph) {
      y += lineHeight;
      if (y >= height) break;
      continue;
    }
    for (const char of paragraph) {
      if (y >= height) break;
      const next = line + char;
      if (line && ctx.measureText(next).width > available) {
        ctx.fillText(line, 8, y);
        y += lineHeight;
        line = char;
      } else {
        line = next;
      }
    }
    if (y >= height) break;
    if (line) ctx.fillText(line, 8, y);
    y += lineHeight;
  }
}

function drawShape(ctx, shape, radii) {
  if (!shape) return;
  const x = Number(shape.x);
  const y = Number(shape.y);
  const width = Number(shape.width);
  const height = Number(shape.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
  ctx.save();
  // DOMの各図形は中心を基準に回転する
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate((Number(shape.rotation) || 0) * Math.PI / 180);
  ctx.translate(-width / 2, -height / 2);
  ctx.fillStyle = shape.fill || "#4f8cff";
  if (shape.type === "text") {
    drawText(ctx, shape, width, height);
  } else if (shape.type === "circle") {
    ctx.beginPath();
    ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (CLIP_POLYGONS[shape.type]) {
    drawPolygon(ctx, CLIP_POLYGONS[shape.type], width, height);
  } else {
    drawRoundedRect(ctx, width, height, normalizeRadius(shape, radii));
  }
  ctx.restore();
}

export async function exportCanvasPng({ shapes, canvasWidth, canvasHeight, fileName, localBorderRadii = {} }) {
  const width = Math.ceil(Number(canvasWidth));
  const height = Math.ceil(Number(canvasHeight));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 40000000) {
    throw new Error("キャンバスが大きすぎるため画像化できません（最大4,000万画素）。");
  }
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2Dが利用できません。");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  (Array.isArray(shapes) ? shapes : [])
    .map((shape, index) => ({ shape, index }))
    .sort((a, b) => {
      const az = Number.isFinite(Number(a.shape.zIndex)) ? Number(a.shape.zIndex) : a.index;
      const bz = Number.isFinite(Number(b.shape.zIndex)) ? Number(b.shape.zIndex) : b.index;
      return az - bz || a.index - b.index;
    })
    .forEach(({ shape }) => drawShape(ctx, shape, localBorderRadii));

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG生成に失敗しました。")), "image/png");
  });
  const safeName = String(fileName || "pikva-canvas")
    .trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\.+$/, "").slice(0, 100) || "pikva-canvas";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
