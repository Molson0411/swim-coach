import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { AnalysisReport, AnalysisMode } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SYSTEM_INSTRUCTION = `你是一款具備「雙模式切換」功能的 AI 游泳教練系統。

### 🛠 模式 A：動作技術診斷 (影像導向)
當進入此模式時：
1. 輸入檢核：必須填寫「游泳項目」。若有影片更好。
2. 五維分析內部計算：
   - 生物力學：檢測關節角度（如抱水 100°-120°）與身體水平。
   - 精英標竿：對標 Dressel、Ledecky 等名將動作。
   - 專家知識庫：識別「手肘下沉」、「腳踝下墜」等模式。
3. 白話輸出規範：
   - 診斷 (findings)：請提供至少 3 項技術發現。每項包含一個「白話比喻」(metaphor，如「手像摸魚」、「身體像船」) 以及背後的「專業分析」(analysis)。
   - 修正 (suggestions)：請提供至少 3 項修正建議。每項包含一個「一秒懂口訣」(mnemonic) 以及一個「核心技術練習」(drill)。

### 🛠 模式 B：成績分析與課表 (數據導向)
當進入此模式時：
1. 數據收集：要求輸入一或多個比賽項目的數據，包含「項目」、「秒數」、「池長」、「划手數」(選填)、「分段成績」(選填)。
2. 效率分析內部計算：
   - 計算每個項目的 SWOLF 與 DPS (單次划水距離)。
   - 分析「分段成績」的配速穩定度。
   - 計算 CSS (臨界游泳速度) 與訓練區間。
   - 參考 FINA 積分評估目前水準。
3. 科學課表輸出：
   - 綜合所有提供的比賽數據（如：配速不穩、耐力差或水感差）生成客製化課表。
   - 格式：暖身(WU) -> 技術練習(Drills) -> 主訓練(MS) -> 緩和(CD)。
   - **課表撰寫規範**：請使用 \[組數\]x\[距離\] \[泳姿\] @ \[時間\] (目標說明) 的形式。
   - **範例**：6x100m 蛙式 @ 1:45 (目標配速維持在 1:15 左右，訓練CSS速耐力) + 4x50m 蛙式衝刺 @ 1:00。
   - **禁止事項**：嚴禁使用「包干」一詞，請統一使用 @ 符號表示間隔時間。

### ⚠️ 全局指令
- 所有專業指標（ASCA、關節角度）僅作為 AI 內部的判斷基準，輸出時請轉化為【白話、易懂、具鼓勵性】的建議。
- 禁止在模式 A 中生成長篇課表，除非使用者主動要求。
- 若使用者資料不足，請在 missingData 欄位中列出（例如：池長、划手數等）。

請務必以 JSON 格式回傳，結構如下：
{
  "mode": "A" | "B",
  "impression": "整體評價",
  "stroke": "偵測到的泳姿",
  "findings": [
    { "metaphor": "白話診斷比喻", "analysis": "專業技術分析" }
  ],
  "suggestions": [
    { 
      "mnemonic": "一秒懂口訣", 
      "drill": { "name": "訓練名稱", "purpose": "訓練目的" } 
    }
  ],
  "metrics": {
    "swolf": 0,
    "dps": 0,
    "css": "CSS速度",
    "finaPoints": 0,
    "analysis": "效率分析評語"
  },
  "trainingPlan": {
    "warmup": "暖身",
    "drills": "技術練習",
    "mainSet": "主訓練",
    "coolDown": "緩和"
  },
  "growthAdvice": "成長建議與鼓勵",
  "missingData": ["缺少的資料1", "缺少的資料2"]
}`;

export async function analyzeSwim(
  mode: AnalysisMode,
  inputs: {
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
  }
): Promise<AnalysisReport> {
  const model = "gemini-3.1-pro-preview";
  
  const parts: any[] = [];
  if (inputs.videoBase64) {
    parts.push({
      inlineData: {
        mimeType: "video/mp4",
        data: inputs.videoBase64
      }
    });
  }
  
  const prompt = mode === 'A' 
    ? `進入模式 A：動作技術診斷。項目：${inputs.event || "未提供"}。使用者描述：${inputs.textInput || "無"}`
    : `進入模式 B：成績分析與課表。提供以下比賽數據：\n${
        inputs.raceEntries?.map((e, i) => 
          `項目 ${i+1}：${e.event}，總時間：${e.time}，划手數：${e.strokeCount || "未提供"}，池長：${e.poolLength}，分段成績：${e.splits || "無"}`
        ).join('\n')
      }`;

  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model,
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
                analysis: { type: Type.STRING }
              }
            }
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
                    purpose: { type: Type.STRING }
                  }
                }
              }
            }
          },
          metrics: {
            type: Type.OBJECT,
            properties: {
              swolf: { type: Type.NUMBER },
              dps: { type: Type.NUMBER },
              css: { type: Type.STRING },
              finaPoints: { type: Type.NUMBER },
              analysis: { type: Type.STRING }
            }
          },
          trainingPlan: {
            type: Type.OBJECT,
            properties: {
              warmup: { type: Type.STRING },
              drills: { type: Type.STRING },
              mainSet: { type: Type.STRING },
              coolDown: { type: Type.STRING }
            }
          },
          growthAdvice: { type: Type.STRING },
          missingData: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["mode", "growthAdvice"]
      }
    }
  });

  return JSON.parse(response.text || "{}") as AnalysisReport;
}
