import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

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
    const { displayName, mimeType, size } = req.body as {
      displayName?: string;
      mimeType?: string;
      size?: number;
    };

    if (!displayName || !mimeType || typeof size !== "number") {
      res.status(400).json({ error: "displayName, mimeType and size are required." });
      return;
    }

    if (!mimeType.startsWith("video/")) {
      res.status(400).json({ error: "Only video uploads are supported." });
      return;
    }

    if (size <= 0 || size > MAX_VIDEO_BYTES) {
      res.status(400).json({ error: "Video must be 1GB or smaller." });
      return;
    }

    const uploadSession = await startGeminiFileUpload({ displayName, mimeType, size });
    res.status(200).json(uploadSession);
  } catch (error) {
    console.error("Gemini upload session error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create upload session.",
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
    || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
    || /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
}

async function startGeminiFileUpload(input: {
  displayName: string;
  mimeType: string;
  size: number;
}) {
  const apiKey = process.env.GEMINI_API_KEY || "";
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
