import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "../../lib/firebase-admin.js";
import { generateCheckMacValue, getEcpayConfig, normalizeEcpayBody } from "./ecpay.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).send("0|Method Not Allowed");
    return;
  }

  try {
    const payload = normalizeEcpayBody(req.body);
    console.log("[Webhook 接收]", "RtnCode:", payload.RtnCode, "UID:", payload.CustomField1);

    const receivedCheckMacValue = payload.CheckMacValue;
    if (!receivedCheckMacValue) {
      console.error("[Webhook 錯誤] 缺少 CheckMacValue");
      res.status(400).send("0|Missing CheckMacValue");
      return;
    }

    const config = getEcpayConfig();
    const expectedCheckMacValue = generateCheckMacValue(payload, config.hashKey, config.hashIv);
    if (receivedCheckMacValue.toUpperCase() !== expectedCheckMacValue) {
      console.error("[Webhook 錯誤] CheckMacValue 驗證不符");
      console.error("[ECPay Webhook] Invalid CheckMacValue:", { payload, expectedCheckMacValue });
      res.status(400).send("0|Invalid CheckMacValue");
      return;
    }

    const merchantTradeNo = payload.MerchantTradeNo;
    if (!merchantTradeNo) {
      console.error("[Webhook 錯誤] 缺少 MerchantTradeNo");
      res.status(400).send("0|Missing MerchantTradeNo");
      return;
    }

    const db = await getAdminDb();
    console.log("[Webhook] Firebase Admin Firestore 已初始化");

    if (payload.RtnCode !== "1") {
      await db.collection("payment_orders").doc(merchantTradeNo).set({
        uid: payload.CustomField1 || null,
        plan: payload.CustomField2 || "pro",
        provider: "ecpay",
        merchantTradeNo,
        amount: Number(payload.TradeAmt || 0),
        status: "failed",
        webhookPayload: payload,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log("[Webhook 記錄] 非付款成功狀態，已記錄訂單結果:", payload.RtnCode);
      res.status(200).send("1|OK");
      return;
    }

    const uid = payload.CustomField1?.trim();
    if (!uid) {
      console.error("[Webhook 寫入失敗]: 缺少 CustomField1 uid", payload);
      res.status(400).send("0|Missing UID");
      return;
    }

    console.log(`[Webhook] 準備將用戶 ${uid} 升級為 PRO...`);

    try {
      await db.collection("users").doc(uid).set({
        subscriptionPlan: "pro",
        subscriptionProvider: "ecpay",
        subscriptionTradeNo: merchantTradeNo,
        subscriptionUpdatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      await db.collection("payment_orders").doc(merchantTradeNo).set({
        uid,
        plan: "pro",
        provider: "ecpay",
        merchantTradeNo,
        amount: Number(payload.TradeAmt || 0),
        status: "paid",
        webhookPayload: payload,
        paidAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      console.log(`[Webhook 成功] 用戶 ${uid} 已寫入 Firestore`);
      res.status(200).send("1|OK");
    } catch (error) {
      console.error("[Webhook 寫入失敗]:", error);
      res.status(500).send("0|Error");
    }
  } catch (error) {
    console.error("[ECPay Webhook] Failed to process webhook:", error);
    res.status(500).send("0|Server Error");
  }
}
