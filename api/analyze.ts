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

const SYSTEM_INSTRUCTION = `你是一款具備「雙模式切換」功能的 AI 游泳教練系統。

模式 A：動作技術診斷
- 根據游泳項目、使用者描述與影片資訊進行分析。
- findings 至少提供 3 項，每項包含 metaphor 與 analysis。
- suggestions 至少提供 3 項，每項包含 mnemonic 與 drill。

模式 B：成績分析與課表
- 根據項目、秒數、池長、划手數與分段成績分析。
- 計算或估算 SWOLF、DPS、CSS 與訓練區間。
- 提供 warmup、drills、mainSet、coolDown。
- 課表使用 [組數]x[距離] [泳姿] @ [時間] 的形式。

全局要求
- 以繁體中文輸出。
- 不要使用「包干」一詞。
- 資料不足時，把缺少內容放入 missingData。
- 僅回傳 JSON，不要 Markdown，不要程式碼區塊。`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
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
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to analyze swim data.",
    });
  }
}

function setCorsHeaders(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function isAllowedOrigin(origin: string) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  return origin === "https://molson0411.github.io"
    || /^http:\/\/localhost:\d+$/.test(origin)
    || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
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
  const parts: unknown[] = [];

  if (inputs.videoBase64) {
    parts.push({
      inline_data: {
        mime_type: "video/mp4",
        data: inputs.videoBase64,
      },
    });
  }

  parts.push({ text: buildPrompt(mode, inputs) });

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
            parts,
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
  const schema = `請回傳符合此結構的 JSON：
{
  "mode": "A" 或 "B",
  "impression": "整體評價",
  "stroke": "泳姿或項目",
  "findings": [{"metaphor": "白話診斷", "analysis": "專業分析"}],
  "suggestions": [{"mnemonic": "口訣", "drill": {"name": "練習名稱", "purpose": "練習目的"}}],
  "metrics": {"swolf": 0, "dps": 0, "css": "CSS速度", "finaPoints": 0, "analysis": "效率分析"},
  "trainingPlan": {"warmup": "暖身", "drills": "技術練習", "mainSet": "主訓練", "coolDown": "緩和"},
  "growthAdvice": "成長建議",
  "missingData": []
}`;

  if (mode === "A") {
    return `${schema}

進入模式 A：動作技術診斷。
項目：${inputs.event || "未提供"}
使用者描述：${inputs.textInput || "無"}
影片：${inputs.videoBase64 ? "已提供影片資料" : "未提供影片"}`;
  }

  return `${schema}

進入模式 B：成績分析與課表。提供以下比賽數據：
${inputs.raceEntries?.map((entry, index) => (
  `項目 ${index + 1}：${entry.event}，總時間：${entry.time}，划手數：${entry.strokeCount || "未提供"}，池長：${entry.poolLength}，分段成績：${entry.splits || "無"}`
)).join("\n") || "未提供"}`;
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
