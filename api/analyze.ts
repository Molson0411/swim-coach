import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  GoogleGenAI,
  createPartFromUri,
  createUserContent,
  type File as GeminiFile,
} from "@google/genai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { getAdminStorageBucket } from "../lib/firebase-admin.js";

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

type StagedVideoFile = {
  tempDir: string;
  path: string;
  displayName: string;
  mimeType: string;
};

const GEMINI_FILE_ACTIVE_TIMEOUT_MS = 120_000;
const GEMINI_FILE_POLL_INTERVAL_MS = 2_000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const HIGH_ACCURACY_GEMINI_MODEL = "gemini-2.5-pro";

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

  const ai = new GoogleGenAI({ apiKey });
  const model = getGeminiModel();
  let uploadedVideo: GeminiFile | null = null;

  try {
    if (mode === "A") {
      uploadedVideo = await uploadVideoToGeminiFile(ai, inputs);
    }

    const contents = uploadedVideo?.uri
      ? createUserContent([
        createPartFromUri(uploadedVideo.uri, uploadedVideo.mimeType || inputs.videoMimeType || "video/mp4"),
        { text: buildPrompt(mode, inputs, uploadedVideo) },
      ])
      : createUserContent([{ text: buildPrompt(mode, inputs, uploadedVideo) }]);

    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini API returned an empty response.");
    }

    return JSON.parse(stripCodeFence(text)) as AnalysisReport;
  } finally {
    if (uploadedVideo?.name) {
      await ai.files.delete({ name: uploadedVideo.name }).catch((error) => {
        console.error("Failed to delete Gemini temporary file:", error);
      });
    }
  }
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
  const mimeType = inputs.videoMimeType || "video/mp4";
  const tempDir = await mkdtemp(join(tmpdir(), "swim-coach-video-"));
  const extension = getVideoExtension(inputs.videoStoragePath || inputs.videoFileName, mimeType);
  const displayName = getDisplayName(inputs.videoStoragePath || inputs.videoFileName);
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

  return `${schema}

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
