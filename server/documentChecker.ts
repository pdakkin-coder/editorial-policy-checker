/**
 * documentChecker.ts
 * Проверяет текст документа по набору правил PolicyRule.
 * Возвращает массив PolicyViolation с офсетами, предложениями и объяснениями.
 */

import { callGemini } from "./geminiRouter.js";
import type {
  PolicyRule, PolicyViolation, CheckDocumentRequest, CheckDocumentResponse,
} from "../shared/types.js";

const SYSTEM_INSTRUCTION = `Ты — редактор. Проверь текст документа по списку правил редакционной политики.
Верни строго JSON без markdown-блоков:
{
  "violations": [
    {
      "id": "v-1",
      "ruleId": "rule-X",
      "category": "...",
      "severity": "error" | "warning" | "info",
      "start": <int — байтовый офсет начала во входном тексте>,
      "end": <int — байтовый офсет конца>,
      "matchedText": "...",
      "suggestion": "предлагаемая замена (опционально)",
      "explanation": "почему это нарушение данного правила (1-2 предложения)",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "...",
  "detectedLanguage": "ru" | "en" | "mixed"
}
Если нарушений нет — violations: [].
Офсеты должны быть точными (считать от 0 в UTF-16 / JavaScript string).`;

export async function checkDocument(
  req: CheckDocumentRequest,
  rules: PolicyRule[],
): Promise<CheckDocumentResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;

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
    temperature:     0.1,
    responseMimeType: "application/json",
  };

  try {
    const result = await callGemini(contents, generationConfig, apiKey);
    const parsed = JSON.parse(result.raw) as {
      violations: PolicyViolation[];
      summary?: string;
      detectedLanguage?: "ru" | "en" | "mixed";
    };

    return {
      violations:       (parsed.violations ?? []).map((v, i) => ({ ...v, source: "ai" as const, id: v.id ?? `v-${i}` })),
      summary:          parsed.summary,
      detectedLanguage: parsed.detectedLanguage,
      checkedAt:        new Date().toISOString(),
      model:            result.label,
      _label:           result.label,
    } as CheckDocumentResponse;
  } catch (err) {
    return {
      violations: [],
      checkedAt:  new Date().toISOString(),
      error:      err instanceof Error ? err.message : String(err),
    } as CheckDocumentResponse;
  }
}
