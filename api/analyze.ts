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

const SYSTEM_INSTRUCTION = [
  "You are a professional swimming coach and race data analyst.",
  "Always answer in Traditional Chinese.",
  "Return JSON only. Do not use Markdown or code fences.",
  "For mode A, analyze the supplied swimming video if a Gemini File URI is provided.",
  "For mode B, analyze race or training metrics.",
  "If the available data is insufficient, list the missing fields in missingData and avoid pretending you saw details that are not visible.",
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
  "impression": "overall impression in Traditional Chinese",
  "stroke": "detected stroke or unknown",
  "findings": [{"metaphor": "memorable cue", "analysis": "issue and cause"}],
  "suggestions": [{"mnemonic": "short cue", "drill": {"name": "drill name", "purpose": "purpose"}}],
  "metrics": {"swolf": 0, "dps": 0, "css": "CSS result", "finaPoints": 0, "analysis": "metric interpretation"},
  "trainingPlan": {"warmup": "warmup", "drills": "drills", "mainSet": "main set", "coolDown": "cool down"},
  "growthAdvice": "next step",
  "missingData": []
}`;

  if (mode === "A") {
    return `${schema}

Mode A: swimming video or technique analysis.
Event or distance: ${inputs.event || "not provided"}
User notes: ${inputs.textInput || "not provided"}
Video state: ${buildVideoState(inputs, uploadedVideo)}

If a Gemini File URI is attached, inspect the video directly and provide practical coaching feedback in Traditional Chinese. Focus on body line, kick, catch, pull path, breathing timing, recovery, rhythm, and one or two priority drills.`;
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
  return sanitizeEnvValue(process.env.GEMINI_MODEL) || "gemini-2.0-flash";
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
