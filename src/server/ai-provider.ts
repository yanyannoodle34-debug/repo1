import { decryptSecret, type EncryptedToken } from "./bot-security.js";

export type ProviderInput = {
  provider: "deepseek" | "nvidia";
  baseUrl: string;
  model: string;
  keyCiphertext: string;
  keyIv: string;
  keyAuthTag: string;
};

export type ProviderResponse = { text: string; inputTokens: number; outputTokens: number };

function endpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions") ? normalized : `${normalized}/chat/completions`;
}

export function defaultProviderConfig(provider: "deepseek" | "nvidia") {
  return provider === "deepseek"
    ? { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" }
    : { label: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", model: "meta/llama-3.1-8b-instruct" };
}

export function validateProviderUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Provider base URL must use HTTPS.");
  return url.toString().replace(/\/+$/, "");
}

export async function callCompatibleProvider(
  input: ProviderInput,
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens = 3500,
): Promise<ProviderResponse> {
  const token = decryptSecret({ ciphertext: input.keyCiphertext, iv: input.keyIv, authTag: input.keyAuthTag } as EncryptedToken);
  const response = await fetch(endpoint(input.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: input.model, messages, temperature: 0.1, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI provider rejected the request (${response.status})${detail ? `: ${detail.slice(0, 240)}` : "."}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("AI provider returned no text content.");
  return { text, inputTokens: payload.usage?.prompt_tokens ?? 0, outputTokens: payload.usage?.completion_tokens ?? 0 };
}

export function stripCodeFences(text: string) {
  return text
    .replace(/^```(?:python|javascript|typescript|js|ts)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
