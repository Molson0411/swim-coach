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
- `api/files/start-upload.ts`：Vercel Serverless Function，建立 Gemini Files API 大檔上傳 session。
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

Vercel Function 的 request body 不適合直接接收大影片，所以專案不再使用 base64 JSON 上傳影片。

目前流程：

1. 使用者在前端選擇影片。
2. 前端檢查檔案型別必須是 `video/*`，大小不可超過 1GB，並確認使用者 `freeCredits > 0`。
3. 前端帶 Firebase ID token 呼叫 `/api/files/start-upload`。
4. 後端驗證 Firebase ID token 與額度後，使用 Gemini API key 建立 Gemini Files API resumable upload session。
5. 前端將影片切成不大於 4MB 的 chunk，依序帶 Firebase ID token 呼叫 `/api/files/upload-chunk`。
6. 後端驗證 Firebase ID token 與額度後，代為把 chunk 轉發到 Gemini upload URL；每個 chunk 前端最多重試 3 次。
7. 最後一個 chunk 使用 `upload, finalize`，Gemini 回傳 `file_uri`。
8. 前端呼叫 `/api/analyze`，把 `file_uri`、mime type、文字描述與項目送給後端。
9. 後端驗證 Firebase ID token，使用 Firestore transaction 先扣 `freeCredits - 1`，再呼叫 Gemini；若 Gemini 失敗則補回 1 點。
10. 後端等待 Gemini file 進入 `ACTIVE` 狀態後，再呼叫 Gemini model 做分析。

這樣可以避免：

- 前端把大影片轉成 base64 造成記憶體暴增。
- Vercel API route 收到超大 request body。
- 瀏覽器因 CORS 無法直接呼叫 Gemini upload URL。
- Gemini API key 暴露在前端。

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
3. Production deployment 完成後，API base URL 設為：

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
