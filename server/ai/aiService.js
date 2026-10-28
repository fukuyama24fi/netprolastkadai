//AI（Groq / Gemini）を呼び出す処理をまとめたファイル
//Groq : メイン（速い・JSONの形を強制できる）
//Gemini : 予備（Groqが回数超過などで失敗したときだけ使う）

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
//※ process.env はファイル読み込み時ではなく「呼び出し時」に読む
//  （import は dotenv.config() より先に実行されるので、上で読むと .env の値が入っていないことがある）
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 20000; //20秒で諦める（展示中に固まらないように）

//AIに見せるキャンバスの図形数の上限（トークン節約。Groqは1分あたりのトークン数に上限がある）
const MAX_OBJECTS_FOR_PROMPT = 80;
//AIに渡す会話の往復数の上限
const MAX_CHAT_MESSAGES = 8;

//AIに返してほしいJSONの形（Groqの strict モードで強制する）
//strictモードでは「全項目を required にする」「使わない項目は null」というルールがあるので
//add / update / delete で使わない項目は null で返してもらう
const nullableNumber = { type: ["number", "null"] };
const nullableString = { type: ["string", "null"] };

const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        reply: { type: "string" },
        operations: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    op: { type: "string", enum: ["add", "update", "delete"] },
                    id: nullableString,
                    type: {
                        anyOf: [
                            { type: "string", enum: ["rect", "circle", "triangle", "text"] },
                            { type: "null" }
                        ]
                    },
                    x: nullableNumber,
                    y: nullableNumber,
                    width: nullableNumber,
                    height: nullableNumber,
                    rotation: nullableNumber,
                    fill: nullableString,
                    text: nullableString,
                    fontSize: nullableNumber,
                    fontWeight: nullableString,
                    fontStyle: nullableString,
                    textTransform: nullableString
                },
                required: [
                    "op", "id", "type", "x", "y", "width", "height", "rotation",
                    "fill", "text", "fontSize", "fontWeight", "fontStyle", "textTransform"
                ],
                additionalProperties: false
            }
        }
    },
    required: ["reply", "operations"],
    additionalProperties: false
};

//AIへの指示（システムプロンプト）
const SYSTEM_PROMPT = `あなたは共同編集キャンバスアプリ「Pikva」のデザインアシスタントです。
ユーザーと日本語で会話し、頼まれたらキャンバス上の図形を追加・変更・削除する操作を提案します。

# キャンバスの仕様
- 座標は左上が原点(0,0)。xは右方向、yは下方向に増える。単位はpx。
- 標準のキャンバスの大きさは 幅2000 × 高さ1400。
- 図形の x, y は図形の「左上の角」の位置。width, height は図形の大きさ。
- type は rect(四角) / circle(円・楕円) / triangle(上向きの三角) / text(文字) の4種類だけ。
- fill は "#rrggbb" 形式の色。text の場合は文字の色。
- rotation は回転角度（度）。
- text の図形だけ text, fontSize, fontWeight("normal"/"bold"), fontStyle("normal"/"italic"), textTransform("none"/"uppercase") を使う。

# 返答のルール
- 必ず指定されたJSON形式で返す。
- reply にはユーザーへの返事を短く（2〜3文）書く。
- operations には実行してほしい操作を並べる。雑談や質問への回答だけなら operations は空配列 [] にする。
- add: 新しい図形。type, x, y, width, height, fill は必ず入れる。id は null。
- update: 既存の図形を変更。id には「現在のキャンバス」にある図形の id をそのまま入れる。変更する項目だけ値を入れ、変えない項目は null。
- delete: 既存の図形を削除。id だけ入れ、他は null。
- 存在しない id を作らない。一度に作る図形は30個まで。
- 絵やデザインを頼まれたら、複数の図形を組み合わせて、見た目のバランスが良い配置にする。既存の図形と重ならない空いている場所に置く。`;

//キャンバスの図形を、AIに見せる用の小さい形にする（トークン節約）
function compactCanvas(canvasState) {
    return canvasState.slice(-MAX_OBJECTS_FOR_PROMPT).map(obj => {
        const compact = {
            id: obj.id,
            type: obj.type,
            x: Math.round(obj.x),
            y: Math.round(obj.y),
            width: Math.round(obj.width),
            height: Math.round(obj.height),
            fill: obj.fill
        };
        if (obj.rotation) compact.rotation = obj.rotation;
        if (obj.type === "text") {
            compact.text = obj.text;
            compact.fontSize = obj.fontSize ?? obj.font_size;
        }
        return compact;
    });
}

//クライアントから来た会話履歴を安全な形にする
function sanitizeChatHistory(chatHistory) {
    if (!Array.isArray(chatHistory)) return [];
    return chatHistory
        .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-MAX_CHAT_MESSAGES)
        .map(m => ({ role: m.role, content: m.content.slice(0, 500) }));
}

//最後のユーザー発言に「現在のキャンバス」を添える
function buildUserContent(message, canvasState) {
    return `現在のキャンバス（図形のJSON）:
${JSON.stringify(compactCanvas(canvasState))}

ユーザーの依頼:
${message}`;
}

//失敗理由を呼び出し元で判断できるようにするためのエラー
export class AiError extends Error {
    constructor(message, { status, provider } = {}) {
        super(message);
        this.status = status;
        this.provider = provider;
    }
}

async function callGroq({ message, chatHistory, canvasState }) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new AiError("GROQ_API_KEY が設定されていません", { provider: "groq" });

    const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                ...sanitizeChatHistory(chatHistory),
                { role: "user", content: buildUserContent(message, canvasState) }
            ],
            response_format: {
                type: "json_schema",
                json_schema: { name: "canvas_operations", strict: true, schema: RESPONSE_SCHEMA }
            },
            reasoning_effort: "low", //考えすぎないように（速さとトークン節約）
            max_completion_tokens: 4000,
            temperature: 0.7
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new AiError(`Groq エラー ${res.status}: ${body.slice(0, 300)}`, { status: res.status, provider: "groq" });
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new AiError("Groq の返答が空です", { provider: "groq" });
    return JSON.parse(content);
}

async function callGemini({ message, chatHistory, canvasState }) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL; //モデル名は変わりやすいので環境変数で指定する
    if (!apiKey || !model) {
        throw new AiError("GEMINI_API_KEY または GEMINI_MODEL が設定されていません", { provider: "gemini" });
    }

    //Geminiは assistant ではなく model という役割名を使う
    const contents = [
        ...sanitizeChatHistory(chatHistory).map(m => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }]
        })),
        { role: "user", parts: [{ text: buildUserContent(message, canvasState) }] }
    ];

    const res = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: `${SYSTEM_PROMPT}\n\n# JSONの形\n{"reply": "...", "operations": [{"op": "add", "id": null, "type": "rect", "x": 0, "y": 0, "width": 100, "height": 100, "rotation": 0, "fill": "#4f8cff", "text": null, "fontSize": null, "fontWeight": null, "fontStyle": null, "textTransform": null}]}` }]
            },
            contents,
            generationConfig: { responseMimeType: "application/json" }
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new AiError(`Gemini エラー ${res.status}: ${body.slice(0, 300)}`, { status: res.status, provider: "gemini" });
    }
    const json = await res.json();
    const text = json.candidates?.[0]?.content?.parts?.map(p => p.text ?? "").join("");
    if (!text) throw new AiError("Gemini の返答が空です", { provider: "gemini" });
    return JSON.parse(text);
}

//外から呼ぶのはこれだけ。Groq → ダメならGemini の順に試す
//戻り値: { reply: string, operations: array(未検証), provider: "groq" | "gemini" }
export async function askCanvasAi({ message, chatHistory, canvasState }) {
    const args = { message, chatHistory, canvasState };
    try {
        const result = await callGroq(args);
        return { ...normalize(result), provider: "groq" };
    } catch (groqErr) {
        console.error("[AI] Groq 失敗:", groqErr.message);
        try {
            const result = await callGemini(args);
            return { ...normalize(result), provider: "gemini" };
        } catch (geminiErr) {
            console.error("[AI] Gemini 失敗:", geminiErr.message);
            //回数超過(429)はユーザーに「少し待って」と言えるように status を残す
            throw new AiError("AIの呼び出しに失敗しました", {
                status: groqErr.status === 429 || geminiErr.status === 429 ? 429 : groqErr.status
            });
        }
    }
}

//AIの返事の最低限の形を保証する（中身の安全チェックは validateOperations で行う）
function normalize(result) {
    return {
        reply: typeof result?.reply === "string" ? result.reply.slice(0, 1000) : "",
        operations: Array.isArray(result?.operations) ? result.operations : []
    };
}