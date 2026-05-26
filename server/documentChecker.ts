/**
 * documentChecker.ts
 * Проверяет текст документа по набору правил PolicyRule.
 */

import { callGemini } from "./geminiRouter.js";
import type {
  PolicyRule, PolicyViolation, CheckDocumentRequest, CheckDocumentResponse,
} from "../shared/types.js";

const LOG = "[doc-checker]";

const SYSTEM_INSTRUCTION = `Ты — редактор. Проверь текст документа по списку правил редакционной политики.
Верни строго JSON без markdown-блоков:
{
  "violations": [
    {
      "id": "v-1",
      "ruleId": "rule-X",
      "category": "...",
      "severity": "error" | "warning" | "info",
      "start": <int>,
      "end": <int>,
      "matchedText": "...",
      "suggestion": "предлагаемая замена (опционально)",
      "explanation": "почему это нарушение (1-2 предложения)",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "...",
  "detectedLanguage": "ru" | "en" | "mixed"
}
Если нарушений нет — violations: [].`;

export async function checkDocument(
  req: CheckDocumentRequest,
  rules: PolicyRule[],
): Promise<CheckDocumentResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;

  console.info(`${LOG} starting check: ${rules.length} rules, doc ${req.documentText.length} chars`);

  const rulesText = rules
    .map((r, i) => `${i + 1}. [${r.id}] (${r.category}, ${r.severity}) ${r.name}: ${r.description}`)
    .join("\n");

  const userText =
    `${SYSTEM_INSTRUCTION}\n\n` +
    `Правила редакционной политики:\n${rulesText}\n\n` +
    `Проверяемый текст (язык: ${req.language ?? "auto"}):\n${req.documentText.slice(0, 15000)}`;

  const contents = [
    { role: "user", parts: [{ text: userText }] },
  ];
  const generationConfig = {
    temperature:      0.1,
    responseMimeType: "application/json",
  };

  try {
    const result = await callGemini(contents, generationConfig, apiKey);

    console.info(`${LOG} raw response from ${result.model} (${result.raw.length} chars):`);
    console.info(`${LOG} --- RAW START ---`);
    console.info(result.raw.slice(0, 3000));
    if (result.raw.length > 3000)
      console.info(`${LOG} ... [truncated, total ${result.raw.length} chars]`);
    console.info(`${LOG} --- RAW END ---`);

    let parsed: { violations: PolicyViolation[]; summary?: string; detectedLanguage?: "ru" | "en" | "mixed" };
    try {
      parsed = JSON.parse(result.raw) as typeof parsed;
    } catch (jsonErr) {
      console.error(`${LOG} JSON.parse FAILED:`, jsonErr instanceof Error ? jsonErr.message : jsonErr);
      console.error(`${LOG} first 500 chars of raw: ${result.raw.slice(0, 500)}`);
      throw new Error(
        `JSON parse error: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}. ` +
        `Raw (first 200): ${result.raw.slice(0, 200)}`
      );
    }

    const count = parsed.violations?.length ?? 0;
    console.info(`${LOG} parsed OK — ${count} violations, lang: ${parsed.detectedLanguage ?? "?"}`);

    return {
      violations:       (parsed.violations ?? []).map((v, i) => ({ ...v, source: "ai" as const, id: v.id ?? `v-${i}` })),
      summary:          parsed.summary,
      detectedLanguage: parsed.detectedLanguage,
      checkedAt:        new Date().toISOString(),
      model:            result.label,
      _label:           result.label,
    } as CheckDocumentResponse;
  } catch (err) {
    console.error(`${LOG} checkDocument ERROR:`, err instanceof Error ? err.message : err);
    return {
      violations: [],
      checkedAt:  new Date().toISOString(),
      error:      err instanceof Error ? err.message : String(err),
    } as CheckDocumentResponse;
  }
}
