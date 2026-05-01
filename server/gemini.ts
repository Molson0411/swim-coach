import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { AnalysisMode, AnalysisReport } from "../src/types";

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

### 模式 A：動作技術診斷
當進入此模式時：
1. 必須根據游泳項目、使用者描述與影片資訊進行分析。
2. 以白話說明技術問題，同時保留專業判斷。
3. findings 至少提供 3 項，每項包含 metaphor 與 analysis。
4. suggestions 至少提供 3 項，每項包含 mnemonic 與 drill。

### 模式 B：成績分析與課表
當進入此模式時：
1. 根據項目、秒數、池長、划手數與分段成績分析。
2. 計算或估算 SWOLF、DPS、CSS 與訓練區間。
3. 提供暖身、技術練習、主訓練與緩和。
4. 課表請使用 [組數]x[距離] [泳姿] @ [時間] 的形式。

### 全局要求
- 以繁體中文輸出。
- 不要使用「包干」一詞。
- 資料不足時，把缺少內容放入 missingData。
- 僅回傳符合 schema 的 JSON。`;

function getApiKey() {
  return process.env.GEMINI_API_KEY || "";
}

function buildPrompt(mode: AnalysisMode, inputs: AnalyzeInputs) {
  if (mode === "A") {
    return `進入模式 A：動作技術診斷。
項目：${inputs.event || "未提供"}
使用者描述：${inputs.textInput || "無"}
影片：${inputs.videoBase64 ? "已提供影片資料" : "未提供影片"}`;
  }

  return `進入模式 B：成績分析與課表。提供以下比賽數據：
${inputs.raceEntries?.map((entry, index) => (
  `項目 ${index + 1}：${entry.event}，總時間：${entry.time}，划手數：${entry.strokeCount || "未提供"}，池長：${entry.poolLength}，分段成績：${entry.splits || "無"}`
)).join("\n") || "未提供"}`;
}

export async function analyzeWithGemini(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const parts: any[] = [];

  if (inputs.videoBase64) {
    parts.push({
      inlineData: {
        mimeType: "video/mp4",
        data: inputs.videoBase64,
      },
    });
  }

  parts.push({ text: buildPrompt(mode, inputs) });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: { parts },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mode: { type: Type.STRING, enum: ["A", "B"] },
          impression: { type: Type.STRING },
          stroke: { type: Type.STRING },
          findings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                metaphor: { type: Type.STRING },
                analysis: { type: Type.STRING },
              },
            },
          },
          suggestions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                mnemonic: { type: Type.STRING },
                drill: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    purpose: { type: Type.STRING },
                  },
                },
              },
            },
          },
          metrics: {
            type: Type.OBJECT,
            properties: {
              swolf: { type: Type.NUMBER },
              dps: { type: Type.NUMBER },
              css: { type: Type.STRING },
              finaPoints: { type: Type.NUMBER },
              analysis: { type: Type.STRING },
            },
          },
          trainingPlan: {
            type: Type.OBJECT,
            properties: {
              warmup: { type: Type.STRING },
              drills: { type: Type.STRING },
              mainSet: { type: Type.STRING },
              coolDown: { type: Type.STRING },
            },
          },
          growthAdvice: { type: Type.STRING },
          missingData: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["mode", "growthAdvice"],
      },
    },
  });

  return JSON.parse(response.text || "{}") as AnalysisReport;
}
