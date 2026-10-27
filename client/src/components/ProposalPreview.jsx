import { useMemo, useState } from "react";

/*
 * AIの提案を「反映したらこうなる」と小さく見せるプレビュー
 * 今のキャンバス（shapes）のコピーに操作を当てはめて SVG で描くだけ
 * サーバーにも本物のキャンバスにも何も送らない・何も変えない
 *
 * 受け取るもの（props）
 *   shapes     : 提案を当てはめる元のキャンバスの図形
 *                （反映する前は今のキャンバス、反映した後は反映した瞬間に保存したキャンバス）
 *   operations : AIの提案（形は useAiChat.js の説明を参照）
 *   beforeLabel: 「反映前」側の切り替えボタンの名前（反映する前は「今のキャンバス」、反映した後は「反映前」）
 *
 * 表示の決まり
 *   「反映後」         : 変わらない図形は薄く、追加・変更される図形は青い点線で囲む、削除される図形は赤い点線の枠だけ
 *   「今のキャンバス」/「反映前」 : 元のキャンバス（shapes）をそのまま描く
 *   表示範囲は「変わる図形」の周りに絞って拡大する（遠くに図形があっても小さくなりすぎないように）
 *
 * SVG の viewBox を使うと、キャンバスの座標（px）をそのまま使って描いても
 * 小さい枠に自動で縮小して表示してくれる
 */

// 図形が1つも無いときの表示範囲（キャンバスの標準サイズ）
const DEFAULT_BOUNDS = { minX: 0, minY: 0, maxX: 2000, maxY: 1400 };
// 表示範囲の外側に足す余白（キャンバスの座標の単位）
const PADDING = 30;
// 追加・変更される図形の枠の色
const HIGHLIGHT = "#4f8cff";
// 削除される図形の枠の色
const DELETE_COLOR = "#e5484d";

// 操作を当てはめた結果を作る（元の shapes は変更しない）
// 戻り値: { before: 図形[], after: 図形[], deleted: 図形[], status: { id → "new" | "changed" } }
//   before  : 今のキャンバス（コピー）
//   after   : 提案を反映した後のキャンバス
//   deleted : 削除される図形（赤い点線で描くために残しておく）
//   status  : 追加される図形は "new"、変更される図形は "changed"。変わらない図形は入らない
function simulate(shapes, operations) {
  // { ...s } で1つずつコピーしてから使う（元の shapes を書き換えないため）
  const before = shapes.map((s) => ({ ...s }));
  let after = shapes.map((s) => ({ ...s }));
  const deleted = [];
  const status = {};

  // 新しい図形は一番手前に重ねる（サーバーが反映するときと同じ考え方）
  // zIndex が無い図形は、配列の順番を代わりに使う
  let maxZ = after.reduce((max, s, i) => {
    const z = Number(s.zIndex);
    return Math.max(max, Number.isFinite(z) ? z : i);
  }, -1);

  operations.forEach((op, index) => {
    if (op.op === "add") {
      // 追加される図形にはまだ id が無いので、プレビュー用の仮の id を付ける
      const id = `preview-${index}`;
      maxZ += 1;
      after.push({ ...op, id, zIndex: maxZ }); // op の "op" 項目が残るが描画には使わない
      status[id] = "new";
    } else if (op.op === "update") {
      // 対象の図形に、変わる項目（changes）だけを上書きする
      after = after.map((s) =>
        s.id === op.id ? { ...s, ...op.changes } : s
      );
      if (status[op.id] !== "new") status[op.id] = "changed";
    } else if (op.op === "delete") {
      // after からは消すが、赤い点線で描くために deleted に残す
      const target = after.find((s) => s.id === op.id);
      if (target) deleted.push(target);
      after = after.filter((s) => s.id !== op.id);
    }
  });

  return { before, after, deleted, status };
}

// 全部の図形が収まる範囲を計算する
// shapeLists は図形の配列の配列（例: [before, after]）。まとめて1つの範囲にする
// 戻り値: { minX, minY, maxX, maxY }（一番左上と一番右下の座標）
function getBounds(shapeLists) {
  const all = shapeLists.flat();
  if (all.length === 0) return DEFAULT_BOUNDS;

  return all.reduce(
    (b, s) => ({
      minX: Math.min(b.minX, s.x),
      minY: Math.min(b.minY, s.y),
      maxX: Math.max(b.maxX, s.x + s.width),
      maxY: Math.max(b.maxY, s.y + s.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
}

// zIndex の小さい順に並べるための比較関数（SVG は後に描いたものが手前に来るため）
function byZIndex(a, b) {
  return (Number(a.zIndex) || 0) - (Number(b.zIndex) || 0);
}

// 図形1つを SVG で描く（キャンバスの見た目に合わせる）
//   opacity : 透明度（変わらない図形を薄くするのに使う）
//   ghost   : true なら削除される図形として、赤い点線の枠だけ描く
// キャンバスと同じく x, y は図形の左上の角
function PreviewShape({ shape, opacity = 1, ghost = false }) {
  const { x, y, width: w, height: h } = shape;
  const rotation = Number(shape.rotation) || 0;
  // キャンバスと同じく、図形の中心を軸に回転させる
  const transform = rotation
    ? `rotate(${rotation} ${x + w / 2} ${y + h / 2})`
    : undefined;

  // 削除される図形は中身を描かず、赤い点線の枠だけにする
  const fill = ghost ? "none" : shape.fill;
  const ghostStroke = ghost
    ? {
      stroke: DELETE_COLOR,
      strokeWidth: 2,
      strokeDasharray: "6 4", // 6px の線と 4px のすき間を繰り返す点線
      // 縮小表示しても線の太さが変わらないようにする（これが無いと線が細すぎて見えなくなる）
      vectorEffect: "non-scaling-stroke",
    }
    : {};

  let body;
  switch (shape.type) {
    // 円は幅と高さが違うと楕円になる（キャンバスの border-radius: 50% と同じ見た目）
    case "circle":
      body = (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={fill}
          {...ghostStroke}
        />
      );
      break;
    // 三角は上向き。頂点は「上の真ん中」「右下」「左下」（App.css の clip-path と同じ）
    case "triangle":
      body = (
        <polygon
          points={`${x + w / 2},${y} ${x + w},${y + h} ${x},${y + h}`}
          fill={fill}
          {...ghostStroke}
        />
      );
      break;
    // テキストは枠の左上から少し内側に書く（App.css の .text-value の padding: 4px 8px に合わせている）
    // fill はテキストのときは文字の色になる（キャンバスと同じ）
    case "text": {
      if (ghost) {
        body = <rect x={x} y={y} width={w} height={h} fill="none" {...ghostStroke} />;
        break;
      }
      const fontSize = Number(shape.fontSize) || 24;
      const raw = shape.text ?? "";
      // SVG では text-transform が効かないブラウザがあるので、大文字化は自分で行う
      const text =
        shape.textTransform === "uppercase" ? raw.toUpperCase() : raw;
      body = (
        <text
          x={x + 8}
          y={y + 4}
          fill={shape.fill}
          fontSize={fontSize}
          fontWeight={shape.fontWeight || "normal"}
          fontStyle={shape.fontStyle || "normal"}
          dominantBaseline="hanging" // y を文字の上端として扱う（指定しないと文字の下端になる）
        >
          {/* SVG の text は自動で改行しないので、改行ごとに tspan で1行ずつ下にずらす */}
          {text.split("\n").map((line, i) => (
            <tspan key={i} x={x + 8} dy={i === 0 ? 0 : fontSize * 1.2}>
              {line}
            </tspan>
          ))}
        </text>
      );
      break;
    }
    case "rect":
    default:
      body = (
        <rect x={x} y={y} width={w} height={h} fill={fill} {...ghostStroke} />
      );
  }

  return (
    <g transform={transform} opacity={opacity}>
      {body}
    </g>
  );
}

// 追加・変更される図形を囲む青い点線の枠
// 図形より少し大きく（上下左右4ずつ）描いて、図形に重ならないようにする
function HighlightBox({ shape }) {
  const { x, y, width: w, height: h } = shape;
  const rotation = Number(shape.rotation) || 0;
  return (
    <rect
      x={x - 4}
      y={y - 4}
      width={w + 8}
      height={h + 8}
      fill="none"
      stroke={HIGHLIGHT}
      strokeWidth={1.5}
      strokeDasharray="5 4"
      vectorEffect="non-scaling-stroke"
      transform={
        rotation ? `rotate(${rotation} ${x + w / 2} ${y + h / 2})` : undefined
      }
    />
  );
}

export default function ProposalPreview({
  shapes,
  operations,
  beforeLabel = "今のキャンバス",
}) {
  // "after" = 反映後、"before" = 元のキャンバス（ボタンの名前は beforeLabel）
  const [mode, setMode] = useState("after");

  // shapes か operations が変わったときだけ計算し直す（useMemo）
  // 他の人がキャンバスを動かすと shapes が変わるので、プレビューも自動で最新になる
  const { before, after, deleted, status } = useMemo(
    () => simulate(shapes, operations),
    [shapes, operations]
  );

  // 「変わる図形」の周りを拡大して表示する
  // 反映前と反映後で同じ範囲を使う（切り替えても画面がずれないように）
  const bounds = useMemo(() => {
    const changedIds = new Set(Object.keys(status));
    const focus = [
      ...after.filter((s) => changedIds.has(s.id)), // 追加・変更後の位置
      ...before.filter((s) => changedIds.has(s.id)), // 変更前の位置
      ...deleted, // 削除される図形
    ];
    // 変わる図形が無ければ、全体を表示する
    if (focus.length === 0) {
      return getBounds([before, after]);
    }
    const b = getBounds([focus]);
    // 周りの図形も少し見えるように余白を足す（範囲の25%、最低でも80）
    const marginX = Math.max(80, (b.maxX - b.minX) * 0.25);
    const marginY = Math.max(80, (b.maxY - b.minY) * 0.25);
    return {
      minX: b.minX - marginX,
      minY: b.minY - marginY,
      maxX: b.maxX + marginX,
      maxY: b.maxY + marginY,
    };
  }, [before, after, deleted, status]);

  // SVG の viewBox は「左上の x, 左上の y, 幅, 高さ」の順
  // この範囲がプレビューの枠いっぱいに表示される
  const viewWidth = bounds.maxX - bounds.minX + PADDING * 2;
  const viewHeight = bounds.maxY - bounds.minY + PADDING * 2;
  const viewBox = [
    bounds.minX - PADDING,
    bounds.minY - PADDING,
    viewWidth,
    viewHeight,
  ].join(" ");

  const hasChanges = Object.keys(status).length > 0 || deleted.length > 0;
  const showingAfter = mode === "after";

  return (
    <div className="ai-preview">
      {/* 「反映後 / 今のキャンバス（反映前）」の切り替えボタン */}
      <div className="ai-preview-toggle" role="tablist">
        <button
          type="button"
          className={showingAfter ? "active" : ""}
          onClick={() => setMode("after")}
        >
          反映後
        </button>
        <button
          type="button"
          className={!showingAfter ? "active" : ""}
          onClick={() => setMode("before")}
        >
          {beforeLabel}
        </button>
      </div>

      {/* preserveAspectRatio="xMidYMid meet" : 縦横比を保ったまま、枠に収まるように縮小して真ん中に置く */}
      {/* aspectRatio : 表示範囲の縦横比に合わせて枠の高さを決める（高さの上限・下限は App.css） */}
      <svg
        className="ai-preview-canvas"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}
        role="img"
        aria-label={showingAfter ? "反映後のプレビュー" : beforeLabel}
      >
        {/* 背景（キャンバスの白） */}
        <rect
          x={bounds.minX - PADDING}
          y={bounds.minY - PADDING}
          width={viewWidth}
          height={viewHeight}
          fill="white"
        />

        {showingAfter ? (
          <>
            {/* 変わらない図形は薄く、追加・変更される図形ははっきり描く */}
            {[...after].sort(byZIndex).map((shape) => (
              <PreviewShape
                key={shape.id}
                shape={shape}
                opacity={status[shape.id] ? 1 : 0.35}
              />
            ))}
            {/* 削除される図形（赤い点線の枠） */}
            {deleted.map((shape) => (
              <PreviewShape key={`del-${shape.id}`} shape={shape} ghost />
            ))}
            {/* 青い点線の枠は、他の図形に隠れないよう最後に描く */}
            {after
              .filter((shape) => status[shape.id])
              .map((shape) => (
                <HighlightBox key={`hl-${shape.id}`} shape={shape} />
              ))}
          </>
        ) : (
          // 元のキャンバスをそのまま描く（[...before] でコピーしてから並べ替える）
          [...before]
            .sort(byZIndex)
            .map((shape) => <PreviewShape key={shape.id} shape={shape} />)
        )}
      </svg>

      {/* 色の意味の説明（反映後を見ているときだけ） */}
      {showingAfter && hasChanges && (
        <div className="ai-preview-legend">
          <span className="ai-preview-legend-new">青い点線：追加・変更</span>
          {deleted.length > 0 && (
            <span className="ai-preview-legend-del">赤い点線：削除</span>
          )}
        </div>
      )}
    </div>
  );
}
