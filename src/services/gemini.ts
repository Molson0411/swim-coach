import { doc, getDocFromServer } from "firebase/firestore";
import { auth, db } from "../firebase";
import { AnalysisMode, AnalysisReport } from "../types";

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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

type StorageUploadedFile = {
  storagePath: string;
  bucket: string;
  mimeType: string;
};

type StorageUploadSession = {
  uploadUrl: string;
  storagePath: string;
  bucket: string;
  method: "PUT";
  headers?: Record<string, string>;
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

export async function uploadVideoForAnalysis(file: File): Promise<StorageUploadedFile> {
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
      fileName: file.name,
      contentType: mimeType,
      size: file.size,
    }),
  });

  if (!sessionResponse.ok) {
    const error = await sessionResponse.json().catch(() => null);
    throw new Error(error?.error || "Failed to start video upload.");
  }

  const uploadSession = await sessionResponse.json() as StorageUploadSession;
  if (!uploadSession.uploadUrl || !uploadSession.storagePath) {
    throw new Error("Upload URL was not returned.");
  }

  await uploadFileToSignedUrl({ file, mimeType, uploadSession });

  return {
    storagePath: uploadSession.storagePath,
    bucket: uploadSession.bucket,
    mimeType,
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
    throw new Error("免費額度已用完。");
  }

  const token = await user.getIdToken();
  return { user, token };
}

async function uploadFileToSignedUrl(input: {
  file: File;
  mimeType: string;
  uploadSession: StorageUploadSession;
}) {
  const response = await fetch(input.uploadSession.uploadUrl, {
    method: input.uploadSession.method || "PUT",
    headers: {
      "Content-Type": input.mimeType,
      ...(input.uploadSession.headers || {}),
    },
    body: input.file,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`影片上傳到 Firebase Storage 失敗 (${response.status})：${detail}`);
  }
}
