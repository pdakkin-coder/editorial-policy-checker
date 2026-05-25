/**
 * Gemini Cascade Router
 * Ported from citadex refactor/gemini-router.
 *
 * Cascade order:
 *   1. gemini-2.5-flash   (primary)
 *   2. gemini-1.5-flash   (fallback on 429)
 *   3. gemini-1.5-flash-8b (fallback on repeated 429)
 *
 * Retry logic:
 *   - 429 Too Many Requests  → next model
 *   - 503 / network error    → retry same model (delays: 1500 ms, 4000 ms)
 *   - other HTTP error       → throw immediately
 */

import { GoogleGenerativeAI, type GenerateContentResult } from "@google/generative-ai";

const MODELS = [
  { name: "gemini-2.5-flash",    label: "Gemini 2.5 Flash",     rpmLimit: 5  },
  { name: "gemini-1.5-flash",    label: "Gemini 1.5 Flash",     rpmLimit: 5  },
  { name: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B", rpmLimit: 15 },
] as const;

const TIMEOUT_MS = 90_000;
const RETRY_DELAYS = [1500, 4000];

export interface GeminiRouterResult {
  text: string;
  model: string;
  label: string;
  retries: number;
}

export async function geminiGenerate(
  prompt: string,
  systemInstruction?: string,
): Promise<GeminiRouterResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY не задан в переменных окружения");

  let totalRetries = 0;

  for (const model of MODELS) {
    let attempt = 0;
    while (attempt <= RETRY_DELAYS.length) {
      try {
        const genAI  = new GoogleGenerativeAI(apiKey);
        const client = genAI.getGenerativeModel({
          model: model.name,
          ...(systemInstruction ? { systemInstruction } : {}),
        });

        const raceResult = await Promise.race<GenerateContentResult>([
          client.generateContent(prompt),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
          ) as Promise<never>,
        ]);

        return {
          text:    raceResult.response.text(),
          model:   model.name,
          label:   model.label,
          retries: totalRetries,
        };
      } catch (err: unknown) {
        const msg    = err instanceof Error ? err.message : String(err);
        const status = extractStatus(msg);

        if (status === 429) {
          // rate-limited → try next model
          totalRetries++;
          break;
        }

        if (status === 503 || msg.includes("Timeout") || msg.includes("network")) {
          // transient → retry same model
          if (attempt < RETRY_DELAYS.length) {
            await sleep(RETRY_DELAYS[attempt]);
            attempt++;
            totalRetries++;
            continue;
          }
          break; // give up on this model
        }

        throw err; // hard error — propagate
      }
    }
  }

  throw new Error("Все модели Gemini недоступны. Проверьте GEMINI_API_KEY и квоты.");
}

function extractStatus(msg: string): number | null {
  const m = msg.match(/\b(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
