import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithGemini } from "./gemini";
import type { AnalysisMode } from "../src/types";

const app = express();
const port = Number(process.env.PORT || 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, "../dist");

app.use(express.json({ limit: "25mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/analyze", async (req, res) => {
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
    res.json(report);
  } catch (error) {
    console.error("Analyze API error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to analyze swim data.",
    });
  }
});

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
