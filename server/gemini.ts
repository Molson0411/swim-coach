import type { AnalysisMode, AnalysisReport } from "../src/types";
import { getAdminDb } from "../lib/firebase-admin.js";

type AnalyzeInputs = {
  videoBase64?: string;
  videoFileUri?: string;
  videoFileName?: string;
  videoMimeType?: string;
  videoUrl?: string;
  startTime?: string;
  endTime?: string;
  targetDescription?: string;
  strokeType?: string;
  textInput?: string;
  event?: string;
  athleteProfile?: {
    gender: "M" | "F" | "";
    birthDate: string;
  };
  historicalFindings?: string[];
  raceEntries?: {
    event: string;
    time: string;
    strokeCounts?: number[];
    poolLength: string;
    splits?: number[];
  }[];
};

const ANALYSIS_REPORT_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["mode", "performanceMetrics", "trainingPlan", "growthAdvice", "missingData"],
  properties: {
    mode: { type: "STRING", enum: ["A", "B"] },
    impression: { type: "STRING", nullable: true },
    stroke: { type: "STRING", nullable: true },
    findings: {
      type: "ARRAY",
      nullable: true,
      items: {
        type: "OBJECT",
        required: ["metaphor", "analysis"],
        properties: {
          metaphor: { type: "STRING" },
          analysis: { type: "STRING" },
        },
      },
    },
    suggestions: {
      type: "ARRAY",
      nullable: true,
      items: {
        type: "OBJECT",
        required: ["mnemonic", "drill"],
        properties: {
          mnemonic: { type: "STRING" },
          drill: {
            type: "OBJECT",
            required: ["name", "purpose"],
            properties: {
              name: { type: "STRING" },
              purpose: { type: "STRING" },
            },
          },
        },
      },
    },
    metrics: {
      type: "OBJECT",
      nullable: true,
      required: ["swolf", "dps", "css", "finaPoints", "analysis"],
      properties: {
        swolf: { type: "NUMBER" },
        dps: { type: "NUMBER" },
        css: { type: "STRING" },
        finaPoints: { type: "NUMBER" },
        analysis: { type: "STRING" },
      },
    },
    performanceMetrics: {
      type: "OBJECT",
      required: ["swolf", "dps", "css", "finaPoints", "analysis"],
      properties: {
        swolf: { type: "NUMBER" },
        dps: { type: "NUMBER" },
        css: { type: "STRING" },
        finaPoints: { type: "NUMBER" },
        analysis: { type: "STRING" },
      },
    },
    trainingPlan: {
      type: "OBJECT",
      required: ["warmup", "drills", "mainSet", "coolDown"],
      properties: {
        warmup: { type: "STRING" },
        drills: { type: "STRING" },
        mainSet: { type: "STRING" },
        coolDown: { type: "STRING" },
      },
    },
    growthAdvice: { type: "STRING" },
    missingData: {
      type: "ARRAY",
      items: { type: "STRING" },
    },
  },
} as const;

const RAG_HISTORY_LIMIT = 10;
const RAG_INJECTION_LIMIT = 3;
const STROKE_QUERY_LABELS: Record<string, string> = {
  freestyle: "自由式",
  free: "自由式",
  "front crawl": "自由式",
  自由式: "自由式",
  breaststroke: "蛙式",
  breast: "蛙式",
  蛙式: "蛙式",
  backstroke: "仰式",
  back: "仰式",
  仰式: "仰式",
  butterfly: "蝶式",
  fly: "蝶式",
  蝶式: "蝶式",
  medley: "混合式",
  im: "混合式",
  "individual medley": "混合式",
  混合式: "混合式",
  個人混合式: "混合式",
};

const SYSTEM_INSTRUCTION = `你是一位專業游泳教練與運動數據分析師，請使用繁體中文回答。
模式 A：分析影片、文字描述與游泳項目，輸出動作觀察、主要問題與訓練建議。
模式 B：分析比賽或訓練數據，估算 SWOLF、DPS、CSS 與訓練方向。
規則：
- 只能輸出符合指定 schema 的 JSON，不要輸出 Markdown 或額外說明。
- 若資料不足，請在 missingData 列出缺少項目，並根據已有資料給出保守建議。
- 建議要具體、可執行，訓練菜單可使用「組數 x 距離 項目 @ 配速/休息」格式。
【強制格式要求】：當你指出影片中的特定動作瑕疵或完美示範時，請「務必」標註精確的時間點。時間格式必須嚴格遵守 [MM:SS] 的括號格式。範例：『在 [00:12] 時，你的右手入水角度過大...』。`;

const MODE_B_SPORTS_SCIENCE_PROMPT = `【角色與流體動力學解析基準 (Fluid Dynamics Baseline)】
你是一名精通「流體動力學」與「游泳生物力學」的頂級 AI 國家隊教練。
本系統的 efficiencyAnalysis 請寫入 JSON 欄位 performanceMetrics.analysis。
在撰寫 efficiencyAnalysis 時，必須基於以下學理進行論述：
1. 總阻力 (D) = 摩擦阻力 + 壓力阻力(外形阻力) + 波浪阻力。
2. 評估選手是否透過核心穩定維持高位水平，極小化正面投影面積 (S) 以降低壓力阻力。
3. 分析推進長度 (DPS) 與划水頻率 (Stroke Rate) 的最佳平衡，並評估主動阻力 (Active Drag) 的控制成效。

【進階缺陷定向優化矩陣 (Advanced Drill Mapping)】
若收到 historicalFindings (模式 A 歷史瑕疵)，請嚴格依照以下流體力學矩陣，在 trainingPlan.drills 安排對應的專項操練，並務必在動作名稱後方加上 "(Ref: Mode A)" 標記：

[自由式 (捷泳)]
- 瑕疵含「不對稱/滾轉不足/蛇行/核心瓦解」 -> 處方：六次打腿單臂划水切換操練 (6-To-1 Drill)。目的：固化左右滾轉對稱性與核心剛性，降低橫向外形阻力。
- 瑕疵含「早期垂直前臂 (EVF) 缺失/抱水無力」 -> 處方：握拳操練 (Fist Drill) 或 指尖拖曳操練 (Fingertip Drag Drill)。目的：高度孤立前臂落實 EVF，強制建立高肘回臂軌跡。

[仰式 (背泳)]
- 瑕疵含「骨盆塌陷/頭部過度抬起/坐姿」 -> 處方：頭部中立定位與水下 15 公尺海豚打腿專項。目的：維持長軸剛性流線型，抑制外形阻力因體態彎曲而呈幾何級數激增。

[蛙式]
- 瑕疵含「收腿阻力過大/時序重疊/剪刀腳」 -> 處方：極限壓縮收腿外翻時間的彈夾推進 (Snap Through) 練習。目的：嚴格落實「划、吸、踢、滑」線性鏈，消弭瞬態壓力阻力。

[蝶式]
- 瑕疵含「換氣遲滯/騰空窗口破壞/肩帶過載」 -> 處方：單臂蝶式操練 (Single Arm Butterfly Drill) 或 Hypoxic (低氧) 限制集。目的：降低肩帶夾擠，精雕抓水時空點，防止頻繁抬頭引發流線型崩解。

【系統強制約束】
生成課表與分析時，嚴格遵循上述流體力學專項操練與術語，禁止發明未經定義的訓練動作。確保輸出的 JSON 格式完全符合系統規範。`;

const MODE_B_TECHNICAL_EVALUATION_PROMPT = `【四大泳姿微觀分解動作檢驗基準 (Full Technical Evaluation Standard)】
在產出 efficiencyAnalysis 與 growthAdvice 時，請務必將泳者的數據與以下 41 項標準動作模型進行比對，並直接引用對應的力學名詞進行論述。
本系統的 efficiencyAnalysis 請寫入 JSON 欄位 performanceMetrics.analysis，growthAdvice 請寫入 JSON 欄位 growthAdvice。

[自由式 11 項檢驗]
1. 水平定位：頭部中立，水平面位於髮際線。
2. 肩線入水：切入點介於頭肩之間，嚴禁越過中線。
3. 軸向延伸：前象限極限延伸，延長船體結構。
4. EVF抱水：屈肘旋前，建立高位大槳面。
5. S形拉水：水下向外、內、外弧形壓迫。
6. 加速推水：順應滾轉向髖部爆發性後推。
7. 解脫出水：轉移能量，掌心輕鬆帶離水面。
8. 高肘回臂：肘部最高點，前臂放鬆向前揮送。
9. 縱軸滾轉：髖肩同向交替滾轉 30-45 度。
10. 側向呼吸：順勢側轉，半邊泳鏡留於水中。
11. 鞭狀打腿：髖部發力，踝關節蹠屈維持彈性。

[仰式 10 項檢驗]
1. 仰臥定位：後腦平枕，水沒耳根，臀部貼水。
2. 小指入水：手臂伸直，肩線延長線上小指切入。
3. 軸向滑行：水下短暫前伸，微屈肘尋找靜水。
4. 屈肘錨定：彎曲 90 度建立高位大槳面鎖定。
5. 上掃推進：大臂與前臂向後上內側爆發推壓。
6. 下掃加速：手腕內屈，朝大腿外側加速推擊。
7. 拇指出水：藉由肩帶上提，大拇指率先垂直破水。
8. 扇形回臂：直臂於空中沿扇形軌跡向前揮送。
9. 動態滾轉：配合風車軌跡向兩側滾轉 30-40 度。
10. 鞭狀打腿：雙腿緊靠，髖部發力密集交替打水。

[蛙式 10 項檢驗]
1. 流線滑行：水平俯臥，雙臂併攏前伸。
2. 對稱外掃：雙手向外側斜下方滑動尋找靜水。
3. 高肘抓水：快速屈肘內旋，建立水下推進面。
4. 強力內掃：向後內上方弧形壓迫，抬升上半身。
5. 胸下匯合：掌心相對迅速收攏，縮小橫截面積。
6. 前伸破水錐：雙手緊貼沿水面快速向前推出。
7. 收腿屈膝：雙膝微張，腳跟貼臀，極小化屈髖。
8. 外翻勾腳：腳掌猛烈外翻，內側對準後方水體。
9. 鞭打夾腿：向後下方圓弧蹬伸並強力內夾。
10. 同步吸氣：內掃抬升時順勢露面吸氣，回臂埋頭。

[蝶式 10 項檢驗]
1. 胸部壓水：核心發動，胸部下壓引導波浪傳導。
2. 拇指入水：雙臂對稱伸直，拇指朝下斜向切入。
3. 外掃前伸：水下短暫前伸，向外斜下尋找靜水。
4. 高肘錨定：突發屈肘，前臂內旋轉向正後方。
5. 鑰匙孔內掃：雙手沿鑰匙孔軌跡向胸腹下擠壓。
6. 爆發推水：沿骨盆兩側向後直線推擊達最高峰。
7. 對稱出水：小指領先，雙臂隨肩帶抬升滑出水面。
8. 低空回臂：直臂放鬆，貼近水面水平向前甩送。
9. 第一下打：雙手入水瞬間完成下打，托起骨盆。
10. 第二下打：推水出水瞬間爆發下打，提供推進力。`;

function getApiKey() {
  return process.env.GEMINI_API_KEY || "";
}

function buildPrompt(mode: AnalysisMode, inputs: AnalyzeInputs) {
  const schema = `請嚴格輸出以下 JSON schema：
{
  "mode": "A 或 B",
  "impression": "整體印象",
  "stroke": "判斷的泳姿或動作型態",
  "findings": [{"metaphor": "好記的比喻", "analysis": "技術分析"}],
  "suggestions": [{"mnemonic": "口訣", "drill": {"name": "訓練名稱", "purpose": "訓練目的"}}],
  "metrics": {"swolf": 0, "dps": 0, "css": "CSS 估算", "finaPoints": 0, "analysis": "數據解讀"},
  "performanceMetrics": {"swolf": 0, "dps": 0, "css": "CSS 估算", "finaPoints": 0, "analysis": "數據解讀"},
  "trainingPlan": {"warmup": "熱身", "drills": "技術訓練", "mainSet": "主課表", "coolDown": "緩和"},
  "growthAdvice": "下一步成長建議",
  "missingData": []
}`;

  if (mode === "A") {
    return `${schema}

輸入模式 A：影片與動作分析
游泳項目：${inputs.event || "未提供"}
使用者補充描述：${inputs.textInput || "未提供"}
影片狀態：${inputs.videoFileUri || inputs.videoBase64 || inputs.videoUrl ? "已提供影片" : "未提供影片"}`;
  }

  return `${schema}

輸入模式 B：數據與訓練分析
${MODE_B_SPORTS_SCIENCE_PROMPT}

${MODE_B_TECHNICAL_EVALUATION_PROMPT}

Mode B strict output rules:
- Act as a senior swimming coach and sports data analyst.
- Use every raceEntries item, including splits and strokeCounts numeric arrays.
- Calculate or estimate SWOLF, DPS, CSS, and FINA points from lap data.
- Return performanceMetrics and trainingPlan. Keep metrics identical to performanceMetrics for backward compatibility.
- If historicalFindings are provided, trainingPlan.drills must prioritize corrective drills from the Advanced Drill Mapping matrix above. Add the exact suffix "(Ref: Mode A)" after each linked drill name or linked drill sentence.
${formatAthleteProfile(inputs.athleteProfile)}
${formatHistoricalFindings(inputs.historicalFindings)}
${inputs.raceEntries?.map((entry, index) => (
  `項目 ${index + 1}：${entry.event}，時間：${entry.time}，每趟划手數：${formatNumberArray(entry.strokeCounts)}，泳池長度：${entry.poolLength}，每趟分段：${formatNumberArray(entry.splits)}`
)).join("\n") || "未提供數據"}`;
}

function formatHistoricalFindings(findings: AnalyzeInputs["historicalFindings"]) {
  if (!findings || findings.length === 0) {
    return "Historical Mode A findings: not provided.";
  }

  return [
    "Historical Mode A findings for cross-mode planning:",
    ...findings.map((finding, index) => `${index + 1}. ${finding}`),
  ].join("\n");
}

function formatAthleteProfile(profile: AnalyzeInputs["athleteProfile"]) {
  const gender = profile?.gender === "M" ? "Male" : profile?.gender === "F" ? "Female" : "not provided";
  const birthDate = normalizeText(profile?.birthDate) || "not provided";

  if (gender === "not provided" || birthDate === "not provided") {
    return "【個人化生理基準解析 (Demographic Calibration)】\n本次分析未提供完整泳者性別或出生年月日。若需精準 FINA Points 與年齡分層訓練建議，請在 missingData 中標示缺少 athleteProfile.gender 或 athleteProfile.birthDate。";
  }

  return `【個人化生理基準解析 (Demographic Calibration)】
本次分析的泳者性別為：${gender}，出生年月日為：${birthDate}。
1. 在計算 FINA Points 時，必須嚴格對應其性別的基準時間 (Base Time) 進行精算。
2. 在撰寫 efficiencyAnalysis 與 growthAdvice 時，必須考量其「年齡」所處的生理發展階段（如：青少年的神經肌肉徵召、成年人的最大攝氧量等），給出符合其年齡區間的科學評價與重訓建議。`;
}

function formatNumberArray(values?: number[]) {
  return values && values.length > 0 ? values.join(", ") : "未提供";
}

export async function startGeminiFileUpload(input: {
  displayName: string;
  mimeType: string;
  size: number;
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }

  const response = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(input.size),
      "X-Goog-Upload-Header-Content-Type": input.mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file: {
        display_name: input.displayName,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini file upload session failed (${response.status}): ${detail}`);
  }

  const uploadUrl = response.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini did not return an upload URL.");
  }

  return { uploadUrl };
}

export async function analyzeWithGemini(
  mode: AnalysisMode,
  inputs: AnalyzeInputs
): Promise<AnalysisReport> {
  try {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured on the server.");
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const parts: unknown[] = [];
    const requestedStrokeType = resolveRequestedStrokeType(mode, inputs);
    const systemInstruction = await buildSystemInstruction(requestedStrokeType, buildTargetTrackingInstruction(inputs));

    if (inputs.videoFileName) {
      await waitForGeminiFileActive(inputs.videoFileName);
    }

    if (inputs.videoFileUri) {
      parts.push({
        file_data: {
          mime_type: inputs.videoMimeType || "video/mp4",
          file_uri: inputs.videoFileUri,
        },
      });
    }

    if (inputs.videoBase64) {
      parts.push({
        inline_data: {
          mime_type: "video/mp4",
          data: inputs.videoBase64,
        },
      });
    }

    if (!inputs.videoFileUri && !inputs.videoBase64 && inputs.videoUrl) {
      parts.push(await buildInlineVideoPartFromUrl(inputs.videoUrl, inputs.videoMimeType || "video/mp4"));
    }

    parts.push({ text: buildPrompt(mode, inputs) });

    const videoUrl = inputs.videoUrl || inputs.videoFileUri || null;
    console.log("[後端追蹤] 準備送出的分析請求，是否包含影片:", !!videoUrl, "影片網址:", videoUrl);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemInstruction }],
          },
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: ANALYSIS_REPORT_RESPONSE_SCHEMA,
            maxOutputTokens: 8192,
          },
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini API request failed (${response.status}): ${detail}`);
    }

    const data = await response.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini API returned an empty response.");
    }

    return normalizeAnalysisReport(parseGeminiJsonResponse(text));
  } catch (error) {
    console.error("[Gemini API] local analyzeWithGemini failed:", error);
    throw error;
  }
}

function normalizeAnalysisReport(report: AnalysisReport): AnalysisReport {
  if (report.mode !== "B") {
    return report;
  }

  const metrics = report.performanceMetrics || report.metrics;
  if (!metrics) {
    return report;
  }

  return {
    ...report,
    performanceMetrics: metrics,
    metrics: report.metrics || metrics,
  };
}

async function buildSystemInstruction(strokeType: string | null, targetTrackingInstruction: string | null = null) {
  const coachFeedback = await fetchHistoricalCoachFeedback(strokeType);
  console.log(`[RAG System] 成功注入 ${Math.min(coachFeedback.length, RAG_INJECTION_LIMIT)} 筆教練歷史紀錄`);

  if (coachFeedback.length === 0) {
    return [
      targetTrackingInstruction,
      SYSTEM_INSTRUCTION,
    ].filter(Boolean).join("\n\n");
  }

  const historicalGuidance = coachFeedback
    .slice(0, RAG_INJECTION_LIMIT)
    .map((feedback, index) => `${index + 1}. ${feedback}`)
    .join("\n");

  return [
    "【絕對遵循：總教練歷史指導原則】",
    "以下是總教練過去針對此泳姿的專屬糾正紀錄。請務必吸收這些經驗，將其作為本次分析的最高標準，嚴禁給出與以下教練歷史糾正相衝突的建議：",
    historicalGuidance,
    "",
    targetTrackingInstruction,
    "",
    SYSTEM_INSTRUCTION,
  ].filter(Boolean).join("\n");
}

function buildTargetTrackingInstruction(inputs: AnalyzeInputs) {
  const startTime = normalizeText(inputs.startTime);
  const endTime = normalizeText(inputs.endTime);
  const targetDescription = normalizeText(inputs.targetDescription);

  if (!startTime && !endTime && !targetDescription) {
    return null;
  }

  return [
    "【強制鎖定分析目標】：這段影片中有多名游泳者。請「嚴格且僅限於」分析符合以下條件的目標：",
    `- 時間區段：從影片的 ${startTime || "未指定"} 到 ${endTime || "未指定"}`,
    `- 目標特徵：${targetDescription || "未指定"}`,
    "請絕對忽略畫面中的其他干擾人物。",
  ].join("\n");
}

async function fetchHistoricalCoachFeedback(strokeType: string | null) {
  const normalizedStrokeType = normalizeText(strokeType);
  const mappedStrokeType = mapStrokeTypeForQuery(normalizedStrokeType);
  console.log(`[RAG 檢索前] 原始輸入：[${normalizedStrokeType || ""}]，映射後查詢：[${mappedStrokeType || ""}]`);

  if (!mappedStrokeType) {
    return [];
  }

  try {
    // The status filter requires a composite index for status + strokeType + createdAt.
    // If Firestore rejects this query, click the index creation link printed in the terminal or Vercel logs.
    // Click the index creation link printed in the terminal or Vercel logs to create it.
    const snapshot = await (await getAdminDb())
      .collection("analysis_reports")
      .where("status", "==", "active")
      .where("strokeType", "==", mappedStrokeType)
      .orderBy("createdAt", "desc")
      .limit(RAG_HISTORY_LIMIT)
      .get();

    return snapshot.docs
      .map((doc) => doc.data().adminFeedback)
      .filter((feedback): feedback is string => typeof feedback === "string" && feedback.trim().length > 0)
      .map((feedback) => feedback.trim());
  } catch (error) {
    console.error(`[RAG System] Failed to load coach feedback for strokeType "${mappedStrokeType}":`, error);
    return [];
  }
}

function resolveRequestedStrokeType(mode: AnalysisMode, inputs: AnalyzeInputs) {
  const explicitStroke = inferStrokeType(inputs.strokeType) || normalizeText(inputs.strokeType);
  if (explicitStroke) {
    return explicitStroke;
  }

  const candidates = mode === "B"
    ? inputs.raceEntries?.map((entry) => entry.event) || []
    : [inputs.event, inputs.strokeType, inputs.textInput, inputs.videoFileName];

  for (const candidate of candidates) {
    const strokeType = inferStrokeType(candidate);
    if (strokeType) {
      return strokeType;
    }
  }

  return null;
}

function inferStrokeType(value: unknown) {
  const text = normalizeText(value)?.toLowerCase();
  if (!text) {
    return null;
  }

  if (/自由式|freestyle|\bfree\b|front crawl/.test(text)) {
    return "freestyle";
  }

  if (/蛙式|breaststroke|breast/.test(text)) {
    return "breaststroke";
  }

  if (/仰式|backstroke|back/.test(text)) {
    return "backstroke";
  }

  if (/蝶式|butterfly|\bfly\b/.test(text)) {
    return "butterfly";
  }

  if (/混合式|個人混合式|individual medley|\bim\b|medley/.test(text)) {
    return "medley";
  }

  return null;
}

function mapStrokeTypeForQuery(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();
  return STROKE_QUERY_LABELS[trimmed]
    || STROKE_QUERY_LABELS[normalized]
    || inferStrokeType(trimmed)
    || trimmed;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function buildInlineVideoPartFromUrl(videoUrl: string, fallbackMimeType: string) {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to download videoUrl (${response.status}): ${await response.text().catch(() => "")}`);
  }

  const contentType = response.headers.get("content-type");
  const mimeType = contentType?.startsWith("video/") ? contentType : fallbackMimeType;
  const data = Buffer.from(await response.arrayBuffer()).toString("base64");

  return {
    inline_data: {
      mime_type: mimeType,
      data,
    },
  };
}

async function waitForGeminiFileActive(fileName: string) {
  const apiKey = getApiKey();
  const name = fileName.replace(/^\/+/, "");
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${encodeURIComponent(apiKey)}`
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Gemini file status failed (${response.status}): ${detail}`);
    }

    const data = await response.json() as { state?: string };
    if (!data.state || data.state === "ACTIVE") {
      return;
    }
    if (data.state === "FAILED") {
      throw new Error("Gemini failed to process the uploaded video.");
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error("Gemini is still processing the uploaded video. Please try again in a minute.");
}

function stripCodeFence(value: string) {
  return value
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function parseGeminiJsonResponse(text: string): AnalysisReport {
  try {
    return safeParseJSON(text) as AnalysisReport;
  } catch (error) {
    console.error("[Gemini JSON Parse Error] Failed to parse Gemini response:", error);
    console.error("\n--- RAW GEMINI RESPONSE START ---\n", text, "\n--- RAW GEMINI RESPONSE END ---\n");
    throw new Error("Gemini returned invalid JSON after schema-guided parsing. Please retry or inspect server logs for the raw response.");
  }
}

function safeParseJSON(rawText: string): unknown {
  const fencedText = stripCodeFence(rawText);
  const startIndex = fencedText.indexOf("{");
  const endIndex = fencedText.lastIndexOf("}");
  const jsonBlock = startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex
    ? fencedText.slice(startIndex, endIndex + 1)
    : fencedText;
  const sanitized = sanitizeJsonControlCharacters(jsonBlock);

  return JSON.parse(sanitized);
}

function sanitizeJsonControlCharacters(value: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        result += "\\n";
      } else if (char === "\r") {
        result += "\\r";
      } else if (char === "\t") {
        result += "\\t";
      } else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(char)) {
        continue;
      } else {
        result += char;
      }
      continue;
    }

    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(char)) {
      continue;
    }

    result += char;
  }

  return result;
}
