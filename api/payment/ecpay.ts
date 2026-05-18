import { createHash, randomBytes } from "node:crypto";

export type EcpayParams = Record<string, string | number>;

export const ECPAY_PRO_PLAN_AMOUNT = 300;
export const ECPAY_STAGE_CHECKOUT_URL = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

export function getEcpayConfig() {
  const merchantId = process.env.ECPAY_MERCHANT_ID;
  const hashKey = process.env.ECPAY_HASH_KEY;
  const hashIv = process.env.ECPAY_HASH_IV;

  if (!merchantId || !hashKey || !hashIv) {
    throw new Error("ECPay environment variables are missing. Required: ECPAY_MERCHANT_ID, ECPAY_HASH_KEY, ECPAY_HASH_IV.");
  }

  return {
    merchantId,
    hashKey,
    hashIv,
    checkoutUrl: ECPAY_STAGE_CHECKOUT_URL,
  };
}

export function generateMerchantTradeNo() {
  return `SC${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString("hex").toUpperCase()}`.slice(0, 20);
}

export function formatEcpayTradeDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function generateCheckMacValue(params: EcpayParams, hashKey: string, hashIv: string) {
  const sorted = Object.entries(params)
    .filter(([key]) => key !== "CheckMacValue")
    .sort(([a], [b]) => a.localeCompare(b, "en"));

  const plainText = [
    `HashKey=${hashKey}`,
    ...sorted.map(([key, value]) => `${key}=${value}`),
    `HashIV=${hashIv}`,
  ].join("&");

  return createHash("sha256")
    .update(ecpayUrlEncode(plainText).toLowerCase())
    .digest("hex")
    .toUpperCase();
}

export function ecpayUrlEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/%2D/gi, "-")
    .replace(/%5F/gi, "_")
    .replace(/%2E/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2A/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")");
}

export function normalizeEcpayBody(body: unknown): Record<string, string> {
  if (!body) {
    return {};
  }

  if (typeof body === "string") {
    return Object.fromEntries(new URLSearchParams(body).entries());
  }

  if (typeof body === "object") {
    return Object.fromEntries(
      Object.entries(body as Record<string, unknown>)
        .map(([key, value]) => [key, Array.isArray(value) ? String(value[0] || "") : String(value ?? "")])
    );
  }

  return {};
}
