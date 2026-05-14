import { doc, getDocFromServer } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable, type UploadTaskSnapshot } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import { AnalysisMode, AnalysisReport } from "../types";

type AnalyzeInputs = {
  videoFileUri?: string;
  videoFileName?: string;
  videoMimeType?: string;
  videoStoragePath?: string;
  videoStorageBucket?: string;
  videoUrl?: string;
  startTime?: string;
  endTime?: string;
  targetDescription?: string;
  textInput?: string;
  event?: string;
  athleteProfile?: {
    gender: "M" | "F" | "";
    birthDate: string;
  };
  gender?: "Male" | "Female";
  age?: number;
  historicalFindings?: string[];
  raceEntries?: {
    event: string;
    time: string;
    strokeCounts?: number[];
    poolLength: string;
    splits?: number[];
  }[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export class AnalyzeApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "AnalyzeApiError";
  }
}

type StorageUploadedFile = {
  storagePath: string;
  bucket: string;
  mimeType: string;
  downloadURL: string;
};

type AnalysisReportStatus = "active" | "deleted" | "archived";

export async function analyzeSwim(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  const { token } = await requireUserWithCredits();
  if (inputs.videoStoragePath && !inputs.videoUrl?.trim()) {
    console.warn("[前端阻斷] 缺少檔案或必要條件，提早結束執行", inputs);
    throw new Error("Firebase Storage upload completed, but videoUrl is missing before /api/analyze.");
  }

  if (inputs.videoUrl) {
    console.log("[Swim Coach] Sending videoUrl to /api/analyze:", inputs.videoUrl);
  }

  console.log("[前端追蹤] 5. 準備呼叫 /api/analyze");
  const gender = normalizeGenderForApi(inputs.athleteProfile?.gender);
  const age = calculateAge(inputs.athleteProfile?.birthDate);
  const requestInputs = {
    ...inputs,
    gender,
    age,
  };

  const response = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode,
      inputs: requestInputs,
      gender,
      age,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new AnalyzeApiError(error?.message || error?.error || "Analysis request failed.", error?.error);
  }

  return response.json() as Promise<AnalysisReport>;
}

function normalizeGenderForApi(gender?: "M" | "F" | "") {
  if (gender === "M") return "Male";
  if (gender === "F") return "Female";
  return undefined;
}

function calculateAge(birthDate?: string) {
  if (!birthDate) return undefined;
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return undefined;

  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }

  return age >= 0 ? age : undefined;
}

export async function updateAnalysisReportStatus(
  reportId: string,
  newStatus: AnalysisReportStatus
) {
  const { token } = await requireUserWithCredits();
  const response = await fetch(`${API_BASE_URL}/api/reports/${encodeURIComponent(reportId)}/status`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ newStatus }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "Failed to update report status.");
  }

  return response.json() as Promise<{ ok: boolean; reportId: string; status: AnalysisReportStatus }>;
}

export async function uploadVideoForAnalysis(file: File): Promise<StorageUploadedFile> {
  try {
    console.log("[前端追蹤] 2. 目前選擇的檔案狀態:", file);
    if (!file) {
      console.warn("[前端阻斷] 缺少檔案或必要條件，提早結束執行");
      throw new Error("No video file selected for upload.");
    }

    const { user } = await requireUserWithCredits();
    const mimeType = file.type || "video/mp4";
    const storagePath = [
      "uploads",
      user.uid,
      `${Date.now()}-${crypto.randomUUID()}-${sanitizeStorageFileName(file.name)}`,
    ].join("/");
    const uploadRef = ref(storage, storagePath);

    console.log("[前端追蹤] 3. 開始上傳至 Firebase Storage...");
    const uploadSnapshot = await uploadFileToFirebaseStorage({ file, mimeType, uploadRef });
    const downloadURL = await getDownloadURL(uploadSnapshot.ref);
    if (!downloadURL.trim()) {
      throw new Error("Firebase Storage returned an empty video download URL.");
    }

    console.log("[前端追蹤] 4. 上傳成功，取得網址:", downloadURL);
    console.log("[Swim Coach] Firebase Storage download URL generated:", downloadURL);

    return {
      storagePath,
      bucket: uploadRef.bucket,
      mimeType,
      downloadURL,
    };
  } catch (error) {
    console.error("[前端上傳錯誤]:", error);
    throw error;
  }
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

async function uploadFileToFirebaseStorage(input: {
  file: File;
  mimeType: string;
  uploadRef: ReturnType<typeof ref>;
}) {
  return new Promise<UploadTaskSnapshot>((resolve, reject) => {
    const task = uploadBytesResumable(input.uploadRef, input.file, {
      contentType: input.mimeType,
    });

    task.on("state_changed", undefined, reject, () => resolve(task.snapshot));
  });
}

function sanitizeStorageFileName(fileName: string) {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "video";
}
