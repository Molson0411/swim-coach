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
  const response = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
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

  const mimeType = file.type || "video/mp4";
  const sessionResponse = await fetch(`${API_BASE_URL}/api/files/start-upload`, {
    method: "POST",
    headers: {
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

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: file,
  });

  if (!uploadResponse.ok) {
    const detail = await uploadResponse.text().catch(() => "");
    throw new Error(`Video upload failed (${uploadResponse.status}): ${detail}`);
  }

  const uploadResult = await uploadResponse.json() as GeminiUploadResponse;
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
