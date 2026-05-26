/**
 * geminiRouter.ts — Gemini model cascade with circuit-breaker
 *
 * Cascade order:
 *   1. gemini-2.5-flash       —  5 RPM,  20 RPD  (primary)
 *   2. gemini-3.1-flash-lite  — 15 RPM, 500 RPD  (fallback-1)
 *   3. gemini-3.5-flash       —  5 RPM,  20 RPD  (fallback-2)
 *
 * Advance cascade on: 429, 404, 503 (after retries), AbortError (timeout).
 * Retry within same model on: 503 (max 2 retries).
 * Hard-throw (no cascade): 400, 401, 500.
 */

export interface ModelMeta {
  id:    string;
  label: string;
  rpm:   number;
  rpd:   number;
}

export const MODEL_REGISTRY: ModelMeta[] = [
  { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",      rpm:  5, rpd:   20 },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", rpm: 15, rpd:  500 },
  { id: "gemini-3.5-flash",      label: "Gemini 3.5 Flash",      rpm:  5, rpd:   20 },
];

export const MODELS = MODEL_REGISTRY.map((m) => m.id) as
  [string, string, string] & string[];

export type GeminiModel = (typeof MODELS)[number];

export function modelLabel(modelId: string): string {
  return MODEL_REGISTRY.find((m) => m.id === modelId)?.label ?? modelId;
}

const API_VERSION        = "v1beta";
const FETCH_TIMEOUT_MS   = 90_000;
const RETRY_DELAYS_MS    = [2_000, 5_000] as const;
const CIRCUIT_TRIP_COUNT = 3;
const CIRCUIT_RESET_MS   = 60_000;

interface CircuitState {
  failures:     number;
  trippedUntil: number;
}

const circuitMap = new Map<string, CircuitState>();

function getCircuit(model: string): CircuitState {
  if (!circuitMap.has(model)) circuitMap.set(model, { failures: 0, trippedUntil: 0 });
  return circuitMap.get(model)!;
}

function recordSuccess(model: string): void {
  const c = getCircuit(model);
  c.failures = 0;
  c.trippedUntil = 0;
}

function recordFailure(model: string): void {
  const c = getCircuit(model);
  c.failures++;
  if (c.failures >= CIRCUIT_TRIP_COUNT) {
    c.trippedUntil = Date.now() + CIRCUIT_RESET_MS;
    console.warn(`[gemini-router] circuit OPEN for ${model} — skipping for ${CIRCUIT_RESET_MS / 1000}s`);
  }
}

function isTripped(model: string): boolean {
  const c = getCircuit(model);
  if (c.trippedUntil === 0) return false;
  if (Date.now() > c.trippedUntil) {
    c.failures = 0;
    c.trippedUntil = 0;
    console.info(`[gemini-router] circuit RESET (half-open) for ${model}`);
    return false;
  }
  return true;
}

/** True = this error means "try next model", false = hard error, rethrow. */
function isCascadable(e: Error & { status?: number }): boolean {
  // AbortError = our own timeout — advance cascade
  if (e.name === "AbortError") return true;
  // Network / DNS failure (no status at all) — advance cascade
  if (e.status === undefined) return true;
  // Quota / not found / overloaded (after retries exhausted) — advance cascade
  if (e.status === 429 || e.status === 404 || e.status === 503) return true;
  // Hard errors: bad request, auth, internal — throw immediately
  return false;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiModel(
  contents: object[],
  generationConfig: object,
  apiKey: string,
  model: string,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/${API_VERSION}/models/${model}` +
    `:generateContent?key=${apiKey}`;

  const t0  = Date.now();
  const res = await fetchWithTimeout(
    url,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ contents, generationConfig }),
    },
    FETCH_TIMEOUT_MS,
  );
  const latency = Date.now() - t0;

  if (res.ok) {
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const cleaned = raw
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();
    console.info(`[gemini-router] ${model} OK (${latency}ms, ${cleaned.length} chars)`);
    return cleaned;
  }

  const errText = (await res.text()).slice(0, 600);
  console.error(`[gemini-router] ${model} HTTP ${res.status} (${latency}ms): ${errText}`);
  const err = new Error(`Gemini [${model}] ${res.status}: ${errText}`) as Error & { status: number };
  err.status = res.status;
  throw err;
}

async function tryModel(
  contents: object[],
  generationConfig: object,
  apiKey: string,
  model: string,
): Promise<string> {
  let lastError: (Error & { status?: number }) | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    try {
      const result = await callGeminiModel(contents, generationConfig, apiKey, model);
      recordSuccess(model);
      return result;
    } catch (err) {
      const e = err as Error & { status?: number };
      // Only retry 503 — all other errors fall through immediately
      if (e.status === 503 && attempt < RETRY_DELAYS_MS.length) {
        lastError = e;
        console.warn(`[gemini-router] ${model} 503 — retry ${attempt + 1}/${RETRY_DELAYS_MS.length}`);
        continue;
      }
      recordFailure(model);
      throw e;
    }
  }

  // 503 retries exhausted — rethrow last 503 so cascade can advance
  throw lastError ?? new Error(`Gemini [${model}]: все попытки исчерпаны`);
}

export interface GeminiResult {
  raw:   string;
  model: string;
  label: string;
}

export async function callGemini(
  contents: object[],
  generationConfig: object,
  apiKey: string,
): Promise<GeminiResult> {
  for (const model of MODELS) {
    if (isTripped(model)) {
      console.warn(`[gemini-router] skipping ${model} — circuit OPEN`);
      continue;
    }

    try {
      const raw   = await tryModel(contents, generationConfig, apiKey, model);
      const label = modelLabel(model);
      console.info(`[gemini-router] cascade resolved with ${model} ("${label}")`);
      return { raw, model, label };
    } catch (err) {
      const e = err as Error & { status?: number };
      if (isCascadable(e)) {
        console.warn(
          `[gemini-router] ${model} cascadable error (status=${e.status ?? e.name}) — advancing`
        );
        recordFailure(model);
        continue;
      }
      // Hard error — do not swallow
      console.error(`[gemini-router] ${model} hard error (status=${e.status}) — throwing`);
      throw e;
    }
  }

  throw new Error(
    `Квота исчерпана на всех моделях (${MODELS.join(" → ")}). ` +
    `RPD сбрасывается в полночь UTC. ` +
    `Подождите до следующего дня или проверьте план: https://aistudio.google.com/app/plan_information`,
  );
}
