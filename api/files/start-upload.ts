import type { VercelRequest, VercelResponse } from "@vercel/node";
import { setCorsHeaders } from "../cors";
import { assertUserHasCredits, verifyFirebaseToken } from "../firebase-admin";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

type StartUploadBody = {
  displayName?: string;
  mimeType?: string;
  size?: number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.status(200).end();
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ message: "Method not allowed." });
      return;
    }

    const uploadSession = await handleStartUpload(req);
    res.status(200).json(uploadSession);
  } catch (error) {
    setCorsHeaders(req, res);
    console.error("API Crash Error:", error);

    const message = error instanceof Error ? error.message : "Failed to create upload session.";
    const status = getErrorStatus(message);

    res.status(status).json({
      message,
      error: message,
      name: error instanceof Error ? error.name : "UnknownError",
      stack: process.env.NODE_ENV === "production"
        ? undefined
        : error instanceof Error ? error.stack : undefined,
    });
  }
}

async function handleStartUpload(req: VercelRequest) {
  const user = await verifyFirebaseToken(req);
  await assertUserHasCredits(user.uid);

  const { displayName, mimeType, size } = req.body as StartUploadBody;

  if (!displayName || !mimeType || typeof size !== "number") {
    throw new BadRequestError("displayName, mimeType and size are required.");
  }

  if (!mimeType.startsWith("video/")) {
    throw new BadRequestError("Only video uploads are supported.");
  }

  if (size <= 0 || size > MAX_VIDEO_BYTES) {
    throw new BadRequestError("Video must be 1GB or smaller.");
  }

  return startGeminiFileUpload({ displayName, mimeType, size });
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

function getErrorStatus(message: string) {
  if (message === "免費額度已用完") {
    return 402;
  }

  if (message.includes("Firebase ID token")) {
    return 401;
  }

  if (
    message.includes("displayName, mimeType and size are required") ||
    message.includes("Only video uploads are supported") ||
    message.includes("Video must be 1GB or smaller")
  ) {
    return 400;
  }

  return 500;
}

class BadRequestError extends Error {
  name = "BadRequestError";
}
