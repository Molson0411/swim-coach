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
  strokeType?: string;
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

const CSS_CALCULATION_PROMPT = `你現在具備運動數據分析師的能力。當使用者提供兩個以上的距離與測驗成績（如 400m 與 50m）時，請強制計算 CSS（臨界泳速）。計算公式為：CSS = (距離2 - 距離1) / (時間2 - 時間1) 算出每公尺秒數後，轉換為每 100 公尺的配速。請獨立計算並精準輸出 CSS 數值，切勿將其與需要划水次數的 SWOLF 或 DPS 混為一談，若缺乏划水次數請直言無法計算 SWOLF/DPS，但務必給出 CSS 結果。`;

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
      systemInstruction = await buildSystemInstruction(requestedStrokeType);
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

    const report = JSON.parse(stripCodeFence(text)) as AnalysisReport;
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

async function buildSystemInstruction(strokeType: string | null) {
  const coachFeedback = await fetchHistoricalCoachFeedback(strokeType);
  console.log(`[RAG System] 成功注入 ${Math.min(coachFeedback.length, RAG_INJECTION_LIMIT)} 筆教練歷史紀錄`);

  if (coachFeedback.length === 0) {
    return SYSTEM_INSTRUCTION;
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
    SYSTEM_INSTRUCTION,
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

${schema}

Mode B: race or training data analysis.
${formatRaceEntries(inputs.raceEntries)}`;
}

function formatRaceEntries(entries: AnalyzeInputs["raceEntries"]) {
  if (!entries || entries.length === 0) {
    return "No race entries provided.";
  }

  return entries.map((entry, index) => (
    `Entry ${index + 1}: event ${entry.event}, time ${entry.time}, stroke count ${entry.strokeCount || "not provided"}, pool length ${entry.poolLength}, splits ${entry.splits || "not provided"}`
  )).join("\n");
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
