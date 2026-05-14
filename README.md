# Swim Coach

React + Vite + Firebase + Gemini API 的游泳影片與數據分析工具。

正式網站：

- GitHub Pages: https://molson0411.github.io/swim-coach/
- API Proxy: https://swim-coach-main.vercel.app

## 專案架構

- `src/`：React 前端。
- `src/firebase.ts`：Firebase 初始化、Google 登入、Firestore 操作。
- `firebase-applet-config.ts`：Firebase Web app fallback config，目前指向 `swimcoach-e7ddf`。
- `src/services/gemini.ts`：前端呼叫自己的 API proxy，不直接碰 Gemini API key。
- `api/analyze.ts`：Vercel Serverless Function，負責呼叫 Gemini 分析。
- `api/files/start-upload.ts`：Vercel Serverless Function，建立 Firebase Storage Signed URL，前端用 PUT 直傳影片。
- `server/`：本機或 Node host 可用的 Express API proxy。
- `.github/workflows/deploy.yml`：GitHub Pages 自動部署流程。

## 本機環境

需求：

- Node.js 22+
- npm
- Firebase 專案已啟用 Authentication / Google provider
- Vercel 專案已設定 `GEMINI_API_KEY`
- GitHub repo secret 已設定 `VITE_API_BASE_URL`

安裝：

```bash
npm install
```

本機前端：

```bash
npm run dev
```

本機 API proxy：

```bash
npm run dev:api
```

檢查與建置：

```bash
npm run lint
npm run build
```

## Firebase 設定

Firebase fallback 設定集中在 `firebase-applet-config.ts`，正式 build 會優先讀取 `VITE_FIREBASE_*` 環境變數。

目前使用的專案：

```json
{
  "projectId": "swimcoach-e7ddf",
  "authDomain": "swimcoach-e7ddf.firebaseapp.com",
  "storageBucket": "swimcoach-e7ddf.firebasestorage.app",
  "messagingSenderId": "833013843721",
  "appId": "1:833013843721:web:d7021aac45f8072f4e75d8",
  "measurementId": "G-SYHBXVMDFR",
  "firestoreDatabaseId": "(default)"
}
```

注意事項：

- Google 登入正式站使用 `signInWithRedirect`，比較適合 GitHub Pages 與手機瀏覽器。
- Firebase Console > Authentication > Settings > Authorized domains 需要加入 `molson0411.github.io`。
- 本機測試時需要加入 `localhost`；若使用 `127.0.0.1`，程式會自動切回 `localhost`。
- Firebase Console > Authentication > Sign-in method 需要啟用 Google provider。

## Gemini API Proxy

前端不能直接放 `GEMINI_API_KEY`。目前架構是：

1. 前端呼叫 `VITE_API_BASE_URL` 指向的後端。
2. Vercel API route 從環境變數讀取 `GEMINI_API_KEY`。
3. 後端呼叫 Gemini API。
4. 前端只接收分析結果。

Vercel 環境變數：

```text
GEMINI_API_KEY=你的 Gemini API key
FIREBASE_PROJECT_ID=Firebase project id
FIREBASE_CLIENT_EMAIL=Firebase service account client email
FIREBASE_PRIVATE_KEY=Firebase service account private key，需保留 \n 換行字元
```

GitHub Repository Secret：

```text
VITE_API_BASE_URL=https://swim-coach-main.vercel.app
```

GitHub Actions build 時會把 `VITE_API_BASE_URL` 注入 Vite 前端 bundle。

## 1GB 影片上傳流程

Vercel Serverless Function 有 payload 與執行時間限制，不適合接收或轉發大型影片。專案採用 Signed URL Direct Upload：

目前流程：

1. 使用者在前端選擇影片。
2. 前端檢查檔案型別必須是 `video/*`，大小不可超過 1GB，並確認使用者 `freeCredits > 0`。
3. 前端帶 Firebase ID token 呼叫 `/api/files/start-upload`，只送 `fileName`、`contentType`、`size`，不送影片實體。
4. 後端驗證 Firebase ID token 與額度後，使用 Firebase Admin SDK 對 Firebase Storage 產生 15 分鐘有效的 V4 Signed URL。
5. 前端使用原生 `fetch` 搭配 `PUT`，將影片檔案直接上傳到 Signed URL。
6. 前端取得 `storagePath` 後呼叫 `/api/analyze`，把 Storage path、mime type、文字描述與項目送給後端。
7. 後端驗證 Firebase ID token，使用 Firestore transaction 先扣 `freeCredits - 1`，再呼叫 Gemini；若 Gemini 失敗則補回 1 點。

這樣可以避免：

- 前端把大影片轉成 base64 造成記憶體暴增。
- Vercel API route 收到或轉發超大 request body。
- Gemini API key 暴露在前端。

重要限制：

- Firebase Storage Signed URL 解決的是「大檔上傳」問題。
- Gemini Developer API 的影片模型輸入仍需要 Gemini Files API 的 `file_uri`，不能直接把私人 Firebase Storage path 當成影片內容。
- 若要讓 Gemini 實際讀取 Firebase Storage 影片，建議下一階段新增 Cloud Run / Cloud Functions 背景工作者，從 Storage 事件觸發後把影片匯入 Gemini Files API，或改用 Vertex AI + GCS URI。

## GitHub Pages 部署

部署 workflow：`.github/workflows/deploy.yml`

觸發方式：

- push 到 `main`
- 手動執行 `workflow_dispatch`

部署流程：

1. Checkout repo。
2. 安裝 Node.js 22。
3. 執行 `npm ci`。
4. 執行 `npm run lint`。
5. 執行 `npm run build`，並注入 `VITE_API_BASE_URL`。
6. 上傳 `dist/`。
7. 部署到 GitHub Pages。

正式網址：

```text
https://molson0411.github.io/swim-coach/
```

## Vercel 部署

Vercel 負責 API proxy：

- `/api/analyze`
- `/api/files/start-upload`

必要設定：

1. Vercel project 連到此 GitHub repo，或手動用 Vercel CLI 部署。
2. 在 Vercel Project Settings > Environment Variables 加入 `GEMINI_API_KEY`。
3. 設定 Firebase Admin SDK 用的 service account。建議使用單一 JSON 環境變數：

```text
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
FIREBASE_STORAGE_BUCKET=swimcoach-e7ddf.firebasestorage.app
```

也可以改用三個拆開的環境變數：

```text
FIREBASE_PROJECT_ID=swimcoach-e7ddf
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
FIREBASE_STORAGE_BUCKET=swimcoach-e7ddf.firebasestorage.app
```

4. Production deployment 完成後，API base URL 設為：

```text
https://swim-coach-main.vercel.app
```

快速測試 API：

```bash
curl -X POST https://swim-coach-main.vercel.app/api/analyze \
  -H "Authorization: Bearer <Firebase_ID_Token>" \
  -H "Content-Type: application/json" \
  -d "{\"mode\":\"B\",\"inputs\":{\"raceEntries\":[{\"event\":\"50 free\",\"time\":\"30\",\"poolLength\":\"50\"}]}}"
```

## Firebase Storage CORS

前端使用 Signed URL 直接 PUT 到 Firebase Storage 時，Storage bucket 必須允許網站來源做 CORS request。本專案已提供 `cors.json`：

```json
[
  {
    "origin": [
      "https://molson0411.github.io",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    ],
    "method": ["PUT", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "x-goog-resumable"
    ],
    "maxAgeSeconds": 3600
  }
]
```

設定步驟：

1. 安裝或開啟 Google Cloud CLI。
2. 登入：

```bash
gcloud auth login
```

3. 切換專案：

```bash
gcloud config set project swimcoach-e7ddf
```

4. 套用 CORS 到 Firebase Storage bucket：

```bash
gcloud storage buckets update gs://swimcoach-e7ddf.firebasestorage.app --cors-file=cors.json
```

若你的 bucket 實際名稱是舊格式，請改用：

```bash
gcloud storage buckets update gs://swimcoach-e7ddf.appspot.com --cors-file=cors.json
```

5. 檢查設定：

```bash
gcloud storage buckets describe gs://swimcoach-e7ddf.firebasestorage.app --format="default(cors_config)"
```

舊版 `gsutil` 也可以使用：

```bash
gsutil cors set cors.json gs://swimcoach-e7ddf.firebasestorage.app
gsutil cors get gs://swimcoach-e7ddf.firebasestorage.app
```

## 常用操作紀錄

## Codex 工作紀錄規則

- 之後每次完成重要修改、部署、排錯或決策，都要同步記錄在本 README。
- 同一份紀錄也要同步到 Obsidian：`Projects/Swim Coach.md`。
- 紀錄內容應包含日期、修改重點、驗證結果，以及仍需追蹤的事項。

### 2026-05-01：Chunked Upload 與 Firestore Quota

- 新增 `/api/files/upload-chunk`，前端改用 4MB chunk 透過 Vercel 轉發到 Gemini resumable upload URL，每個 chunk 最多重試 3 次。
- `/api/analyze`、`/api/files/start-upload`、`/api/files/upload-chunk` 都必須帶 `Authorization: Bearer <Firebase_ID_Token>`。
- 新增 Firebase Admin 初始化，`FIREBASE_PRIVATE_KEY` 會以 `.replace(/\\n/g, "\n")` 修復 Vercel 環境變數換行。
- 使用者登入時若沒有 `users/{uid}` 文件，會建立 `freeCredits: 5`；前端上傳或分析前會先檢查額度。
- `/api/analyze` 會用 Firestore transaction 先扣 1 點，Gemini 失敗時補回 1 點。
- 已執行 `npm run lint` 與 `npm run build`；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-01：GitHub Pages Build 注入 Firebase Secrets

- `.github/workflows/deploy.yml` 的 `Build site` 步驟已加入 `VITE_FIREBASE_*` env 對應 GitHub Actions secrets。
- 保留既有 `VITE_API_BASE_URL`，讓 GitHub Pages build 同時取得 API proxy 與 Firebase 前端設定。

### 2026-05-01：修復 Firebase Config JSON 與環境變數讀取

- `firebase-applet-config.ts` 只輸出 fallback config，不在此檔初始化 Firebase。
- `src/firebase.ts` 會優先讀取 `import.meta.env.VITE_FIREBASE_*`，讓 GitHub Actions build 可注入 Firebase 設定。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-01：防止 Firebase API key 誤用 Gemini key

- 修復正式站出現 `identitytoolkit.googleapis.com ... key=GEMINI_API_KEY` 的登入錯誤。
- `src/firebase.ts` 會拒絕空值、`GEMINI_API_KEY` 或不像 Firebase Web API key 的 `VITE_FIREBASE_API_KEY`，並 fallback 到 `firebase-applet-config.ts`。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-01：修復 Identity Toolkit API restrictions 登入錯誤

- 修復 `auth/requests-to-this-api-identitytoolkit-method-google.cloud.identitytoolkit.v1.projectconfigservice.getprojectconfig-are-blocked`。
- 因 Gemini key 也可能是 `AIza` 開頭，`src/firebase.ts` 現在只有在 `VITE_FIREBASE_PROJECT_ID`、`VITE_FIREBASE_AUTH_DOMAIN`、`VITE_FIREBASE_APP_ID`、`VITE_FIREBASE_MESSAGING_SENDER_ID` 全部符合目前 Firebase 專案時，才採用 `VITE_FIREBASE_API_KEY`。
- 若 env config 不完整或疑似錯誤，會直接使用 `firebase-applet-config.ts` 的 Firebase Web fallback key。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-02：修復 Google 登入後 UI 狀態不更新

- `App.tsx` 會先建立 `onAuthStateChanged` 監聽器，偵測到 Firebase user 時立即 `setUser` 並標記 auth ready。
- `getRedirectResult` 回來時也會直接更新 React user state，避免 redirect 後仍顯示 LOGIN。
- 登入流程改為優先 `signInWithPopup`，只有 popup 被瀏覽器擋住或環境不支援時才 fallback 到 redirect。
- `src/firebase.ts` 登入前會設定 `browserLocalPersistence`，讓重新整理或 redirect 後仍保留 Auth 狀態。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-02：修復 Vercel API CORS 預檢

- 新增 `api/cors.ts` 共用 CORS helper。
- `/api/files/start-upload`、`/api/files/upload-chunk`、`/api/analyze` 都會回傳 `Access-Control-Allow-Origin`，允許 `https://molson0411.github.io`。
- CORS 預檢 `OPTIONS` 會在驗證 Firebase token 前回 `204`。
- 允許方法：`GET,POST,PUT,DELETE,OPTIONS`。
- 允許 headers：`Authorization,Content-Type,X-Requested-With,X-Upload-Url,X-Upload-Offset,X-Upload-Command`。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-02：補強 Vercel 平台層 CORS Headers

- `vercel.json` 已新增 `/api/(.*)` 全域 headers，讓 Vercel 在平台層為所有 API 回傳 CORS headers。
- API 內 `OPTIONS` 預檢回應由 `204` 改為 `200`，並在驗證 Firebase token 前直接結束。
- 允許來源：`https://molson0411.github.io`。
- 允許方法：`GET, OPTIONS, PATCH, DELETE, POST, PUT`。
- 允許 headers：`Authorization, Content-Type, X-Requested-With, X-Upload-Url, X-Upload-Offset, X-Upload-Command`。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-02：強化 start-upload OPTIONS 預檢回應

- `/api/files/start-upload` 現在於 handler 最頂端明確攔截 `OPTIONS`，直接回傳 HTTP `200` 與 CORS headers。
- `vercel.json` 的 API headers source 改為 `/api/:path*`，提高 Vercel 平台層套用 headers 的相容性。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-02：強化 start-upload 500 錯誤診斷

- `/api/files/start-upload` 主要邏輯已包在最外層 `try...catch`。
- catch 會輸出 `console.error("API Crash Error:", error)`，並回傳 JSON：`message`、`error`、`name`，方便從瀏覽器與 Vercel logs 看見真正原因。
- `lib/firebase-admin.ts` 會明確列出缺少的 Firebase Admin env：`FIREBASE_PROJECT_ID`、`FIREBASE_CLIENT_EMAIL`、`FIREBASE_PRIVATE_KEY`，也支援單一 `FIREBASE_SERVICE_ACCOUNT` JSON。
- `FIREBASE_PRIVATE_KEY` 與 `FIREBASE_SERVICE_ACCOUNT.private_key` 都會處理 `.replace(/\\n/g, "\n")`。
- 已執行 `npm run lint` 與 `npm run build` 通過；build 需在沙盒外執行以避開 Windows/OneDrive `spawn EPERM`。

### 2026-05-02：改為 Firebase Storage Signed URL 直傳

- 移除 `/api/files/upload-chunk`，避免 Vercel Serverless Function 接收或轉發影片 chunk。
- `/api/files/start-upload` 現在只接收 `fileName`、`contentType`、`size`，並用 Firebase Admin SDK 產生 Firebase Storage V4 signed PUT URL。
- 前端 `uploadVideoForAnalysis` 會直接 `PUT` 影片到 signed URL，完成後回傳 `storagePath` 與 bucket。
- 新增 `cors.json`，用於設定 Firebase Storage bucket CORS，允許 GitHub Pages 與 localhost 直接 PUT。
- `api/cors.ts` 移除舊 chunk proxy 專用 headers：`X-Upload-Url`、`X-Upload-Offset`、`X-Upload-Command`。

更新 Firebase config 後：

```bash
npm run lint
npm run build
git add firebase-applet-config.ts
git commit -m "Update Firebase web app config"
git push origin main
```

更新前端或 API 後：

```bash
npm run lint
npm run build
git add .
git commit -m "描述這次修改"
git push origin main
```

查看 GitHub Actions：

```bash
gh run list --repo Molson0411/swim-coach --limit 5
gh run watch <run-id> --repo Molson0411/swim-coach --exit-status
```

## 排錯

Google 登入顯示 unauthorized domain：

- 確認 Firebase Console 的 Authorized domains 有加入目前網域。
- 正式站應加入 `molson0411.github.io`。
- 本機應加入 `localhost`。
- 確認 `firebase-applet-config.ts` 的 `projectId` 是 `swimcoach-e7ddf`。

Google 登入顯示 API key 或 project mismatch：

- 確認 `apiKey`、`appId`、`messagingSenderId` 都來自同一個 Firebase Web app。
- 修改後要重新 push，等 GitHub Pages 部署完成。
- 瀏覽器可強制重新整理，避免讀到舊 bundle。

影片分析失敗：

- 確認 Vercel 有設定 `GEMINI_API_KEY`。
- 確認 GitHub secret `VITE_API_BASE_URL` 指向 Vercel API。
- 確認影片小於 1GB 且 mime type 是 `video/*`。
- 可先測 `/api/analyze`，確認 API proxy 正常。

本機 `npm run build` 出現 Windows `Access is denied`：

- 此工作區曾遇到 OneDrive/Windows 權限導致 npm shim 或 esbuild 子程序被擋。
- 可直接使用專案內 Node 執行檢查：

```powershell
& '.tools\node-v22.15.0-win-x64\node.exe' node_modules\typescript\bin\tsc --noEmit
& '.tools\node-v22.15.0-win-x64\node.exe' node_modules\vite\bin\vite.js build
```

## .gitignore 原則

不要提交：

- `node_modules/`
- `dist/`
- `.env`、`.env.*`
- log、cache、暫存檔
- 本機工具目錄 `.tools/`
- Firebase emulator/debug 產物

可以提交：

- `.env.example`
- `firebase-applet-config.ts`，Firebase Web fallback config 會被前端使用，不是 Gemini API key。

## 2026-05-02 Firebase Admin Private Key Update

- Confirmed Firebase Admin initialization in `lib/firebase-admin.ts`.
- Updated `FIREBASE_PRIVATE_KEY` handling to use `process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')` so Vercel escaped newlines are converted back to real newlines.
- Confirmed `FIREBASE_SERVICE_ACCOUNT.private_key` also keeps newline replacement handling.
- Verification: `npm.cmd run lint` passed.

## 2026-05-02 Firebase Storage CORS Auto Setup

Added `scripts/set-firebase-cors.ts` and the npm command:

```bash
npm run setup-cors
```

The script reads Firebase Admin credentials from either:

```text
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
```

or:

```text
FIREBASE_PROJECT_ID=swimcoach-e7ddf
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
FIREBASE_STORAGE_BUCKET=swimcoach-e7ddf.firebasestorage.app
```

It writes this CORS rule to the Firebase Storage bucket:

```json
[
  {
    "origin": ["*"],
    "method": ["GET", "PUT", "POST", "DELETE", "OPTIONS"],
    "responseHeader": [
      "Content-Type",
      "Authorization",
      "Content-Length",
      "User-Agent",
      "x-goog-resumable"
    ],
    "maxAgeSeconds": 3600
  }
]
```

Local execution:

```powershell
npm run setup-cors
```

If local `.env` does not contain the Firebase Admin credentials, copy the same values from Vercel Project Settings > Environment Variables into a local `.env` file first. Do not commit `.env`.

## 2026-05-03 Gemini Files API Upload Architecture

影片上傳與 AI 分析流程已從 Vercel inline payload 改為 Gemini Files API，避開 Vercel request body 約 18MB 的限制。

### Current Data Flow

1. 前端仍透過 `/api/files/start-upload` 取得 Firebase Storage V4 Signed URL。
2. 前端用 `PUT` 將大型 `video/*` 檔案直接上傳到 Firebase Storage，不經過 Vercel request body。
3. 前端把 `storagePath`、`bucket`、`mimeType` 傳給 `/api/analyze`。
4. `/api/analyze` 使用 Firebase Admin 從 Firebase Storage 下載影片到 Vercel `/tmp`。
5. 後端使用官方 `@google/genai` 的 `ai.files.upload()` 將影片上傳到 Gemini Files API。
6. 後端等待 Gemini File 狀態變成 `ACTIVE`，取得 `file.uri`。
7. 後端用 `createPartFromUri(file.uri, mimeType)` 呼叫 Gemini 模型，要求回傳 JSON 結構化游泳分析。
8. 分析完成或失敗後，`finally` 會呼叫 `ai.files.delete({ name })` 刪除 Gemini 暫存影片；本機 `/tmp` 檔也會清掉。

### Official Packages

本專案目前已安裝需要的官方套件：

```bash
npm install @google/genai firebase-admin
```

- `@google/genai`: Google 官方 Gemini SDK；Files API 使用 `GoogleGenAI`, `ai.files.upload`, `ai.files.get`, `ai.files.delete`, `createPartFromUri`。
- `firebase-admin`: 後端讀取 Firebase Storage 物件。
- 不需要安裝 `@google/generative-ai/server`；目前官方文件使用的是 `@google/genai`。

### Runtime Environment

Vercel 需設定：

```text
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
FIREBASE_STORAGE_BUCKET=swimcoach-e7ddf.firebasestorage.app
```

`GEMINI_MODEL` 可用環境變數覆蓋；目前 `/api/analyze.ts` 預設為穩定且支援影片輸入的 `gemini-2.5-flash`，並會清除環境變數前後空白與外層引號。

### Replacement File

完整可替換邏輯已落在：

```text
api/analyze.ts
```

驗證結果：

```bash
npm.cmd run lint
```

已通過 TypeScript 檢查。

官方參考：

- https://ai.google.dev/gemini-api/docs/files
- https://ai.google.dev/api/files

## 2026-05-04 Gemini 2.0 Model 404 Fix

- Google paid project migration exposed a Gemini API 404: `models/gemini-2.0-flash` is no longer available to new users.
- `api/analyze.ts` now defaults to the stable video-capable `gemini-2.5-flash`.
- `GEMINI_MODEL=gemini-2.5-pro`, `pro`, `highest`, or `high` can be used when higher-accuracy analysis is required.
- Deprecated or unsupported `GEMINI_MODEL` values now log a warning and fall back to `gemini-2.5-flash`, so a stale Vercel environment variable will not keep calling Gemini 2.0.
- `.env.example` documents the optional `GEMINI_MODEL=gemini-2.5-flash` setting.
- Verification: `npm.cmd run lint` was blocked by the local Node v24 / OneDrive `ERR_INVALID_PACKAGE_CONFIG` issue; direct typecheck with the bundled Node 22 command passed: `& '.tools\node-v22.15.0-win-x64\node.exe' node_modules\typescript\bin\tsc --noEmit`.

## 2026-05-05 UI/UX and Olympic Coach Prompt Update

- Updated the frontend visual system to a minimalist professional sports-tech style.
- Global colors now use Primary Dark `#303036`, Accent Blue `#30BCED`, and a very light page background.
- Global typography now uses Google Fonts `Noto Sans TC`; heading font utilities are mapped back to Noto Sans TC for a consistent Traditional Chinese interface.
- Rounded buttons, segmented tabs, mode cards, and analysis controls were tightened toward rounded-full / rounded-2xl styling.
- The Start AI Analysis button is hidden during analysis and replaced with a blue spinner, animated progress bar, and rotating reassurance messages:
  - `正在提取關鍵影格...`
  - `正在進行生物力學比對...`
  - `正在生成技術診斷報告...`
- Updated the Mode A Gemini prompt in `api/analyze.ts` to the Olympic-level swimming biomechanics coach prompt, focused on body alignment, drag, catch, propulsion, rhythm, coordination, and targeted drills.
- Preserved the Firebase Storage -> Gemini Files API upload flow and Gemini temporary file cleanup.
- Restored model selection fallback to `gemini-2.5-flash`, with `gemini-2.5-pro` aliases for high/pro/highest settings and warning fallback for unsupported `GEMINI_MODEL` values.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/OneDrive `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-05 Training Calendar and Mode B CSS Logic

- Added a Training Calendar view to the history page, extending the existing analysis history list.
- Calendar styling follows the sports-tech palette: text uses `#303036`, record markers use `#30BCED`, and today's date uses a solid `#30BCED` background with white text.
- Added mock records for the current month so the calendar can be previewed before real Firestore history exists.
- Dates with records now show a blue dot; clicking a marked date opens a rounded slide-over summary panel with mode, stroke, event, and core diagnosis text.
- Slide-over entries backed by saved Firestore reports can still jump into the full report view; mock entries are preview-only.
- Updated the Mode B prompt in `api/analyze.ts` with a CSS calculation instruction: when two or more distance/time results are available, Gemini must calculate CSS, convert it to pace per 100m, and avoid mixing CSS with SWOLF/DPS when stroke count is missing.
- Preserved the existing API request handling, Gemini model resolution, Firebase/Gemini Files API flow, and response shape.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/OneDrive `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-06 Admin Review Dashboard

- Added a hidden admin review dashboard route in `src/App.tsx`.
- Supported routes: `/admin/reviews` and `#/admin/reviews` for static hosting preview compatibility.
- The dashboard uses mock review data with video thumbnail placeholders, analysis time, stroke, event, AI core conclusion, and review status.
- Each review card includes `Approve` and `Revise` actions. Approve marks the local mock item as precise; Revise opens a rounded modal for coach correction text.
- Added an implementation comment defining planned Firestore fields on `reports/{reportId}`:
  - `status: "pending" | "approved" | "revised"`
  - `adminFeedback: string | null`
- Visual design follows the existing sports-tech palette: `#303036` for text/borders, `#30BCED` for important actions, white/light-gray surfaces, and large rounded corners.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/OneDrive `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-06 Firestore Review Loop Integration

- `/api/analyze.ts` now writes every successful Gemini analysis result to Firestore collection `analysis_reports`.
- Each `analysis_reports` document contains exactly:
  - `createdAt`: Firebase Admin server timestamp
  - `strokeType`: detected stroke or `unknown`
  - `aiReport`: raw Gemini JSON report
  - `status`: default `pending`
  - `adminFeedback`: default `null`
- `/admin/reviews` now reads real Firestore `analysis_reports` data instead of mock review data.
- Admin dashboard query orders by `createdAt` descending, then client-sorts pending items to the top.
- Approve updates `status` to `approved`.
- Revise updates `status` to `revised` and writes the modal text to `adminFeedback`.
- `firestore.rules` now allows only admins to read/update `analysis_reports`; client create/delete are blocked, and updates are restricted to `status` and `adminFeedback`.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/OneDrive `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-07 Firebase Storage Video Playback Flow

- Exported the Firebase Storage instance from `src/firebase.ts`.
- Updated frontend video upload flow in `src/services/gemini.ts` to upload videos directly to Firebase Storage under `uploads/{uid}/...` with the Firebase Storage SDK.
- After upload, the frontend now calls `getDownloadURL()` and passes `videoUrl` into `/api/analyze`.
- `/api/analyze.ts` now stores `videoUrl` with each Firestore `analysis_reports` document alongside `createdAt`, `strokeType`, `aiReport`, `status`, and `adminFeedback`.
- `/admin/reviews` now reads `videoUrl` and renders an HTML5 `<video controls>` player in each review card when a video URL exists.
- `firestore.rules` now includes `videoUrl` in the `analysis_reports` schema and keeps it immutable from admin review updates.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/OneDrive `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-07 videoUrl Null Write Fix

- Updated `src/services/gemini.ts` so Firebase Storage upload resolves with the completed `UploadTaskSnapshot`, then calls `getDownloadURL(uploadSnapshot.ref)`.
- Added browser console logs after the Firebase Storage download URL is generated and before `/api/analyze` is called with `videoUrl`.
- Added a frontend guard so requests with `videoStoragePath` cannot be sent to `/api/analyze` without a non-empty `videoUrl`.
- Updated `api/analyze.ts` to validate that Mode A uploaded-video requests include `videoUrl`; missing values now return HTTP `400` instead of writing `null`.
- Added a backend console log immediately before writing `analysis_reports` so Vercel logs show the exact `videoUrl` being persisted.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/esbuild `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-08 Analyze API Debug Hardening

- Added an entry confirmation log at the top of both `api/analyze.ts` and the local Express `/api/analyze` route in `server/index.ts`.
- Standardized fatal backend logging with `console.error("[後端重大錯誤] 執行失敗:", error)` and guaranteed HTTP `500` JSON responses so the frontend does not stay pending indefinitely.
- Wrapped Firestore RAG prompt construction and Gemini `generateContent` calls in explicit `try...catch` blocks in `api/analyze.ts`.
- Added a 180-second API timeout guard around analysis execution in both Vercel and local Express analyze handlers.
- Updated local Express CORS to allow the `Authorization` header used by Firebase ID token requests.
- Wrapped local `server/gemini.ts` Gemini analysis execution in `try...catch` so failures are logged and propagated to the route-level `500` handler.
- Commit pushed to GitHub main: `0a1fb1f Harden analyze API error handling`.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/esbuild `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-08 Frontend Upload Trace Logs

- Added explicit trace logs to `handleFileChange` and `handleAnalyze` in `src/App.tsx` so DevTools shows button clicks, selected file state, Firebase upload start, download URL, `/api/analyze` call, API result, and personal report history writes.
- Added `console.warn("[前端阻斷] ...")` before early exits for missing mode, missing Mode A event, invalid Mode B race entries, non-video file selection, and no-video Mode A analysis.
- Wrapped `uploadVideoForAnalysis` in `src/services/gemini.ts` with `try...catch` and `console.error("[前端上傳錯誤]:", error)` so Firebase Storage failures are visible instead of silently disappearing.
- Added service-level logs for selected file state, Firebase Storage upload start, download URL retrieval, and `/api/analyze` preparation.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/esbuild `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-08 Gemini Video Payload Binding Fix

- Updated `api/analyze.ts` so Mode A can stage video content from `videoUrl` when a Firebase Storage path is unavailable, downloading the URL to `/tmp` and uploading it through Gemini Files API before calling `generateContent`.
- Preserved the existing Firebase Storage path flow; `videoStoragePath` remains the preferred server-side source, while `videoUrl` now works as a fallback source for Gemini video parts.
- Added the requested backend trace log immediately before the Gemini call: `console.log("[後端追蹤] 準備送出的分析請求，是否包含影片:", !!videoUrl, "影片網址:", videoUrl)`.
- Updated local `server/gemini.ts` to accept `videoUrl`, download it, and attach it as an inline video part for local API testing.
- Updated prompt video-state text so `videoUrl` is reported as a received video source instead of falling through to "no video".
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/esbuild `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-08 RAG Retrieval Restore

- Confirmed `api/analyze.ts` still injects Firestore coach feedback into Gemini `systemInstruction`, then strengthened the lookup with `console.log("[RAG 檢索前] 目前前端傳入的查詢泳姿為:", normalizedStrokeType)` and `.trim()` normalization before the `where("strokeType", "==", ...)` query.
- Updated `resolveRequestedStrokeType` to canonicalize explicit `strokeType` values and include `inputs.strokeType` in Mode A candidate parsing.
- Restored full RAG retrieval in local `server/gemini.ts`, including Firestore `analysis_reports` query by `strokeType`, `createdAt desc`, `limit(10)`, non-empty `adminFeedback` filtering, and top-3 coach feedback prompt injection.
- Local and Vercel paths now both log `[RAG System] 成功注入 X 筆教練歷史紀錄` after RAG prompt construction.
- RAG guidance is placed before the base system instruction so coach history remains the highest-priority instruction sent to Gemini.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/esbuild `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-08 RAG Stroke Mapping

- Added a backend stroke mapping table in both `api/analyze.ts` and `server/gemini.ts` so canonical AI/frontend labels map to the Firestore coach-history labels.
- Mappings include `freestyle/free/front crawl -> 自由式`, `breaststroke/breast -> 蛙式`, `backstroke/back -> 仰式`, `butterfly/fly -> 蝶式`, and `medley/im/individual medley -> 混合式`.
- Firestore RAG lookups now map the parsed stroke before `where("strokeType", "==", mappedStrokeType)`.
- Updated RAG debug logging to show both values: `原始輸入：[freestyle]，映射後查詢：[自由式]`.
- Verification: `npm.cmd run lint` passed.

## 2026-05-08 analysis_reports Soft Delete

- Changed new `analysis_reports` writes to use visibility `status: "active"` and review workflow `reviewStatus: "pending"`.
- Added Admin SDK status update API at `/api/reports/[id]/status` plus a matching local Express route at `/api/reports/:id/status`; allowed statuses are `active`, `deleted`, and `archived`.
- Updated RAG Firestore queries in `api/analyze.ts` and `server/gemini.ts` to include `where("status", "==", "active")`, so hidden reports no longer enter coach-feedback retrieval.
- Updated `/admin/reviews` to query only active reports and added a `刪除/隱藏` button that calls the status API with `newStatus: "deleted"`.
- Moved admin review actions to `reviewStatus` so `Approve` / `Revise` no longer overwrite visibility status.
- Updated `firestore.rules` schema for `status`, `reviewStatus`, optional `updatedAt`, and admin review updates.
- Added comments noting Firestore composite indexes must be updated for `status + strokeType + createdAt` RAG queries and `status + createdAt` admin list queries.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed outside the sandbox after the known Windows/esbuild `spawn EPERM` issue appeared inside the sandbox.

## 2026-05-13 Frontend Brand UI and Monthly Records Filter

- Updated Tailwind theme colors so the primary brand color is `#2D3047` and the hover accent is `#93B7BE`, while preserving the Source Han Sans / Noto Sans TC font stack.
- Added global tactile feedback for buttons, links, role-button elements, and cursor-pointer interactive controls with hover lift, shadow, active scale, and pointer cursor behavior.
- Reworked primary circular icons and major action buttons to use dark brand backgrounds, white icons/text, and the light brand hover state.
- Added `selectedMonth` state and a month dropdown to the My Records / Analysis History page.
- Added Firestore month filtering with `where("createdAt", ">=", startOfMonth)` and `where("createdAt", "<=", endOfMonth)` using `Timestamp.fromDate(...)`.
- Added a separate records listener to build month options from the current month plus months that already contain user reports.
- Added the empty state text `該月份尚無分析紀錄` when the selected month has no history.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Target Tracking Prompt Injection

- Added a Mode A `目標鎖定` card under the video upload area with `startTime`, `endTime`, and `targetDescription` inputs.
- Updated the frontend `/api/analyze` payload so optional target tracking fields are sent with uploaded-video analysis requests.
- Updated `api/analyze.ts` and local `server/gemini.ts` to accept the optional tracking fields without breaking older clients.
- Added dynamic Gemini system instruction injection after RAG coach history and before the base system instruction, forcing analysis to focus only on the requested time segment and described swimmer.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 AI Timeline Tags and Playback Controls

- Added a strict Gemini system instruction requiring video-specific observations to include timestamps in `[MM:SS]` format.
- Mirrored the timestamp instruction in both `api/analyze.ts` and local `server/gemini.ts`.
- Added a Mode A report video player driven by `videoRef`, using the uploaded Firebase Storage `videoUrl`.
- Added playback speed controls for `1x`, `0.5x`, and `0.25x` with the dark brand color and light hover accent.
- Added a regex-based frontend parser that turns `[MM:SS]` text inside report fields into clickable time-tag buttons.
- Added `handleSeek` so clicking a time tag seeks the report video to the target second and starts playback automatically.
- Personal `reports` writes now include `videoUrl` so future history entries can reopen with synced playback.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Report Privacy Alert and Timestamp Parser Polish

- Added a report-page info alert explaining that uploaded videos are auto-destroyed after 24 hours while AI diagnosis and coach guidance records are preserved.
- Replaced the prior timestamp renderer with `parseTextWithTimestamps(text, onSeek)` using `/\[(\d{2}:\d{2})\]/g`.
- Updated timestamp buttons to use explicit brand colors `#93B7BE` and `#2D3047`, rounded corners, and tactile hover/active feedback.
- Kept timestamp rendering wired across diagnosis, advice, metrics, training plan, growth advice, and missing-data text.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Mode B Strict Event and Lap Grid Refactor

- Replaced Mode B `commonEvents` and custom event input with a strict event dropdown covering freestyle, butterfly, backstroke, breaststroke, and medley distances.
- Added event-distance parsing and dynamic lap calculation from selected event distance and pool length.
- Changed Mode B `splits` and `strokeCounts` from single strings to per-lap `string[]` state, reset whenever event or pool length changes.
- Replaced the single split/stroke-count inputs with a responsive per-lap input grid.
- Payload formatting now sends `splits` and `strokeCounts` as `number[]`, with empty lap values converted to `0`.
- Updated frontend service and backend/local Gemini input formatting to read per-lap arrays.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Mode B Personal Science Coach Report

- Strengthened Mode B Gemini prompts in `api/analyze.ts` and `server/gemini.ts` so race entries include per-lap `splits` and `strokeCounts`, and the AI must act as a senior swim coach.
- Required Mode B JSON to include `performanceMetrics` (`swolf`, `dps`, `css`, `finaPoints`, `analysis`) and `trainingPlan` (`warmup`, `drills`, `mainSet`, `coolDown`), while mirroring metrics into the legacy `metrics` field for compatibility.
- Normalized Mode B API results before saving, so personal Firestore `reports` documents keep both the new `performanceMetrics` data and legacy `metrics` data.
- Updated the report page to render Mode B SWOLF, DPS, CSS, and FINA Points in a professional data row, followed by a scientific training-plan grid with Warmup, Drills, highlighted Main Set, and Cool Down cards.
- Updated admin/history summaries to prefer `performanceMetrics.analysis` when available.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Cross-Mode Mode A to Mode B Planning Link

- Added a Mode B pre-analysis lookup for the user's latest Mode A report in personal Firestore `reports`, with the current `history` state as a fallback.
- Extracted Mode A `findings` into `historicalFindings` and sent them through the frontend `analyzeSwim` payload.
- Updated `api/analyze.ts` and `server/gemini.ts` so Mode B prompts require `trainingPlan.drills` to prioritize corrective drills for historical Mode A flaws and append `(Ref: Mode A)` to linked drills.
- Added report UI rendering that removes `(Ref: Mode A)` from visible drill text and replaces it with the badge `動作診斷連動建議`.
- Preserved the raw `(Ref: Mode A)` marker in saved `trainingPlan.drills` data so Firestore history keeps the linkage metadata.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Mode B Fluid Dynamics Prompt Upgrade

- Added a dedicated `MODE_B_SPORTS_SCIENCE_PROMPT` to both `api/analyze.ts` and `server/gemini.ts`.
- Injected the full fluid-dynamics baseline covering total drag, pressure drag, wave drag, frontal projection area, DPS, stroke rate, and active drag.
- Added the advanced drill mapping matrix for freestyle, backstroke, breaststroke, and butterfly, requiring `(Ref: Mode A)` markers when historical Mode A flaws drive the prescription.
- Clarified that the system's `efficiencyAnalysis` should be written into `performanceMetrics.analysis` to preserve the existing JSON schema.
- Confirmed `historicalFindings` remains formatted and passed directly into the Mode B Gemini prompt.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Mode B 41-Point Technical Evaluation Matrix

- Added `MODE_B_TECHNICAL_EVALUATION_PROMPT` to both `api/analyze.ts` and `server/gemini.ts`.
- Injected the full four-stroke micro technical evaluation standard with 41 checkpoints: freestyle 11, backstroke 10, breaststroke 10, and butterfly 10.
- Instructed Mode B analysis to compare athlete data against the standard movement models when producing `performanceMetrics.analysis` and `growthAdvice`.
- Preserved the existing JSON output schema, fluid-dynamics prompt, advanced drill mapping, and `historicalFindings` linkage rules.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Gemini JSON Sanitization

- Replaced direct Gemini `JSON.parse(stripCodeFence(text))` calls with `parseGeminiJsonResponse(text)` in both `api/analyze.ts` and `server/gemini.ts`.
- Sanitization now removes Markdown fences, extracts the first `{` through the last `}`, and parses only that JSON block.
- Parse failures now log the raw Gemini response and sanitized response before throwing a clear frontend-facing error.
- This fixes failures such as `Unexpected non-whitespace character after JSON` when Gemini returns extra prose around the JSON object.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Mode B Athlete Profile Calibration

- Added an Athlete Profile modal in `App.tsx` that intercepts first-time Mode B entry until gender and birth date are provided.
- Added `athleteProfile` state with `gender` and `birthDate`, plus a required Male/Female dropdown and date input.
- Mode B analysis payloads now send `athleteProfile` through `src/services/gemini.ts` to `/api/analyze`.
- Added demographic calibration prompts in `api/analyze.ts` and `server/gemini.ts` so FINA Points use gender-specific base times and age-aware physiology guidance.
- Personal Firestore `reports` writes now preserve the Mode B `athleteProfile` used for the analysis.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Athlete Profile Cloud Persistence

- Added Firestore profile sync in `App.tsx`: after auth resolves, the app reads `users/{uid}` and hydrates local `athleteProfile` from cloud `gender` and `birthDate`.
- New users without profile data are guided into the Athlete Profile modal, while returning users with cloud data are not interrupted.
- Added modal loading and saving states, including a spinner while cloud profile data is being fetched.
- Reworked `Save & Continue` to persist profile changes with `setDoc(..., { merge: true })`, show `泳者檔案已更新`, and only proceed to Mode B when the modal was opened from the Mode B entry.
- Added a Header `Edit Profile` icon button next to History and Logout so users can edit their cloud-backed profile anytime.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-13 Mode A Quota and Mode B Soft Paywall

- Extended `AthleteProfile` with `modeAUsage: { count, month }` and hydrate it from `users/{uid}` alongside gender and birth date.
- Added a free-plan Mode A quota of 3 diagnoses per month, including automatic month reset and Firestore `modeAUsage` sync.
- Mode A now blocks free users after the monthly limit and opens the paywall modal; successful analyses increment usage only after the API returns.
- Added a small Mode A form hint showing `本月剩餘免費診斷次數：X / 3` for free users.
- Added a Mode B soft paywall: performance metrics remain visible, while the full scientific training plan is blurred and covered for free users.
- Added a paywall modal and a training-plan overlay with a lock icon, `升級 Pro 版解鎖完整科學課表`, and an `升級 Pro` button.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-14 Gemini Generation Config Hardening

- Added `maxOutputTokens: 8192` alongside `responseMimeType: "application/json"` in both `api/analyze.ts` and `server/gemini.ts`.
- Kept official JSON mode enabled for the SDK and local REST Gemini calls.
- Simplified Gemini response parsing to direct JSON-mode parsing after minimal code-fence cleanup.
- Parse failures now log `Raw Gemini Response:` before throwing a clear backend error.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-14 Gemini Response Schema and Safe Parse

- Added `ANALYSIS_REPORT_RESPONSE_SCHEMA` to both `api/analyze.ts` and `server/gemini.ts`.
- Gemini generation config now includes `responseSchema` in addition to JSON mode and `maxOutputTokens: 8192`, requiring `performanceMetrics`, `trainingPlan`, `growthAdvice`, and `missingData`.
- Replaced direct JSON parsing with `safeParseJSON(rawText)`, which strips Markdown fences, extracts the JSON object block, and sanitizes problematic control characters.
- Parse failures now print the full bounded raw response with `--- RAW GEMINI RESPONSE START/END ---`.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-14 Cross-Mode Data Sync and Guardrails

- Verified Mode B preloads the latest personal Mode A report from Firestore `reports` with `uid`, `mode === "A"`, `orderBy("createdAt", "desc")`, and `limit(1)`.
- Refined Mode A finding extraction so `historicalFindings` carries concise defect labels instead of long combined diagnosis prose.
- Injected `【歷史動作診斷紀錄】` into both `api/analyze.ts` and `server/gemini.ts` Mode B prompts when historical findings exist.
- Added cross-mode instructions requiring Mode B efficiency analysis to connect race data with historical defects, and requiring linked corrective drills to carry `(Ref: Mode A)`.
- Added anti-hallucination and tag-isolation constraints: Mode B must not invent video timestamps, and `(Ref: Mode A)` may appear only in `trainingPlan.drills`.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.

## 2026-05-14 Mode B Stroke-Scoped History Lookup

- Added `extractStrokeFromEvent` in `App.tsx` to derive `自由式`, `蛙式`, `仰式`, or `蝶式` from the selected Mode B race event.
- Updated the latest Mode A Firestore lookup to include `where("stroke", "==", extractedStroke)` so freestyle analysis cannot reuse breaststroke history.
- Applied the same stroke filter to the local `history` fallback lookup.
- Added `whitespace-pre-wrap` to the Mode B `Efficiency Analysis` and shared `Coach's Growth Advice` text containers so AI paragraph breaks render correctly.
- Verification: `npm.cmd run lint` passed. `npm.cmd run build` passed.
