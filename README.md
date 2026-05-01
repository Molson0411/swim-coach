# Swim Coach

React + Vite + Firebase + Gemini 的游泳訓練分析工具。

## 環境需求

- Node.js 22 以上
- npm
- Gemini API key

## 本機啟動

1. 安裝套件：

   ```bash
   npm install
   ```

2. 建立本機環境變數檔：

   ```bash
   cp .env.example .env.local
   ```

3. 在 `.env.local` 設定：

   ```bash
   GEMINI_API_KEY=你的 Gemini API Key
   ```

4. 啟動 API proxy：

   ```bash
   npm run dev:api
   ```

5. 另開一個終端機，啟動前端開發伺服器：

   ```bash
   npm run dev
   ```

6. 開啟 `http://localhost:3000`。

## 可用指令

- `npm run dev`：啟動 Vite 開發伺服器。
- `npm run dev:api`：啟動本機 Gemini API proxy，預設在 `http://localhost:8787`。
- `npm run start`：啟動 Node/Express API proxy，並服務 `dist/` 靜態檔。
- `npm run lint`：執行 TypeScript 型別檢查。
- `npm run build`：產生 production build 到 `dist/`。
- `npm run preview`：預覽 `dist/` build 結果。
- `npm run clean`：清除 `dist/`。

## Gemini API Proxy

前端不再直接使用 `GEMINI_API_KEY`。瀏覽器只會呼叫：

```text
POST /api/analyze
```

Gemini key 只應該設定在後端/API proxy 的環境變數：

```bash
GEMINI_API_KEY=你的 Gemini API Key
```

如果前端部署在 GitHub Pages，GitHub Pages 只能服務靜態檔，不能執行 Node API proxy。請將 API proxy 部署到 Vercel、Render、Railway 或其他可執行 Node/serverless function 的平台，再把 GitHub Actions secret 設為：

```text
VITE_API_BASE_URL=https://你的-api-proxy 網域
```

本專案已提供兩種後端入口：

- `server/index.ts`：一般 Node/Express server，可部署到 Render/Railway/Node host。
- `api/analyze.ts`：Vercel serverless function 入口。

GitHub Secrets 的值無法被讀回，只能在 Actions 或後端執行環境中注入使用；這是 GitHub 的安全機制。

## GitHub Pages 自動部署

本專案已加入 `.github/workflows/deploy.yml`。當程式推送到 `main` 分支，GitHub Actions 會自動：

1. 使用 Node.js 22。
2. 執行 `npm ci` 安裝鎖定版本套件。
3. 執行 `npm run lint` 做型別檢查。
4. 執行 `npm run build` 建置專案。
5. 將 `dist/` 部署到 GitHub Pages。

### 第一次設定 GitHub Pages

1. 到 GitHub repo 的 `Settings` > `Pages`。
2. 在 `Build and deployment` 的 `Source` 選擇 `GitHub Actions`。
3. 到 `Settings` > `Secrets and variables` > `Actions`。
4. 新增 Repository secret：`VITE_API_BASE_URL`，值為已部署的 API proxy 網址。
5. 推送到 `main` 後，到 `Actions` 頁面查看部署結果。

Vite 已設定在 GitHub Actions 中自動使用 `/${repo-name}/` 作為 GitHub Pages base path；本機開發仍使用 `/`。

## .gitignore 設定

已排除下列不應上傳的內容：

- `node_modules/`
- `dist/`、`build/`、`coverage/`
- `.env`、`.env.*`，但保留 `.env.example`
- npm/yarn/pnpm log
- Vite、快取與編輯器暫存檔
- Firebase emulator/debug 暫存檔

## 本次整理紀錄

- 整理 `package.json` 專案名稱、scripts 與 dependencies/devDependencies 分類。
- 新增跨平台 `clean` 指令，避免 Windows 無法執行 `rm -rf`。
- 新增 GitHub Pages 部署 workflow。
- 擴充 `.gitignore`，避免上傳套件、build、log、環境變數與暫存檔。
- 更新 `vite.config.ts`，讓 GitHub Actions 部署時自動套用 Pages base path。
- 新增 Gemini API proxy，避免前端暴露 `GEMINI_API_KEY`。
