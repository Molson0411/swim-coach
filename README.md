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

4. 啟動開發伺服器：

   ```bash
   npm run dev
   ```

5. 開啟 `http://localhost:3000`。

## 可用指令

- `npm run dev`：啟動 Vite 開發伺服器。
- `npm run start`：同 `dev`，方便部署平台或新成員使用。
- `npm run lint`：執行 TypeScript 型別檢查。
- `npm run build`：產生 production build 到 `dist/`。
- `npm run preview`：預覽 `dist/` build 結果。
- `npm run clean`：清除 `dist/`。

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
4. 新增 Repository secret：`GEMINI_API_KEY`。
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
