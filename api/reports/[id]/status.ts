import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb, verifyFirebaseToken } from "../../../lib/firebase-admin.js";

const ALLOWED_REPORT_STATUSES = new Set(["active", "deleted", "archived"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "PATCH" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const reportId = getReportId(req);
    const newStatus = typeof req.body?.newStatus === "string" ? req.body.newStatus.trim() : "";

    if (!reportId) {
      res.status(400).json({ error: "reportId is required." });
      return;
    }

    if (!ALLOWED_REPORT_STATUSES.has(newStatus)) {
      res.status(400).json({ error: "newStatus must be active, deleted, or archived." });
      return;
    }

    const user = await verifyFirebaseToken(req);
    await assertAdminUser(user.uid, user.email);

    const { FieldValue } = await import("firebase-admin/firestore");
    await (await getAdminDb()).collection("analysis_reports").doc(reportId).update({
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.status(200).json({ ok: true, reportId, status: newStatus });
  } catch (error) {
    console.error("[Reports Status API] Failed to update analysis_reports status:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update report status.",
    });
  }
}

function getReportId(req: VercelRequest) {
  const queryId = req.query.id;
  if (Array.isArray(queryId)) {
    return queryId[0]?.trim() || "";
  }
  return typeof queryId === "string" ? queryId.trim() : "";
}

async function assertAdminUser(uid: string, email: string | undefined) {
  if (email === "molson0411@gmail.com") {
    return;
  }

  const snapshot = await (await getAdminDb()).collection("users").doc(uid).get();
  if (snapshot.data()?.role !== "admin") {
    throw new Error("Admin permission required.");
  }
}

function setCorsHeaders(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "https://molson0411.github.io");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
}
