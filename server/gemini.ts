import type { AnalysisMode, AnalysisReport } from "../src/types";

type AnalyzeInputs = {
  videoBase64?: string;
  videoFileUri?: string;
  videoFileName?: string;
  videoMimeType?: string;
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

const SYSTEM_INSTRUCTION = `你是一位專業游泳教練與運動數據分析師，請使用繁體中文回答。
模式 A：分析影片、文字描述與游泳項目，輸出動作觀察、主要問題與訓練建議。
模式 B：分析比賽或訓練數據，估算 SWOLF、DPS、CSS 與訓練方向。
規則：
- 只能輸出符合指定 schema 的 JSON，不要輸出 Markdown 或額外說明。
- 若資料不足，請在 missingData 列出缺少項目，並根據已有資料給出保守建議。
- 建議要具體、可執行，訓練菜單可使用「組數 x 距離 項目 @ 配速/休息」格式。`;

function getApiKey() {
  return process.env.GEMINI_API_KEY || "";
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
影片狀態：${inputs.videoFileUri || inputs.videoBase64 ? "已提供影片" : "未提供影片"}`;
  }

  return `${schema}

輸入模式 B：數據與訓練分析
${inputs.raceEntries?.map((entry, index) => (
  `項目 ${index + 1}：${entry.event}，時間：${entry.time}，划手數：${entry.strokeCount || "未提供"}，泳池長度：${entry.poolLength}，分段：${entry.splits || "未提供"}`
)).join("\n") || "未提供數據"}`;
}

export async function startGeminiFileUpload(input: {
  displayName: string;
  mimeType: string;
  size: number;
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const response = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(input.size),
      "X-Goog-Upload-Header-Content-Type": input.mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file: {
        display_name: input.displayName,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini file upload session failed (${response.status}): ${detail}`);
  }

  const uploadUrl = response.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini did not return an upload URL.");
  }

  return { uploadUrl };
}

export async function analyzeWithGemini(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const parts: unknown[] = [];

  if (inputs.videoFileName) {
    await waitForGeminiFileActive(inputs.videoFileName);
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

async function waitForGeminiFileActive(fileName: string) {
  const apiKey = getApiKey();
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

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
