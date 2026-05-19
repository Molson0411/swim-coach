import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { handleCorsPreflight, setCorsHeaders } from "../cors.js";
import { getAdminDb, verifyFirebaseToken } from "../../lib/firebase-admin.js";
import {
  ECPAY_PRO_PLAN_AMOUNT,
  formatEcpayTradeDate,
  generateCheckMacValue,
  generateMerchantTradeNo,
  getEcpayConfig,
  type EcpayParams,
} from "./ecpay.js";

type CheckoutBody = {
  uid?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(req, res);
  if (handleCorsPreflight(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const authUser = await verifyFirebaseToken(req);
    const { uid } = (req.body || {}) as CheckoutBody;
    const plan = "pro";

    if (!uid || uid !== authUser.uid) {
      res.status(403).json({ error: "UID_MISMATCH", message: "付款使用者與登入帳號不一致。" });
      return;
    }

    const config = getEcpayConfig();
    const merchantTradeNo = generateMerchantTradeNo();
    const returnUrl = process.env.ECPAY_RETURN_URL;
    const orderResultUrl = process.env.ECPAY_ORDER_RESULT_URL || "http://localhost:3001/api/payment/order-result";
    if (!returnUrl) {
      throw new Error("ECPAY_RETURN_URL is not configured.");
    }

    const params: EcpayParams = {
      MerchantID: config.merchantId,
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: formatEcpayTradeDate(),
      PaymentType: "aio",
      TotalAmount: ECPAY_PRO_PLAN_AMOUNT,
      TradeDesc: "SwimFlow AI Pro Upgrade",
      ItemName: "SwimFlow AI Pro Plan",
      ReturnURL: returnUrl,
      OrderResultURL: orderResultUrl,
      ChoosePayment: "Credit",
      EncryptType: 1,
      CustomField1: uid,
      CustomField2: plan,
    };

    const clientBackUrl = process.env.ECPAY_CLIENT_BACK_URL || process.env.APP_BASE_URL;
    if (clientBackUrl) {
      params.ClientBackURL = clientBackUrl;
    }

    params.CheckMacValue = generateCheckMacValue(params, config.hashKey, config.hashIv);

    await (await getAdminDb()).collection("payment_orders").doc(merchantTradeNo).set({
      uid,
      plan,
      provider: "ecpay",
      merchantTradeNo,
      amount: ECPAY_PRO_PLAN_AMOUNT,
      status: "pending",
      params,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.status(200).json({
      checkoutUrl: config.checkoutUrl,
      params,
    });
  } catch (error) {
    console.error("[ECPay Checkout] Failed to create checkout:", error);
    res.status(500).json({
      error: "ECPAY_CHECKOUT_FAILED",
      message: error instanceof Error ? error.message : "建立綠界訂單失敗。",
    });
  }
}
