import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analyzeWithGemini } from "../server/gemini";
import { AnalysisMode } from "../src/types";

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
    const { mode, inputs } = req.body as {
      mode?: AnalysisMode;
      inputs?: Parameters<typeof analyzeWithGemini>[1];
    };

    if (mode !== "A" && mode !== "B") {
      res.status(400).json({ error: "Invalid analysis mode." });
      return;
    }

    const report = await analyzeWithGemini(mode, inputs || {});
    res.status(200).json(report);
  } catch (error) {
    console.error("Analyze API error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to analyze swim data.",
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
    || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
}
