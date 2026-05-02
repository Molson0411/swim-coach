import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, createSign } from "node:crypto";

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

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

const MAX_INLINE_VIDEO_BYTES = 18 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 10 * 60;

const SYSTEM_INSTRUCTION = [
  "You are a professional swimming coach and race data analyst.",
  "Always answer in Traditional Chinese.",
  "Return JSON only. Do not use Markdown or code fences.",
  "For mode A, analyze the supplied swimming video if video bytes are provided.",
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

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const parts = await buildGeminiParts(mode, inputs);

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

async function buildGeminiParts(mode: AnalysisMode, inputs: AnalyzeInputs): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [{ text: buildPrompt(mode, inputs) }];

  if (mode === "A") {
    const videoPart = await getVideoPart(inputs);
    if (videoPart) {
      parts.push(videoPart);
    }
  }

  return parts;
}

async function getVideoPart(inputs: AnalyzeInputs): Promise<GeminiPart | null> {
  const mimeType = inputs.videoMimeType || "video/mp4";

  if (inputs.videoBase64) {
    return {
      inline_data: {
        mime_type: mimeType,
        data: inputs.videoBase64,
      },
    };
  }

  if (!inputs.videoStoragePath) {
    return null;
  }

  const bucket = inputs.videoStorageBucket || process.env.FIREBASE_STORAGE_BUCKET;
  if (!bucket) {
    throw new Error("videoStorageBucket or FIREBASE_STORAGE_BUCKET is required to read uploaded video.");
  }

  const serviceAccount = getServiceAccount();
  const readUrl = createV4SignedUrl({
    method: "GET",
    bucket,
    objectName: inputs.videoStoragePath,
    serviceAccount,
  });

  const response = await fetch(readUrl);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Failed to read uploaded video from Firebase Storage (${response.status}): ${detail}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > MAX_INLINE_VIDEO_BYTES) {
    throw new Error(`Uploaded video is too large for inline Gemini analysis on Vercel (${contentLength} bytes). The current inline limit is ${MAX_INLINE_VIDEO_BYTES} bytes.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_INLINE_VIDEO_BYTES) {
    throw new Error(`Uploaded video is too large for inline Gemini analysis on Vercel (${arrayBuffer.byteLength} bytes). The current inline limit is ${MAX_INLINE_VIDEO_BYTES} bytes.`);
  }

  return {
    inline_data: {
      mime_type: mimeType,
      data: Buffer.from(arrayBuffer).toString("base64"),
    },
  };
}

function buildPrompt(mode: AnalysisMode, inputs: AnalyzeInputs) {
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
Video state: ${buildVideoState(inputs)}

If video bytes are attached, inspect the video directly and provide practical coaching feedback in Traditional Chinese. Focus on body line, kick, catch, pull path, breathing timing, recovery, rhythm, and one or two priority drills.`;
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

function buildVideoState(inputs: AnalyzeInputs) {
  if (inputs.videoStoragePath) {
    return `Uploaded to Firebase Storage: gs://${inputs.videoStorageBucket || "bucket"}/${inputs.videoStoragePath}`;
  }

  if (inputs.videoFileUri) {
    return `Video URI: ${inputs.videoFileUri}`;
  }

  if (inputs.videoBase64) {
    return "Base64 video data was provided.";
  }

  return "No video provided.";
}

function createV4SignedUrl(input: {
  method: "GET";
  bucket: string;
  objectName: string;
  serviceAccount: ServiceAccount;
}) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const credentialScope = `${date}/auto/storage/goog4_request`;
  const host = "storage.googleapis.com";
  const canonicalUri = `/${encodeUriPath(input.bucket)}/${encodeUriPath(input.objectName)}`;
  const signedHeaders = "host";

  const query = new URLSearchParams({
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": `${input.serviceAccount.clientEmail}/${credentialScope}`,
    "X-Goog-Date": timestamp,
    "X-Goog-Expires": String(SIGNED_URL_TTL_SECONDS),
    "X-Goog-SignedHeaders": signedHeaders,
  });
  query.sort();

  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    input.method,
    canonicalUri,
    query.toString(),
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "GOOG4-RSA-SHA256",
    timestamp,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signature = createSign("RSA-SHA256")
    .update(stringToSign)
    .sign(input.serviceAccount.privateKey, "hex");

  return `https://${host}${canonicalUri}?${query.toString()}&X-Goog-Signature=${signature}`;
}

function getServiceAccount(): ServiceAccount {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    const parsed = JSON.parse(serviceAccount) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };

    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT is missing project_id, client_email or private_key.");
    }

    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  const missing = [
    !projectId ? "FIREBASE_PROJECT_ID" : "",
    !clientEmail ? "FIREBASE_CLIENT_EMAIL" : "",
    !privateKey ? "FIREBASE_PRIVATE_KEY" : "",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Firebase service account environment variables are not configured. Missing: ${missing.join(", ")}. You can alternatively set FIREBASE_SERVICE_ACCOUNT.`);
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function encodeUriPath(value: string) {
  return value
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
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
