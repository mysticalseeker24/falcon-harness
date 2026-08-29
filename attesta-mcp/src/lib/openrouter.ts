// Minimal OpenRouter chat client for the auditor's one judgment call. Deliberately tiny: one
// completion, low token cap, temperature 0, a hard timeout, and loud failures (CONVENTIONS §3).

// Injectable so auditFinding is unit-testable without a network/key.
export type ModelCall = (systemPrompt: string, userContent: string) => Promise<string>;

export interface OpenRouterOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export function makeOpenRouterCall(opts: OpenRouterOptions): ModelCall {
  const baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  return async (systemPrompt, userContent) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        temperature: 0,
        max_tokens: opts.maxTokens ?? 600,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
    if (!res.ok) {
      throw new Error(`auditor model call failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("auditor model returned no content");
    }
    return content;
  };
}
