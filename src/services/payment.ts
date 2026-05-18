import { auth } from "../firebase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

type EcpayCheckoutResponse = {
  checkoutUrl: string;
  params: Record<string, string | number>;
};

export async function startEcpayCheckout(uid: string, plan: "pro") {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new Error("請先登入 Google 帳戶。");
  }

  const response = await fetch(`${API_BASE_URL}/api/payment/checkout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ uid, plan }),
  });

  const result = await response.json().catch(() => null) as EcpayCheckoutResponse | { message?: string; error?: string } | null;
  if (!response.ok || !isEcpayCheckoutResponse(result)) {
    const errorResult = result && !isEcpayCheckoutResponse(result) ? result : null;
    throw new Error(errorResult?.message || errorResult?.error || "建立綠界訂單失敗。");
  }

  submitEcpayForm(result.checkoutUrl, result.params);
}

function isEcpayCheckoutResponse(value: unknown): value is EcpayCheckoutResponse {
  return Boolean(
    value
    && typeof value === "object"
    && "checkoutUrl" in value
    && "params" in value
  );
}

function submitEcpayForm(checkoutUrl: string, params: Record<string, string | number>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = checkoutUrl;
  form.style.display = "none";

  Object.entries(params).forEach(([name, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });

  document.body.appendChild(form);
  form.submit();
}
