import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
  type File as GeminiFile,
} from "@google/genai";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getAdminDb, getAdminStorageBucket } from "../lib/firebase-admin.js";

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
  performanceMetrics?: {
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
  videoUrl?: string;
  startTime?: string;
  endTime?: string;
  targetDescription?: string;
  strokeType?: string;
  textInput?: string;
  event?: string;
  historicalFindings?: string[];
  raceEntries?: {
    event: string;
    time: string;
    strokeCounts?: number[];
    poolLength: string;
    splits?: number[];
  }[];
};

type StagedVideoFile = {
  tempDir: string;
  path: string;
  displayName: string;
  mimeType: string;
};

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 120_000;
const GEMINI_FILE_POLL_INTERVAL_MS = 2_000;
const RAG_HISTORY_LIMIT = 10;
const RAG_INJECTION_LIMIT = 3;
const ANALYZE_API_TIMEOUT_MS = 180_000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const HIGH_ACCURACY_GEMINI_MODEL = "gemini-2.5-pro";
const STROKE_QUERY_LABELS: Record<string, string> = {
  freestyle: "自由式",
  free: "自由式",
  "front crawl": "自由式",
  自由式: "自由式",
  breaststroke: "蛙式",
  breast: "蛙式",
  蛙式: "蛙式",
  backstroke: "仰式",
  back: "仰式",
  仰式: "仰式",
  butterfly: "蝶式",
  fly: "蝶式",
  蝶式: "蝶式",
  medley: "混合式",
  im: "混合式",
  "individual medley": "混合式",
  混合式: "混合式",
  個人混合式: "混合式",
};

const SYSTEM_INSTRUCTION = [
  "You are a professional swimming coach and race data analyst.",
  "Always answer in Traditional Chinese.",
  "Return JSON only. Do not use code fences. JSON string values may contain Markdown formatting.",
  "For mode A, analyze the supplied swimming video if a Gemini File URI is provided.",
  "For mode B, analyze race or training metrics.",
  "If the available data is insufficient, list the missing fields in missingData and avoid pretending you saw details that are not visible.",
  "【強制格式要求】：當你指出影片中的特定動作瑕疵或完美示範時，請「務必」標註精確的時間點。時間格式必須嚴格遵守 [MM:SS] 的括號格式。範例：『在 [00:12] 時，你的右手入水角度過大...』。",
].join("\n");

const OLYMPIC_TECHNIQUE_PROMPT = `你是一位專精於競技游泳與運動生物力學的「奧運級技術分析教練」。
你的任務是精準、客觀地分析學員上傳的游泳影片，並提供極具專業深度的技術診斷報告。

【核心分析維度】請務必從以下視角進行檢視：

身體流線型與水阻 (Body Alignment & Drag)：頭部位置、核心穩定度、髖部下沉狀況。

推進力與抓水技術 (Propulsion & Catch)：入水點、高肘抓水 (High-elbow catch) 的確實度、推水軌跡。

節奏與協調性 (Rhythm & Coordination)：划頻、呼吸時機、手腿發力配合（如打腿節奏）。

常見盲點 (Common Flaws)：如剪刀腳、過度交叉、換氣過度轉體等。

【輸出格式與語氣】

語氣必須具備權威感但充滿鼓勵，使用繁體中文。

善用 Markdown 格式（粗體、條列式）使排版極度清晰，方便手機閱讀。

報告結構必須包含：

核心診斷結論（用一句話總結最大的技術亮點或盲點）

技術亮點（肯定做得好的地方）

動作修正建議（具體指出問題點與生物力學原理）

矯正分解動作推薦（針對上述盲點，推薦 1-2 個極具針對性的陸上或水下分解動作來改善）

專注訓練焦點（下水時腦中該想著什麼口訣）

【絕對約束條件】
你是一個「技術診斷與矯正建議模組」。
你可以且應該推薦「具體的分解動作 (Drills)」，但絕對不可在報告中提供任何形式的「完整訓練菜單」、「趟數規劃」、「出發秒數」或「心率區間排程」（例如：絕對不可寫出 10x50m 這種排程）。
請將你的建議完全聚焦於「如何透過分解動作來修復技術」，把具體的排課工作留給專屬科學訓練系統。`;

const CSS_CALCULATION_PROMPT = `你是一位資深游泳教練與運動數據分析師，正在為個人學員建立「模式 B：個人科學教練」報告。
請根據每一趟的分段秒數 splits 與划手數 strokeCounts，逐趟推估 SWOLF、DPS、配速衰退與技術穩定度。
若資料足夠，請計算或估算：
- SWOLF：每趟分段秒數 + 該趟划手數，並輸出整體代表值。
- DPS：泳池長度 / 該趟划手數，並輸出整體代表值。
- CSS：依輸入項目與分段配速保守估算臨界泳速或每 100 公尺配速；若不足以精準計算，請標示為估算。
- FINA Points：若無完整正式成績基準，請給合理估計或 0，並在 analysis 說明限制。
請像資深教練一樣，把數據轉化為可執行的訓練處方。`;

const MODE_B_SPORTS_SCIENCE_PROMPT = `【角色與流體動力學解析基準 (Fluid Dynamics Baseline)】
你是一名精通「流體動力學」與「游泳生物力學」的頂級 AI 國家隊教練。
本系統的 efficiencyAnalysis 請寫入 JSON 欄位 performanceMetrics.analysis。
在撰寫 efficiencyAnalysis 時，必須基於以下學理進行論述：
1. 總阻力 (D) = 摩擦阻力 + 壓力阻力(外形阻力) + 波浪阻力。
2. 評估選手是否透過核心穩定維持高位水平，極小化正面投影面積 (S) 以降低壓力阻力。
3. 分析推進長度 (DPS) 與划水頻率 (Stroke Rate) 的最佳平衡，並評估主動阻力 (Active Drag) 的控制成效。

【進階缺陷定向優化矩陣 (Advanced Drill Mapping)】
若收到 historicalFindings (模式 A 歷史瑕疵)，請嚴格依照以下流體力學矩陣，在 trainingPlan.drills 安排對應的專項操練，並務必在動作名稱後方加上 "(Ref: Mode A)" 標記：

[自由式 (捷泳)]
- 瑕疵含「不對稱/滾轉不足/蛇行/核心瓦解」 -> 處方：六次打腿單臂划水切換操練 (6-To-1 Drill)。目的：固化左右滾轉對稱性與核心剛性，降低橫向外形阻力。
- 瑕疵含「早期垂直前臂 (EVF) 缺失/抱水無力」 -> 處方：握拳操練 (Fist Drill) 或 指尖拖曳操練 (Fingertip Drag Drill)。目的：高度孤立前臂落實 EVF，強制建立高肘回臂軌跡。

[仰式 (背泳)]
- 瑕疵含「骨盆塌陷/頭部過度抬起/坐姿」 -> 處方：頭部中立定位與水下 15 公尺海豚打腿專項。目的：維持長軸剛性流線型，抑制外形阻力因體態彎曲而呈幾何級數激增。

[蛙式]
- 瑕疵含「收腿阻力過大/時序重疊/剪刀腳」 -> 處方：極限壓縮收腿外翻時間的彈夾推進 (Snap Through) 練習。目的：嚴格落實「划、吸、踢、滑」線性鏈，消弭瞬態壓力阻力。

[蝶式]
- 瑕疵含「換氣遲滯/騰空窗口破壞/肩帶過載」 -> 處方：單臂蝶式操練 (Single Arm Butterfly Drill) 或 Hypoxic (低氧) 限制集。目的：降低肩帶夾擠，精雕抓水時空點，防止頻繁抬頭引發流線型崩解。

【系統強制約束】
生成課表與分析時，嚴格遵循上述流體力學專項操練與術語，禁止發明未經定義的訓練動作。確保輸出的 JSON 格式完全符合系統規範。`;

const MODE_B_TECHNICAL_EVALUATION_PROMPT = `【四大泳姿微觀分解動作檢驗基準 (Full Technical Evaluation Standard)】
在產出 efficiencyAnalysis 與 growthAdvice 時，請務必將泳者的數據與以下 41 項標準動作模型進行比對，並直接引用對應的力學名詞進行論述。
本系統的 efficiencyAnalysis 請寫入 JSON 欄位 performanceMetrics.analysis，growthAdvice 請寫入 JSON 欄位 growthAdvice。

[自由式 11 項檢驗]
1. 水平定位：頭部中立，水平面位於髮際線。
2. 肩線入水：切入點介於頭肩之間，嚴禁越過中線。
3. 軸向延伸：前象限極限延伸，延長船體結構。
4. EVF抱水：屈肘旋前，建立高位大槳面。
5. S形拉水：水下向外、內、外弧形壓迫。
6. 加速推水：順應滾轉向髖部爆發性後推。
7. 解脫出水：轉移能量，掌心輕鬆帶離水面。
8. 高肘回臂：肘部最高點，前臂放鬆向前揮送。
9. 縱軸滾轉：髖肩同向交替滾轉 30-45 度。
10. 側向呼吸：順勢側轉，半邊泳鏡留於水中。
11. 鞭狀打腿：髖部發力，踝關節蹠屈維持彈性。

[仰式 10 項檢驗]
1. 仰臥定位：後腦平枕，水沒耳根，臀部貼水。
2. 小指入水：手臂伸直，肩線延長線上小指切入。
3. 軸向滑行：水下短暫前伸，微屈肘尋找靜水。
4. 屈肘錨定：彎曲 90 度建立高位大槳面鎖定。
5. 上掃推進：大臂與前臂向後上內側爆發推壓。
6. 下掃加速：手腕內屈，朝大腿外側加速推擊。
7. 拇指出水：藉由肩帶上提，大拇指率先垂直破水。
8. 扇形回臂：直臂於空中沿扇形軌跡向前揮送。
9. 動態滾轉：配合風車軌跡向兩側滾轉 30-40 度。
10. 鞭狀打腿：雙腿緊靠，髖部發力密集交替打水。

[蛙式 10 項檢驗]
1. 流線滑行：水平俯臥，雙臂併攏前伸。
2. 對稱外掃：雙手向外側斜下方滑動尋找靜水。
3. 高肘抓水：快速屈肘內旋，建立水下推進面。
4. 強力內掃：向後內上方弧形壓迫，抬升上半身。
5. 胸下匯合：掌心相對迅速收攏，縮小橫截面積。
6. 前伸破水錐：雙手緊貼沿水面快速向前推出。
7. 收腿屈膝：雙膝微張，腳跟貼臀，極小化屈髖。
8. 外翻勾腳：腳掌猛烈外翻，內側對準後方水體。
9. 鞭打夾腿：向後下方圓弧蹬伸並強力內夾。
10. 同步吸氣：內掃抬升時順勢露面吸氣，回臂埋頭。

[蝶式 10 項檢驗]
1. 胸部壓水：核心發動，胸部下壓引導波浪傳導。
2. 拇指入水：雙臂對稱伸直，拇指朝下斜向切入。
3. 外掃前伸：水下短暫前伸，向外斜下尋找靜水。
4. 高肘錨定：突發屈肘，前臂內旋轉向正後方。
5. 鑰匙孔內掃：雙手沿鑰匙孔軌跡向胸腹下擠壓。
6. 爆發推水：沿骨盆兩側向後直線推擊達最高峰。
7. 對稱出水：小指領先，雙臂隨肩帶抬升滑出水面。
8. 低空回臂：直臂放鬆，貼近水面水平向前甩送。
9. 第一下打：雙手入水瞬間完成下打，托起骨盆。
10. 第二下打：推水出水瞬間爆發下打，提供推進力。`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log("========== [後端連線確認] 成功進入 Analyze API 內部 ==========");
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

    const normalizedInputs = inputs || {};
    validateAnalyzeRequest(mode, normalizedInputs);

    const report = await withTimeout(
      analyzeWithGemini(mode, normalizedInputs),
      ANALYZE_API_TIMEOUT_MS,
      "後端處理逾時，請稍後再試。"
    );
    res.status(200).json(report);
  } catch (error) {
    console.error("[後端重大錯誤] 執行失敗:", error);
    const message = error instanceof Error ? error.message : "後端處理失敗";
    res.status(500).json({ error: message });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function analyzeWithGemini(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const model = getGeminiModel();
  const requestedStrokeType = resolveRequestedStrokeType(mode, inputs);
  let systemInstruction = SYSTEM_INSTRUCTION;
  let uploadedVideo: GeminiFile | null = null;

  try {
    try {
      systemInstruction = await buildSystemInstruction(requestedStrokeType, buildTargetTrackingInstruction(inputs));
    } catch (error) {
      console.error("[RAG System] Failed to build dynamic system instruction:", error);
      throw error;
    }

    if (mode === "A") {
      uploadedVideo = await uploadVideoToGeminiFile(ai, inputs);
    }

    const contents = uploadedVideo?.uri
      ? createUserContent([
        createPartFromUri(uploadedVideo.uri, uploadedVideo.mimeType || inputs.videoMimeType || "video/mp4"),
        { text: buildPrompt(mode, inputs, uploadedVideo) },
      ])
      : createUserContent([{ text: buildPrompt(mode, inputs, uploadedVideo) }]);

    const videoUrl = normalizeVideoUrl(inputs.videoUrl);
    console.log("[後端追蹤] 準備送出的分析請求，是否包含影片:", !!videoUrl, "影片網址:", videoUrl);

    const response = await callGeminiWithCatch(ai, {
      model,
      contents,
      systemInstruction,
      videoUrl,
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini API returned an empty response.");
    }

    const report = normalizeAnalysisReport(JSON.parse(stripCodeFence(text)) as AnalysisReport);
    await saveAnalysisReport(report, inputs);
    return report;
  } catch (error) {
    console.error("[Analyze API] Firestore RAG or Gemini execution failed:", error);
    throw error;
  } finally {
    if (uploadedVideo?.name) {
      await ai.files.delete({ name: uploadedVideo.name }).catch((error) => {
        console.error("Failed to delete Gemini temporary file:", error);
      });
    }
  }
}

async function saveAnalysisReport(report: AnalysisReport, inputs: AnalyzeInputs) {
  const { FieldValue } = await import("firebase-admin/firestore");
  const videoUrl = normalizeVideoUrl(inputs.videoUrl);
  if (inputs.videoStoragePath && !videoUrl) {
    throw new HttpError(400, "Missing videoUrl in /api/analyze request body for uploaded video.");
  }

  console.log("[Swim Coach] Writing analysis report with videoUrl:", videoUrl);

  await (await getAdminDb()).collection("analysis_reports").add({
    createdAt: FieldValue.serverTimestamp(),
    strokeType: resolveSavedStrokeType(report, inputs),
    aiReport: report,
    status: "active",
    reviewStatus: "pending",
    adminFeedback: null,
    videoUrl,
  });
}

function normalizeAnalysisReport(report: AnalysisReport): AnalysisReport {
  if (report.mode !== "B") {
    return report;
  }

  const metrics = report.performanceMetrics || report.metrics;
  if (!metrics) {
    return report;
  }

  return {
    ...report,
    performanceMetrics: metrics,
    metrics: report.metrics || metrics,
  };
}

function validateAnalyzeRequest(mode: AnalysisMode, inputs: AnalyzeInputs) {
  if (mode === "A" && inputs.videoStoragePath && !normalizeVideoUrl(inputs.videoUrl)) {
    throw new HttpError(400, "videoUrl is required when videoStoragePath is provided.");
  }
}

async function callGeminiWithCatch(
  ai: GoogleGenAI,
  input: {
    model: string;
    contents: ReturnType<typeof createUserContent>;
    systemInstruction: string;
    videoUrl: string | null;
  }
) {
  try {
    console.log("[後端追蹤] 準備送出的分析請求，是否包含影片:", !!input.videoUrl, "影片網址:", input.videoUrl);
    return await ai.models.generateContent({
      model: input.model,
      contents: input.contents,
      config: {
        systemInstruction: input.systemInstruction,
        responseMimeType: "application/json",
      },
    });
  } catch (error) {
    console.error("[Gemini API] generateContent failed:", error);
    throw error;
  }
}

function normalizeVideoUrl(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveSavedStrokeType(report: AnalysisReport, inputs: AnalyzeInputs) {
  const canonicalStrokeType = inferStrokeType(report.stroke)
    || resolveRequestedStrokeType(report.mode, inputs)
    || normalizeText(report.stroke)
    || "unknown";
  return mapStrokeTypeForQuery(canonicalStrokeType) || canonicalStrokeType;
}

async function buildSystemInstruction(strokeType: string | null, targetTrackingInstruction: string | null = null) {
  const coachFeedback = await fetchHistoricalCoachFeedback(strokeType);
  console.log(`[RAG System] 成功注入 ${Math.min(coachFeedback.length, RAG_INJECTION_LIMIT)} 筆教練歷史紀錄`);

  if (coachFeedback.length === 0) {
    return [
      targetTrackingInstruction,
      SYSTEM_INSTRUCTION,
    ].filter(Boolean).join("\n\n");
  }

  const historicalGuidance = coachFeedback
    .slice(0, RAG_INJECTION_LIMIT)
    .map((feedback, index) => `${index + 1}. ${feedback}`)
    .join("\n");

  return [
    "【絕對遵循：總教練歷史指導原則】",
    "以下是總教練過去針對此泳姿的專屬糾正紀錄。請務必吸收這些經驗，將其作為本次分析的最高標準，嚴禁給出與以下教練歷史糾正相衝突的建議：",
    historicalGuidance,
    "",
    targetTrackingInstruction,
    "",
    SYSTEM_INSTRUCTION,
  ].filter(Boolean).join("\n");
}

function buildTargetTrackingInstruction(inputs: AnalyzeInputs) {
  const startTime = normalizeText(inputs.startTime);
  const endTime = normalizeText(inputs.endTime);
  const targetDescription = normalizeText(inputs.targetDescription);

  if (!startTime && !endTime && !targetDescription) {
    return null;
  }

  return [
    "【強制鎖定分析目標】：這段影片中有多名游泳者。請「嚴格且僅限於」分析符合以下條件的目標：",
    `- 時間區段：從影片的 ${startTime || "未指定"} 到 ${endTime || "未指定"}`,
    `- 目標特徵：${targetDescription || "未指定"}`,
    "請絕對忽略畫面中的其他干擾人物。",
  ].join("\n");
}

async function fetchHistoricalCoachFeedback(strokeType: string | null) {
  const normalizedStrokeType = normalizeText(strokeType);
  const mappedStrokeType = mapStrokeTypeForQuery(normalizedStrokeType);
  console.log(`[RAG 檢索前] 原始輸入：[${normalizedStrokeType || ""}]，映射後查詢：[${mappedStrokeType || ""}]`);

  if (!mappedStrokeType) {
    return [];
  }

  try {
    // The status filter requires a composite index for status + strokeType + createdAt.
    // If Firestore rejects this query, click the index creation link printed in the terminal or Vercel logs.
    // Click the index creation link printed in the terminal or Vercel logs to create it.
    const snapshot = await (await getAdminDb())
      .collection("analysis_reports")
      .where("status", "==", "active")
      .where("strokeType", "==", mappedStrokeType)
      .orderBy("createdAt", "desc")
      .limit(RAG_HISTORY_LIMIT)
      .get();

    return snapshot.docs
      .map((doc) => doc.data().adminFeedback)
      .filter((feedback): feedback is string => typeof feedback === "string" && feedback.trim().length > 0)
      .map((feedback) => feedback.trim());
  } catch (error) {
    console.error(`[RAG System] Failed to load coach feedback for strokeType "${mappedStrokeType}":`, error);
    return [];
  }
}

function resolveRequestedStrokeType(mode: AnalysisMode, inputs: AnalyzeInputs) {
  const explicitStroke = inferStrokeType(inputs.strokeType) || normalizeText(inputs.strokeType);
  if (explicitStroke) {
    return explicitStroke;
  }

  const candidates = mode === "B"
    ? inputs.raceEntries?.map((entry) => entry.event) || []
    : [inputs.event, inputs.strokeType, inputs.textInput, inputs.videoFileName, inputs.videoStoragePath];

  for (const candidate of candidates) {
    const strokeType = inferStrokeType(candidate);
    if (strokeType) {
      return strokeType;
    }
  }

  return null;
}

function inferStrokeType(value: unknown) {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) {
    return null;
  }

  if (/自由式|freestyle|\bfree\b|front crawl/.test(text)) {
    return "freestyle";
  }

  if (/蛙式|breaststroke|breast/.test(text)) {
    return "breaststroke";
  }

  if (/仰式|backstroke|back/.test(text)) {
    return "backstroke";
  }

  if (/蝶式|butterfly|\bfly\b/.test(text)) {
    return "butterfly";
  }

  if (/混合式|individual medley|\bim\b|medley/.test(text)) {
    return "medley";
  }

  return null;
}

function mapStrokeTypeForQuery(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  return STROKE_QUERY_LABELS[trimmed]
    || STROKE_QUERY_LABELS[normalized]
    || inferStrokeType(trimmed)
    || trimmed;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function uploadVideoToGeminiFile(
  ai: GoogleGenAI,
  inputs: AnalyzeInputs
): Promise<GeminiFile | null> {
  const stagedVideo = await stageVideoFile(inputs);
  if (!stagedVideo) {
    return null;
  }

  try {
    const uploadedFile = await ai.files.upload({
      file: stagedVideo.path,
      config: {
        mimeType: stagedVideo.mimeType,
        displayName: stagedVideo.displayName,
      },
    });

    if (!uploadedFile.name || !uploadedFile.uri) {
      throw new Error("Gemini File API did not return a usable file name or URI.");
    }

    return waitForGeminiFileActive(ai, uploadedFile);
  } finally {
    await rm(stagedVideo.tempDir, { recursive: true, force: true }).catch((error) => {
      console.error("Failed to remove local temporary video file:", error);
    });
  }
}

async function stageVideoFile(inputs: AnalyzeInputs): Promise<StagedVideoFile | null> {
  let mimeType = inputs.videoMimeType || "video/mp4";
  const tempDir = await mkdtemp(join(tmpdir(), "swim-coach-video-"));
  const videoUrl = normalizeVideoUrl(inputs.videoUrl);
  const sourceName = inputs.videoStoragePath || inputs.videoFileName || videoUrl || undefined;
  const extension = getVideoExtension(sourceName, mimeType);
  const displayName = getDisplayName(sourceName);
  const tempPath = join(tempDir, `upload${extension}`);

  try {
    if (inputs.videoStoragePath) {
      const bucket = await getAdminStorageBucket();
      await bucket.file(inputs.videoStoragePath).download({ destination: tempPath });
      return {
        tempDir,
        path: tempPath,
        displayName,
        mimeType,
      };
    }

    if (videoUrl) {
      const response = await fetch(videoUrl);
      if (!response.ok || !response.body) {
        throw new Error(`Failed to download Firebase Storage videoUrl (${response.status}): ${await response.text().catch(() => "")}`);
      }

      const responseMimeType = response.headers.get("content-type");
      if (responseMimeType?.startsWith("video/")) {
        mimeType = responseMimeType;
      }

      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(tempPath)
      );

      return {
        tempDir,
        path: tempPath,
        displayName,
        mimeType,
      };
    }

    if (inputs.videoBase64) {
      await writeFile(tempPath, Buffer.from(stripBase64DataUrl(inputs.videoBase64), "base64"));
      return {
        tempDir,
        path: tempPath,
        displayName,
        mimeType,
      };
    }

    await rm(tempDir, { recursive: true, force: true });
    return null;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function waitForGeminiFileActive(ai: GoogleGenAI, file: GeminiFile): Promise<GeminiFile> {
  if (!file.name) {
    throw new Error("Gemini File API did not return a file name.");
  }

  const deadline = Date.now() + GEMINI_FILE_ACTIVE_TIMEOUT_MS;
  let current = file;

  while (Date.now() < deadline) {
    current = await ai.files.get({ name: file.name });

    if (!current.state || current.state === "ACTIVE") {
      return current;
    }

    if (current.state === "FAILED") {
      const detail = current.error?.message ? `: ${current.error.message}` : "";
      throw new Error(`Gemini failed to process the uploaded video${detail}`);
    }

    await sleep(GEMINI_FILE_POLL_INTERVAL_MS);
  }

  throw new Error("Gemini is still processing the uploaded video. Please try again in a minute.");
}

function buildPrompt(mode: AnalysisMode, inputs: AnalyzeInputs, uploadedVideo: GeminiFile | null) {
  const schema = `Return this JSON shape:
{
  "mode": "A or B",
  "impression": "核心診斷結論。Use concise Traditional Chinese and Markdown bold when helpful.",
  "stroke": "detected stroke or unknown",
  "findings": [{"metaphor": "技術亮點或常見盲點的短標題", "analysis": "動作修正建議，包含問題點與生物力學原理"}],
  "suggestions": [{"mnemonic": "專注訓練焦點口訣", "drill": {"name": "矯正分解動作名稱", "purpose": "該分解動作如何修復技術盲點"}}],
  "metrics": {"swolf": 0, "dps": 0, "css": "CSS result", "finaPoints": 0, "analysis": "metric interpretation"},
  "performanceMetrics": {"swolf": 0, "dps": 0, "css": "CSS result", "finaPoints": 0, "analysis": "metric interpretation"},
  "trainingPlan": {"warmup": "warmup prescription", "drills": "technique drills", "mainSet": "main set prescription", "coolDown": "cool down prescription"},
  "growthAdvice": "鼓勵式總結，只聚焦技術修正，不提供完整訓練菜單",
  "missingData": []
}`;

  if (mode === "A") {
    return `${OLYMPIC_TECHNIQUE_PROMPT}

${schema}

Mode A: swimming video technique diagnosis.
Event or distance: ${inputs.event || "not provided"}
User notes: ${inputs.textInput || "not provided"}
Video state: ${buildVideoState(inputs, uploadedVideo)}

If a Gemini File URI is attached, inspect the video directly. Do not include complete workouts, set prescriptions, send-off intervals, lap counts, or heart-rate zone schedules.`;
  }

  return `${CSS_CALCULATION_PROMPT}

${MODE_B_SPORTS_SCIENCE_PROMPT}

${MODE_B_TECHNICAL_EVALUATION_PROMPT}

${schema}

Mode B: race or training data analysis.
Mode B strict output rules:
- Return valid JSON only.
- performanceMetrics is required and must include swolf, dps, css, finaPoints, and analysis.
- trainingPlan is required and must include warmup, drills, mainSet, and coolDown.
- metrics must mirror performanceMetrics for backward compatibility.
- Base SWOLF and DPS on each lap's splits and strokeCounts. If a value must be estimated, explain the limitation in performanceMetrics.analysis and missingData.
- If historicalFindings are provided, trainingPlan.drills must prioritize corrective drills from the Advanced Drill Mapping matrix above. Add the exact suffix "(Ref: Mode A)" after each linked drill name or linked drill sentence.
${formatHistoricalFindings(inputs.historicalFindings)}
${formatRaceEntries(inputs.raceEntries)}`;
}

function formatHistoricalFindings(findings: AnalyzeInputs["historicalFindings"]) {
  if (!findings || findings.length === 0) {
    return "Historical Mode A findings: not provided.";
  }

  return [
    "Historical Mode A findings for cross-mode planning:",
    ...findings.map((finding, index) => `${index + 1}. ${finding}`),
  ].join("\n");
}

function formatRaceEntries(entries: AnalyzeInputs["raceEntries"]) {
  if (!entries || entries.length === 0) {
    return "No race entries provided.";
  }

  return entries.map((entry, index) => (
    `Entry ${index + 1}: event ${entry.event}, total time ${entry.time}, pool length ${entry.poolLength}, splits by lap ${formatLapArray(entry.splits, "seconds")}, strokeCounts by lap ${formatLapArray(entry.strokeCounts, "strokes")}`
  )).join("\n");
}

function formatLapArray(values: number[] | undefined, unit: string) {
  if (!values || values.length === 0) {
    return "not provided";
  }

  return values.map((value, index) => `Lap ${index + 1}: ${value} ${unit}`).join("; ");
}

function buildVideoState(inputs: AnalyzeInputs, uploadedVideo: GeminiFile | null) {
  if (uploadedVideo?.uri) {
    return `Uploaded to Gemini Files API: ${uploadedVideo.uri}`;
  }

  if (inputs.videoStoragePath) {
    return `Firebase Storage object received but no Gemini file was attached: gs://${inputs.videoStorageBucket || "configured bucket"}/${inputs.videoStoragePath}`;
  }

  if (inputs.videoUrl) {
    return `Firebase Storage download URL received but no Gemini file was attached: ${inputs.videoUrl}`;
  }

  if (inputs.videoBase64) {
    return "Base64 video data was provided and staged through Gemini Files API.";
  }

  if (inputs.videoFileUri) {
    return `Video URI: ${inputs.videoFileUri}`;
  }

  return "No video provided.";
}

function getDisplayName(value?: string) {
  return value ? basename(value).slice(0, 512) : "swim-analysis-video";
}

function getVideoExtension(value: string | undefined, mimeType: string) {
  const existingExtension = value ? extname(value) : "";
  if (existingExtension) {
    return existingExtension;
  }

  if (mimeType === "video/quicktime") {
    return ".mov";
  }

  if (mimeType === "video/webm") {
    return ".webm";
  }

  if (mimeType === "video/x-matroska") {
    return ".mkv";
  }

  return ".mp4";
}

function stripBase64DataUrl(value: string) {
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  return markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
}

function stripCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function getGeminiModel() {
  return resolveGeminiModel(process.env.GEMINI_MODEL);
}

function resolveGeminiModel(configuredModel?: string) {
  const model = sanitizeEnvValue(configuredModel);

  if (!model) {
    return DEFAULT_GEMINI_MODEL;
  }

  const normalizedModel = model.toLowerCase();
  if (
    model === HIGH_ACCURACY_GEMINI_MODEL
    || normalizedModel === "pro"
    || normalizedModel === "highest"
    || normalizedModel === "high"
  ) {
    return HIGH_ACCURACY_GEMINI_MODEL;
  }

  if (model === DEFAULT_GEMINI_MODEL) {
    return DEFAULT_GEMINI_MODEL;
  }

  if (/^models\/gemini-2\.5-(flash|pro)$/.test(model)) {
    return model.replace(/^models\//, "");
  }

  console.warn(`Unsupported or deprecated GEMINI_MODEL "${model}". Falling back to ${DEFAULT_GEMINI_MODEL}.`);
  return DEFAULT_GEMINI_MODEL;
}

function sanitizeEnvValue(value: string | undefined) {
  return value
    ?.trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
