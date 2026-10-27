//AIが返した「操作のリスト」を安全な形に整える関数たち
//AIの出力も、クライアントから送られてくるAI_APPLYも「信用できない入力」として扱う
//（Javaで言うと、Controllerに来たリクエストをServiceに渡す前に通すバリデーター）

import crypto from 'crypto';

export const ALLOWED_TYPES = ["rect", "circle", "triangle", "text"];
const ALLOWED_FONT_WEIGHTS = ["normal", "bold"];
const ALLOWED_FONT_STYLES = ["normal", "italic"];
const ALLOWED_TEXT_TRANSFORMS = ["none", "uppercase"];

//一度に適用できる操作の最大数（来場者のいたずら・AIの暴走対策）
export const MAX_OPERATIONS = 30;

//座標や大きさの許容範囲（キャンバスは図形に合わせて広がるので少し余裕を持たせる）
const LIMITS = {
    x: [0, 4000],
    y: [0, 3000],
    width: [10, 2000],
    height: [10, 2000],
    rotation: [-360, 360],
    fontSize: [8, 200],
    zIndex: [0, 100000]
};

//図形の種類ごとの初期値（クライアントの addShape と同じ値）
const DEFAULTS = {
    rect: { width: 100, height: 100, fill: "#4f8cff" },
    circle: { width: 100, height: 100, fill: "#ff6b6b" },
    triangle: { width: 120, height: 100, fill: "#f5b942" },
    text: {
        width: 180, height: 60, fill: "#222222", text: "テキスト",
        fontSize: 24, fontWeight: "normal", fontStyle: "normal", textTransform: "none"
    }
};

//数値なら範囲内に収める。数値でなければ undefined（＝その項目は使わない）
function clampNumber(value, [min, max]) {
    const n = Number(value);
    if (value === null || value === undefined || value === "" || !Number.isFinite(n)) {
        return undefined;
    }
    return Math.round(Math.min(max, Math.max(min, n)));
}

//"#rrggbb" 形式の色だけを許可する
function safeColor(value) {
    if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
        return value.toLowerCase();
    }
    return undefined;
}

function safeText(value) {
    if (typeof value !== "string") return undefined;
    return value.slice(0, 200);
}

function safeEnum(value, allowed) {
    return allowed.includes(value) ? value : undefined;
}

//AIの1つの操作から「図形のプロパティ」だけを取り出して、安全な値にする
//undefined になった項目は入れない
function pickShapeProps(raw) {
    const props = {
        x: clampNumber(raw.x, LIMITS.x),
        y: clampNumber(raw.y, LIMITS.y),
        width: clampNumber(raw.width, LIMITS.width),
        height: clampNumber(raw.height, LIMITS.height),
        rotation: clampNumber(raw.rotation, LIMITS.rotation),
        fill: safeColor(raw.fill),
        text: safeText(raw.text),
        fontSize: clampNumber(raw.fontSize, LIMITS.fontSize),
        fontWeight: safeEnum(raw.fontWeight, ALLOWED_FONT_WEIGHTS),
        fontStyle: safeEnum(raw.fontStyle, ALLOWED_FONT_STYLES),
        textTransform: safeEnum(raw.textTransform, ALLOWED_TEXT_TRANSFORMS)
    };
    for (const key of Object.keys(props)) {
        if (props[key] === undefined) delete props[key];
    }
    return props;
}

//操作リストを検証・整形する
//canvasState: 今のキャンバス（update/deleteの対象が存在するか確認するため）
//戻り値: { operations: 整形済みの操作, skipped: 捨てた操作の数 }
//
//整形後の形
//  { op: "add",    type, x, y, width, height, fill, ... }   ※idはまだ付けない（適用時に発行）
//  { op: "update", id, changes: { x, fill, ... } }
//  { op: "delete", id }
export function validateOperations(rawOperations, canvasState) {
    if (!Array.isArray(rawOperations)) {
        return { operations: [], skipped: 0 };
    }

    const existingIds = new Set(canvasState.map(obj => obj.id));
    const deletedIds = new Set();
    const operations = [];
    let skipped = 0;

    for (const raw of rawOperations.slice(0, MAX_OPERATIONS)) {
        if (!raw || typeof raw !== "object") {
            skipped++;
            continue;
        }

        if (raw.op === "add") {
            const type = safeEnum(raw.type, ALLOWED_TYPES);
            if (!type) {
                skipped++;
                continue;
            }
            const props = pickShapeProps(raw);
            //AIが座標を書き忘れたら真ん中あたりに置く
            operations.push({
                op: "add",
                type,
                x: 300,
                y: 300,
                rotation: 0,
                ...DEFAULTS[type],
                ...props
            });
            continue;
        }

        if (raw.op === "update") {
            if (!existingIds.has(raw.id) || deletedIds.has(raw.id)) {
                skipped++;
                continue;
            }
            //updateでは type の変更は許可しない（図形の種類が変わると表示が崩れるため）
            //AIの生の返事は項目がそのまま並んでいて、整形済み（AI_APPLYで戻ってくる形）は changes の中に入っている
            const source = raw.changes && typeof raw.changes === "object" ? raw.changes : raw;
            const changes = pickShapeProps(source);
            if (Object.keys(changes).length === 0) {
                skipped++;
                continue;
            }
            operations.push({ op: "update", id: raw.id, changes });
            continue;
        }

        if (raw.op === "delete") {
            if (!existingIds.has(raw.id) || deletedIds.has(raw.id)) {
                skipped++;
                continue;
            }
            deletedIds.add(raw.id);
            operations.push({ op: "delete", id: raw.id });
            continue;
        }

        skipped++;
    }

    skipped += Math.max(0, rawOperations.length - MAX_OPERATIONS);
    return { operations, skipped };
}

//「add」操作から、実際にキャンバスに入れる図形オブジェクトを作る
//idはここで初めて発行する（同じ提案を2回反映してもID重複しないように）
export function buildShapeFromAddOperation(operation, zIndex) {
    const { op, ...shape } = operation;
    return {
        id: crypto.randomUUID(),
        ...shape,
        zIndex
    };
}