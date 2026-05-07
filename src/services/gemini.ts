import { doc, getDocFromServer } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { auth, db, storage } from "../firebase";
import { AnalysisMode, AnalysisReport } from "../types";

type AnalyzeInputs = {
  videoFileUri?: string;
  videoFileName?: string;
  videoMimeType?: string;
  videoStoragePath?: string;
  videoStorageBucket?: string;
  videoUrl?: string;
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

type StorageUploadedFile = {
  storagePath: string;
  bucket: string;
  mimeType: string;
  downloadURL: string;
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
  const { user } = await requireUserWithCredits();
  const mimeType = file.type || "video/mp4";
  const storagePath = [
    "uploads",
    user.uid,
    `${Date.now()}-${crypto.randomUUID()}-${sanitizeStorageFileName(file.name)}`,
  ].join("/");
  const uploadRef = ref(storage, storagePath);

  await uploadFileToFirebaseStorage({ file, mimeType, uploadRef });
  const downloadURL = await getDownloadURL(uploadRef);

  return {
    storagePath,
    bucket: uploadRef.bucket,
    mimeType,
    downloadURL,
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

async function uploadFileToFirebaseStorage(input: {
  file: File;
  mimeType: string;
  uploadRef: ReturnType<typeof ref>;
}) {
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(input.uploadRef, input.file, {
      contentType: input.mimeType,
    });

    task.on("state_changed", undefined, reject, () => resolve());
  });
}

function sanitizeStorageFileName(fileName: string) {
  return fileName
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "video";
}
