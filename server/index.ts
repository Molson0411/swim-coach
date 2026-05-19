import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import paymentCheckoutHandler from "../api/payment/checkout.js";
import paymentWebhookHandler from "../api/payment/webhook.js";
import { analyzeWithGemini, startGeminiFileUpload } from "./gemini";
import { getAdminDb, verifyFirebaseToken } from "../lib/firebase-admin.js";
import type { AnalysisMode } from "../src/types";

const app = express();
const port = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");
const ANALYZE_API_TIMEOUT_MS = 180_000;
const ALLOWED_REPORT_STATUSES = new Set(["active", "deleted", "archived"]);

app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Authorization,Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.all("/api/payment/checkout", (req, res, next) => {
  console.log("成功接收到結帳請求:", req.body);
  Promise.resolve(paymentCheckoutHandler(req as never, res as never)).catch(next);
});

app.all("/api/payment/webhook", (req, res, next) => {
  Promise.resolve(paymentWebhookHandler(req as never, res as never)).catch(next);
});

app.post("/api/payment/order-result", (_req, res) => {
  console.log("[支付導回] 收到綠界瀏覽器轉址訊號，準備將用戶導回前端主站");
  res.redirect(302, process.env.ECPAY_ORDER_RESULT_FRONTEND_URL || "http://localhost:3000");
});

app.post("/api/files/start-upload", async (req, res) => {
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

    if (size <= 0 || size > 1024 * 1024 * 1024) {
      res.status(400).json({ error: "Video must be 1GB or smaller." });
      return;
    }

    const uploadSession = await startGeminiFileUpload({ displayName, mimeType, size });
    res.json(uploadSession);
  } catch (error) {
    console.error("Gemini upload session error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create upload session.",
    });
  }
});

app.post("/api/analyze", async (req, res) => {
  console.log("========== [後端連線確認] 成功進入 Analyze API 內部 ==========");
  try {
    const { mode, inputs } = req.body as {
      mode?: AnalysisMode;
      inputs?: Parameters<typeof analyzeWithGemini>[1];
    };

    if (mode !== "A" && mode !== "B") {
      res.status(400).json({ error: "Invalid analysis mode." });
      return;
    }

    const report = await withTimeout(
      analyzeWithGemini(mode, inputs || {}),
      ANALYZE_API_TIMEOUT_MS,
      "後端處理逾時，請稍後再試。"
    );
    res.json(report);
  } catch (error) {
    console.error("[後端重大錯誤] 執行失敗:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "後端處理失敗",
    });
  }
});

app.patch("/api/reports/:id/status", async (req, res) => {
  try {
    const reportId = req.params.id?.trim();
    const newStatus = typeof req.body?.newStatus === "string" ? req.body.newStatus.trim() : "";

    if (!reportId) {
      res.status(400).json({ error: "reportId is required." });
      return;
    }

    if (!ALLOWED_REPORT_STATUSES.has(newStatus)) {
      res.status(400).json({ error: "newStatus must be active, deleted, or archived." });
      return;
    }

    const user = await verifyFirebaseToken(req as never);
    await assertAdminUser(user.uid, user.email);
    const { FieldValue } = await import("firebase-admin/firestore");

    await (await getAdminDb()).collection("analysis_reports").doc(reportId).update({
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({ ok: true, reportId, status: newStatus });
  } catch (error) {
    console.error("[Reports Status API] Failed to update analysis_reports status:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update report status.",
    });
  }
});

async function assertAdminUser(uid: string, email: string | undefined) {
  if (email === "molson0411@gmail.com") {
    return;
  }

  const snapshot = await (await getAdminDb()).collection("users").doc(uid).get();
  if (snapshot.data()?.role !== "admin") {
    throw new Error("Admin permission required.");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Swim Coach API listening on http://localhost:${port}`);
});

function isAllowedOrigin(origin: string) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  return /^https:\/\/molson0411\.github\.io$/.test(origin)
    || /^http:\/\/localhost:\d+$/.test(origin)
    || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin)
    || /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin);
}
