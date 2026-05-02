import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleCorsPreflight, setCorsHeaders } from "../cors";
import { assertUserHasCredits, verifyFirebaseToken } from "../firebase-admin";

type GeminiUploadResponse = {
  file?: {
    name?: string;
    uri?: string;
    mimeType?: string;
    mime_type?: string;
  };
};

const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

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
    const user = await verifyFirebaseToken(req);
    await assertUserHasCredits(user.uid);

    const uploadUrl = getSingleHeader(req.headers["x-upload-url"]);
    const offset = getSingleHeader(req.headers["x-upload-offset"]);
    const command = getSingleHeader(req.headers["x-upload-command"]);

    if (!uploadUrl || !offset || !command) {
      res.status(400).json({ error: "Upload URL, offset and command are required." });
      return;
    }

    if (!isAllowedGeminiUploadUrl(uploadUrl)) {
      res.status(400).json({ error: "Invalid upload URL." });
      return;
    }

    if (!/^\d+$/.test(offset)) {
      res.status(400).json({ error: "Invalid upload offset." });
      return;
    }

    if (command !== "upload" && command !== "upload, finalize") {
      res.status(400).json({ error: "Invalid upload command." });
      return;
    }

    const chunk = await readRequestBody(req);
    if (chunk.length <= 0 || chunk.length > MAX_CHUNK_BYTES) {
      res.status(400).json({ error: "Chunk must be between 1 byte and 4MB." });
      return;
    }

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "X-Goog-Upload-Offset": offset,
        "X-Goog-Upload-Command": command,
        "Content-Type": "application/octet-stream",
      },
      body: chunk,
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Gemini chunk upload failed (${response.status}): ${responseText}`);
    }

    if (command === "upload, finalize") {
      const data = JSON.parse(responseText) as GeminiUploadResponse;
      res.status(200).json(data);
      return;
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Gemini chunk upload error:", error);
    const message = error instanceof Error ? error.message : "Failed to upload video chunk.";
    const status = message.includes("Firebase ID token") ? 401 : message === "免費額度已用完" ? 402 : 500;
    res.status(status).json({ error: message });
  }
}

function getSingleHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isAllowedGeminiUploadUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
}

async function readRequestBody(req: VercelRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === "string") {
    return Buffer.from(req.body);
  }

  if (req.body instanceof ArrayBuffer) {
    return Buffer.from(req.body);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
