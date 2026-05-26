/**
 * documentChecker.ts
 * Проверяет текст документа по набору правил PolicyRule.
 *
 * FIX: после получения ответа от Gemini все позиции (start/end) верифицируются
 *      через text.indexOf(matchedText) — если AI вернул неверный офсет,
 *      он корректируется по фактическому вхождению строки в исходный текст.
 *      Нарушения без верифицируемого matchedText отбрасываются.
 */

import { callGemini } from "./geminiRouter.js";
import type {
  PolicyRule, PolicyViolation, CheckDocumentRequest, CheckDocumentResponse,
} from "../shared/types.js";

const LOG = "[doc-checker]";

const SYSTEM_INSTRUCTION = `Ты — редактор. Проверь текст документа по списку правил редакционной политики.

ВАЖНО:
- Поля "start" и "end" — это БАЙТОВЫЕ (символьные) смещения в проверяемом тексте,
  считая с 0. text.substring(start, end) должно точно совпадать с "matchedText".
- "matchedText" должен быть ТОЧНОЙ подстрокой из исходного текста (регистр, пробелы).
- Не включай нарушения, если не можешь точно указать позицию.

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

/**
 * Верифицирует и корректирует позиции нарушения:
 * 1. Проверяет text.substring(start, end) === matchedText
 * 2. Если нет — ищет matchedText через indexOf начиная с max(0, start-200)
 * 3. Если не найдено — возвращает null (нарушение отбрасывается)
 */
function resolvePosition(
  text: string,
  v: PolicyViolation,
): PolicyViolation | null {
  const matched = v.matchedText;
  if (!matched || matched.length === 0) return null;

  // Case 1: позиция верная
  if (
    typeof v.start === "number" &&
    typeof v.end === "number" &&
    v.start >= 0 &&
    v.end <= text.length &&
    v.end - v.start === matched.length &&
    text.substring(v.start, v.end) === matched
  ) {
    return v;
  }

  // Case 2: поиск в окрестности заявленной позиции (±500 символов)
  const searchFrom = Math.max(0, (v.start ?? 0) - 500);
  const idx = text.indexOf(matched, searchFrom);
  if (idx !== -1) {
    return { ...v, start: idx, end: idx + matched.length };
  }

  // Case 3: поиск по всему тексту (fallback)
  const idxFull = text.indexOf(matched);
  if (idxFull !== -1) {
    return { ...v, start: idxFull, end: idxFull + matched.length };
  }

  // Не найдено — отбрасываем
  console.warn(`${LOG} drop violation id=${v.id}: matchedText not found in document`);
  return null;
}

export async function checkDocument(
  req: CheckDocumentRequest,
  rules: PolicyRule[],
): Promise<CheckDocumentResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;

  console.info(`${LOG} starting check: ${rules.length} rules, doc ${req.documentText.length} chars`);

  const rulesText = rules
    .map((r, i) => `${i + 1}. [${r.id}] (${r.category}, ${r.severity}) ${r.name}: ${r.description}`)
    .join("\n");

  const docSlice = req.documentText.slice(0, 15000);

  const userText =
    `${SYSTEM_INSTRUCTION}\n\n` +
    `Правила редакционной политики:\n${rulesText}\n\n` +
    `Проверяемый текст (язык: ${req.language ?? "auto"}, начало с символа 0):\n` +
    `<<<TEXT_START>>>\n${docSlice}\n<<<TEXT_END>>>`;

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

    const raw = (parsed.violations ?? []).map((v, i) => ({ ...v, source: "ai" as const, id: v.id ?? `v-${i}` }));

    // ── Верификация позиций ─────────────────────────────────────────────────
    const verified: PolicyViolation[] = [];
    let corrected = 0;
    let dropped = 0;
    for (const v of raw) {
      const fixed = resolvePosition(req.documentText, v);
      if (fixed) {
        if (fixed.start !== v.start || fixed.end !== v.end) corrected++;
        verified.push(fixed);
      } else {
        dropped++;
      }
    }
    console.info(`${LOG} position verify: ${verified.length} OK, ${corrected} corrected, ${dropped} dropped`);

    return {
      violations:       verified,
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
