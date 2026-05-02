import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCorsPreflight, setCorsHeaders } from "./cors";
import {
  debitUserCredit,
  refundUserCredit,
  verifyFirebaseToken,
} from "./firebase-admin";

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

const NO_CREDITS_MESSAGE = "免費額度已用完。";

const SYSTEM_INSTRUCTION = `你是一位專業游泳教練與運動數據分析師，請使用繁體中文回答。
模式 A：分析影片、文字描述與游泳項目，輸出動作觀察、主要問題與訓練建議。
模式 B：分析比賽或訓練數據，估算 SWOLF、DPS、CSS 與訓練方向。
規則：
- 只能輸出符合指定 schema 的 JSON，不要輸出 Markdown 或額外說明。
- 若資料不足，請在 missingData 列出缺少項目，並根據已有資料給出保守建議。
- 建議要具體、可執行，訓練菜單可使用「組數 x 距離 項目 @ 配速/休息」格式。`;

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
    const user = await verifyFirebaseToken(req);
    const { mode, inputs } = req.body as {
      mode?: AnalysisMode;
      inputs?: AnalyzeInputs;
    };

    if (mode !== "A" && mode !== "B") {
      res.status(400).json({ error: "Invalid analysis mode." });
      return;
    }

    await debitUserCredit(user.uid);

    try {
      const report = await analyzeWithGemini(mode, inputs || {});
      res.status(200).json(report);
    } catch (error) {
      await refundUserCredit(user.uid).catch((refundError) => {
        console.error("Failed to refund user credit after Gemini error:", refundError);
      });
      throw error;
    }
  } catch (error) {
    console.error("Analyze API error:", error);
    const message = normalizeErrorMessage(error);
    const status = getErrorStatus(message);
    res.status(status).json({ error: message });
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
  const parts: unknown[] = [];

  if (inputs.videoFileName) {
    await waitForGeminiFileActive(inputs.videoFileName, apiKey);
  }

  if (inputs.videoFileUri) {
    parts.push({
      file_data: {
        mime_type: inputs.videoMimeType || "video/mp4",
        file_uri: inputs.videoFileUri,
      },
    });
  }

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

async function waitForGeminiFileActive(fileName: string, apiKey: string) {
  const name = fileName.replace(/^\/+/, "");
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(apiKey)}`
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini file status failed (${response.status}): ${detail}`);
    }

    const data = await response.json() as { state?: string };
    if (!data.state || data.state === "ACTIVE") {
      return;
    }
    if (data.state === "FAILED") {
      throw new Error("Gemini failed to process the uploaded video.");
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("Gemini is still processing the uploaded video. Please try again in a minute.");
}

function buildPrompt(mode: AnalysisMode, inputs: AnalyzeInputs) {
  const schema = `請嚴格輸出以下 JSON schema：
{
  "mode": "A 或 B",
  "impression": "整體印象",
  "stroke": "判斷的泳姿或動作型態",
  "findings": [{"metaphor": "好記的比喻", "analysis": "技術分析"}],
  "suggestions": [{"mnemonic": "口訣", "drill": {"name": "訓練名稱", "purpose": "訓練目的"}}],
  "metrics": {"swolf": 0, "dps": 0, "css": "CSS 估算", "finaPoints": 0, "analysis": "數據解讀"},
  "trainingPlan": {"warmup": "熱身", "drills": "技術訓練", "mainSet": "主課表", "coolDown": "緩和"},
  "growthAdvice": "下一步成長建議",
  "missingData": []
}`;

  if (mode === "A") {
    return `${schema}

輸入模式 A：影片與動作分析
游泳項目：${inputs.event || "未提供"}
使用者補充描述：${inputs.textInput || "未提供"}
影片狀態：${buildVideoState(inputs)}
請注意：若只提供 Firebase Storage path 而沒有 Gemini file_uri，代表影片已由使用者直接上傳到 Storage，但此 Serverless 分析要求不會轉發影片位元組。請根據可用文字資料保守分析，並在 missingData 註明「需要可供模型讀取的影片內容」。`;
  }

  return `${schema}

輸入模式 B：數據與訓練分析
${inputs.raceEntries?.map((entry, index) => (
  `項目 ${index + 1}：${entry.event}，時間：${entry.time}，划手數：${entry.strokeCount || "未提供"}，泳池長度：${entry.poolLength}，分段：${entry.splits || "未提供"}`
)).join("\n") || "未提供數據"}`;
}

function buildVideoState(inputs: AnalyzeInputs) {
  if (inputs.videoFileUri || inputs.videoBase64) {
    return "已提供可供模型讀取的影片";
  }

  if (inputs.videoStoragePath) {
    return `影片已上傳至 Firebase Storage：gs://${inputs.videoStorageBucket || "bucket"}/${inputs.videoStoragePath}`;
  }

  return "未提供影片";
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return "Failed to analyze swim data.";
  }

  if (error.message.includes("Firebase ID token")) {
    return error.message;
  }

  if (error.message.includes("免費額度") || error.message.includes("憿")) {
    return NO_CREDITS_MESSAGE;
  }

  return error.message;
}

function getErrorStatus(message: string) {
  if (message.includes("Firebase ID token") || message.includes("Missing Firebase ID token")) {
    return 401;
  }

  if (message === NO_CREDITS_MESSAGE) {
    return 402;
  }

  return 500;
}
