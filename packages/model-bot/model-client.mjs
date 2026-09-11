// Minimal client for an OpenAI-compatible chat endpoint. Configured entirely from the environment
// so no gateway address or key ever lands in this repository.
//
//   MODEL_BASE_URL   e.g. https://your-gateway.example/v1
//   MODEL_API_KEY
//   MODEL_NAME       e.g. the model id your gateway exposes

export class ModelClient {
    #baseUrl; #apiKey; #name; #timeoutMs;
    calls = 0; promptTokens = 0; completionTokens = 0; failures = 0; totalLatencyMs = 0;
    #warned = false;

    constructor({ baseUrl, apiKey, name, timeoutMs = 120000 } = {}) {
        this.#baseUrl = (baseUrl ?? process.env.MODEL_BASE_URL ?? "").replace(/\/$/, "");
        this.#apiKey = apiKey ?? process.env.MODEL_API_KEY ?? "";
        this.#name = name ?? process.env.MODEL_NAME ?? "";
        this.#timeoutMs = timeoutMs;
        if (!this.#baseUrl || !this.#apiKey || !this.#name) {
            throw new Error("set MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME");
        }
    }

    get name() { return this.#name; }

    /** Returns the assistant's text, or null if the call failed. Never throws: a match should
     *  survive a flaky call, and a missed decision is recorded rather than fatal. */
    async ask(system, user, { maxTokens = 900 } = {}) {
        const started = Date.now();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.#timeoutMs);
        try {
            const res = await fetch(`${this.#baseUrl}/chat/completions`, {
                method: "POST",
                signal: ctl.signal,
                headers: { "content-type": "application/json", authorization: `Bearer ${this.#apiKey}` },
                body: JSON.stringify({
                    model: this.#name,
                    messages: [{ role: "system", content: system }, { role: "user", content: user }],
                    max_tokens: maxTokens,
                }),
            });
            if (!res.ok) {
                this.failures++;
                // A swallowed status reads exactly like a model that keeps answering badly, and has
                // already cost this project several wrong conclusions. Say it once per client.
                if (!this.#warned) {
                    this.#warned = true;
                    const body = await res.text().catch(() => "");
                    console.error(`  ${this.#name}: HTTP ${res.status} from ${this.#baseUrl} -- ${body.slice(0, 200)}`);
                }
                return null;
            }
            const body = await res.json();
            this.calls++;
            this.totalLatencyMs += Date.now() - started;
            this.promptTokens += body.usage?.prompt_tokens ?? 0;
            this.completionTokens += body.usage?.completion_tokens ?? 0;
            return body.choices?.[0]?.message?.content ?? null;
        } catch {
            this.failures++;
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    stats() {
        return {
            model: this.#name, calls: this.calls, failures: this.failures,
            promptTokens: this.promptTokens, completionTokens: this.completionTokens,
            avgLatencyMs: this.calls ? Math.round(this.totalLatencyMs / this.calls) : 0,
        };
    }
}

/** Models wrap JSON in prose or code fences often enough that this is worth doing properly. */
export function extractJson(text) {
    if (!text) return null;
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < candidate.length; i++) {
        const c = candidate[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === "\\") esc = true;
            else if (c === '"') inStr = false;
        } else if (c === '"') inStr = true;
        else if (c === "{") depth++;
        else if (c === "}" && --depth === 0) {
            try { return JSON.parse(candidate.slice(start, i + 1)); } catch { return null; }
        }
    }
    return null;
}
