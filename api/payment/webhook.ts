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
    const receivedCheckMacValue = payload.CheckMacValue;
    if (!receivedCheckMacValue) {
      res.status(400).send("0|Missing CheckMacValue");
      return;
    }

    const config = getEcpayConfig();
    const expectedCheckMacValue = generateCheckMacValue(payload, config.hashKey, config.hashIv);
    if (receivedCheckMacValue.toUpperCase() !== expectedCheckMacValue) {
      console.error("[ECPay Webhook] Invalid CheckMacValue:", { payload, expectedCheckMacValue });
      res.status(400).send("0|Invalid CheckMacValue");
      return;
    }

    const merchantTradeNo = payload.MerchantTradeNo;
    if (!merchantTradeNo) {
      res.status(400).send("0|Missing MerchantTradeNo");
      return;
    }

    const db = await getAdminDb();
    const orderRef = db.collection("payment_orders").doc(merchantTradeNo);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) {
      console.error("[ECPay Webhook] Unknown MerchantTradeNo:", merchantTradeNo);
      res.status(404).send("0|Order Not Found");
      return;
    }

    const order = orderSnapshot.data();
    if (payload.RtnCode === "1") {
      const uid = order?.uid;
      if (!uid) {
        res.status(400).send("0|Missing UID");
        return;
      }

      await db.runTransaction(async (transaction) => {
        transaction.update(orderRef, {
          status: "paid",
          webhookPayload: payload,
          paidAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(db.collection("users").doc(uid), {
          subscriptionPlan: "pro",
          subscriptionProvider: "ecpay",
          subscriptionTradeNo: merchantTradeNo,
          subscriptionUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });
    } else {
      await orderRef.set({
        status: "failed",
        webhookPayload: payload,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    res.status(200).send("1|OK");
  } catch (error) {
    console.error("[ECPay Webhook] Failed to process webhook:", error);
    res.status(500).send("0|Server Error");
  }
}
