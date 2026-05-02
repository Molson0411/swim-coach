import type { VercelRequest, VercelResponse } from "@vercel/node";

type AnalysisMode = "A" | "B";

type AnalysisReport = {
  mode: AnalysisMode;
  impression?: string;
  stroke?: string;
  findings?: {
    metaphor: string;
    analysis: string;
  }[];
  suggestions?: {
    mnemonic: string;
    drill: {
      name: string;
      purpose: string;
    };
  }[];
  metrics?: {
    swolf: number;
    dps: number;
    css?: string;
    finaPoints?: number;
    analysis: string;
  };
  trainingPlan?: {
    warmup: string;
    drills: string;
    mainSet: string;
    coolDown: string;
  };
  growthAdvice: string;
  missingData?: string[];
};

type AnalyzeInputs = {
  videoBase64?: string;
  videoFileUri?: string;
  videoFileName?: string;
  videoMimeType?: string;
  videoStoragePath?: string;
  videoStorageBucket?: string;
  textInput?: string;
  event?: string;
  raceEntries?: {
    event: string;
    time: string;
    strokeCount?: string;
    poolLength: string;
    splits?: string;
  }[];
};

const SYSTEM_INSTRUCTION = [
  "你是專業游泳教練與賽後數據分析師。",
  "請只回傳符合 schema 的 JSON，不要使用 Markdown 或程式碼區塊。",
  "模式 A 用於影片或文字動作分析，模式 B 用於游泳數據分析。",
  "若缺少可判斷的資訊，請在 missingData 說明缺少什麼，並避免假裝已看過不存在的影片內容。",
  "建議要具體、可執行，並用繁體中文回答。",
].join("\n");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (handleCorsPreflight(req, res)) {
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { mode, inputs } = req.body as {
      mode?: AnalysisMode;
      inputs?: AnalyzeInputs;
    };

    if (mode !== "A" && mode !== "B") {
      res.status(400).json({ error: "Invalid analysis mode." });
      return;
    }

    const report = await analyzeWithGemini(mode, inputs || {});
    res.status(200).json(report);
  } catch (error) {
    console.error("Analyze API error:", error);
    const message = error instanceof Error ? error.message : "Failed to analyze swim data.";
    res.status(500).json({ error: message });
  }
}

async function analyzeWithGemini(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(mode, inputs) }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API request failed (${response.status}): ${detail}`);
  }

  const data = await response.json() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error("Gemini API returned an empty response.");
  }

  return JSON.parse(stripCodeFence(text)) as AnalysisReport;
}

function buildPrompt(mode: AnalysisMode, inputs: AnalyzeInputs) {
  const schema = `請回傳這個 JSON 結構：
{
  "mode": "A 或 B",
  "impression": "整體印象",
  "stroke": "判斷泳姿",
  "findings": [{"metaphor": "容易記住的比喻", "analysis": "問題與原因"}],
  "suggestions": [{"mnemonic": "口訣", "drill": {"name": "訓練名稱", "purpose": "訓練目的"}}],
  "metrics": {"swolf": 0, "dps": 0, "css": "CSS 結果", "finaPoints": 0, "analysis": "數據解讀"},
  "trainingPlan": {"warmup": "熱身", "drills": "技術組", "mainSet": "主課表", "coolDown": "緩和"},
  "growthAdvice": "下一步建議",
  "missingData": []
}`;

  if (mode === "A") {
    return `${schema}

分析模式 A：影片或文字動作分析
事件或距離：${inputs.event || "未提供"}
使用者補充：${inputs.textInput || "未提供"}
影片狀態：${buildVideoState(inputs)}

重要限制：如果只有 Firebase Storage 路徑，而沒有可直接讀取的影片內容，請明確寫入 missingData，不要假裝已完成逐格影片判讀。仍可根據使用者文字與已提供資料給出保守建議。`;
  }

  return `${schema}

分析模式 B：數據分析
${formatRaceEntries(inputs.raceEntries)}`;
}

function formatRaceEntries(entries: AnalyzeInputs["raceEntries"]) {
  if (!entries || entries.length === 0) {
    return "未提供成績資料。";
  }

  return entries.map((entry, index) => (
    `資料 ${index + 1}：項目 ${entry.event}，時間 ${entry.time}，划手數 ${entry.strokeCount || "未提供"}，泳池長度 ${entry.poolLength}，分段 ${entry.splits || "未提供"}`
  )).join("\n");
}

function buildVideoState(inputs: AnalyzeInputs) {
  if (inputs.videoStoragePath) {
    return `已上傳到 Firebase Storage：gs://${inputs.videoStorageBucket || "bucket"}/${inputs.videoStoragePath}`;
  }

  if (inputs.videoFileUri) {
    return `已提供影片 URI：${inputs.videoFileUri}`;
  }

  if (inputs.videoBase64) {
    return "已提供 base64 影片資料。";
  }

  return "未提供影片。";
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  const fallbackOrigin = "https://molson0411.github.io";

  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", fallbackOrigin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function handleCorsPreflight(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }

  return false;
}

function isAllowedOrigin(origin: string) {
  if (origin === "https://molson0411.github.io") {
    return true;
  }

  const extraOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return extraOrigins.includes(origin)
    || /^http:\/\/localhost:\d+$/.test(origin)
    || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
    || /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
}
