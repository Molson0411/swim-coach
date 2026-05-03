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
GEMINI_MODEL=gemini-2.0-flash
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
FIREBASE_STORAGE_BUCKET=swimcoach-e7ddf.firebasestorage.app
```

`GEMINI_MODEL` 可用環境變數覆蓋；目前 `/api/analyze.ts` 預設為 `gemini-2.0-flash`，並會清除環境變數前後空白與外層引號，避免 Vercel env 格式造成模型 404。

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
