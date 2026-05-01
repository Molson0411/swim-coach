import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "../firebase";
import { AnalysisMode, AnalysisReport } from "../types";

type AnalyzeInputs = {
  videoBase64?: string;
  videoFileUri?: string;
  videoFileName?: string;
  videoMimeType?: string;
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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_UPLOAD_RETRIES = 3;

type GeminiUploadedFile = {
  name: string;
  uri: string;
  mimeType: string;
};

type GeminiUploadResponse = {
  file?: {
    name?: string;
    uri?: string;
    mimeType?: string;
    mime_type?: string;
  };
};

export async function analyzeSwim(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  const { token } = await requireUserWithCredits();

  const response = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ mode, inputs }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Analysis request failed.");
  }

  return response.json() as Promise<AnalysisReport>;
}

export async function uploadVideoForAnalysis(file: File): Promise<GeminiUploadedFile> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error("影片大小不可超過 1GB。");
  }

  const { token } = await requireUserWithCredits();
  const mimeType = file.type || "video/mp4";
  const sessionResponse = await fetch(`${API_BASE_URL}/api/files/start-upload`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      displayName: file.name,
      mimeType,
      size: file.size,
    }),
  });

  if (!sessionResponse.ok) {
    const error = await sessionResponse.json().catch(() => null);
    throw new Error(error?.error || "Failed to start video upload.");
  }

  const { uploadUrl } = await sessionResponse.json() as { uploadUrl?: string };
  if (!uploadUrl) {
    throw new Error("Upload URL was not returned.");
  }

  const uploadResult = await uploadFileInChunks({ file, token, uploadUrl });
  const uploadedFile = uploadResult.file;
  const uri = uploadedFile?.uri;
  const name = uploadedFile?.name;

  if (!uri || !name) {
    throw new Error("Gemini did not return uploaded file metadata.");
  }

  return {
    name,
    uri,
    mimeType: uploadedFile.mimeType || uploadedFile.mime_type || mimeType,
  };
}

async function requireUserWithCredits() {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("請先登入後再使用分析功能。");
  }

  const userSnapshot = await getDocFromServer(doc(db, "users", user.uid));
  const freeCredits = userSnapshot.data()?.freeCredits;
  if (typeof freeCredits !== "number" || freeCredits <= 0) {
    throw new Error("免費額度已用完");
  }

  const token = await user.getIdToken();
  return { user, token };
}

async function uploadFileInChunks(input: {
  file: File;
  token: string;
  uploadUrl: string;
}): Promise<GeminiUploadResponse> {
  let offset = 0;
  let lastResponse: GeminiUploadResponse | null = null;

  while (offset < input.file.size) {
    const end = Math.min(offset + MAX_CHUNK_BYTES, input.file.size);
    const chunk = input.file.slice(offset, end);
    const isFinalChunk = end >= input.file.size;

    lastResponse = await uploadChunkWithRetry({
      chunk,
      offset,
      token: input.token,
      uploadUrl: input.uploadUrl,
      isFinalChunk,
    });

    offset = end;
  }

  if (!lastResponse?.file) {
    throw new Error("Gemini did not return uploaded file metadata.");
  }

  return lastResponse;
}

async function uploadChunkWithRetry(input: {
  chunk: Blob;
  offset: number;
  token: string;
  uploadUrl: string;
  isFinalChunk: boolean;
}): Promise<GeminiUploadResponse> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_UPLOAD_RETRIES; attempt += 1) {
    try {
      return await uploadChunk(input);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_UPLOAD_RETRIES) {
        await delay(500 * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Video chunk upload failed.");
}

async function uploadChunk(input: {
  chunk: Blob;
  offset: number;
  token: string;
  uploadUrl: string;
  isFinalChunk: boolean;
}): Promise<GeminiUploadResponse> {
  const response = await fetch(`${API_BASE_URL}/api/files/upload-chunk`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${input.token}`,
      "Content-Type": "application/octet-stream",
      "X-Upload-Url": input.uploadUrl,
      "X-Upload-Offset": String(input.offset),
      "X-Upload-Command": input.isFinalChunk ? "upload, finalize" : "upload",
    },
    body: input.chunk,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || `Video chunk upload failed (${response.status}).`);
  }

  return response.json() as Promise<GeminiUploadResponse>;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
