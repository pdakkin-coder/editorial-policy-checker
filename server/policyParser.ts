/**
 * policyParser.ts
 * Принимает rawText редакционной политики и возвращает
 * структурированный массив PolicyRule через Gemini.
 */

import { callGemini } from "./geminiRouter.js";
import type { ParsePolicyRequest, ParsePolicyResponse, PolicyRule } from "../shared/types.js";

const LOG = "[policy-parser]";

// 20к символов ≈ 10-12 страниц — достаточно для редполитики
const MAX_CHARS = 20_000;

function buildPrompt(name: string, text: string): string {
  return `\
Ты — опытный редактор и лингвист. Проанализируй текст редакционной политики и извлеки из него правила.

ДОКУМЕНТ: «${name}»

ТЕКСТ ПОЛИТИКИ:
---
${text}
---

ВЕРНИ СТРОГО JSON (без markdown-блоков и объяснений) в формате:
{
  "rules": [
    {
      "id": "rule-1",
      "category": "stop-word",
      "name": "Краткое название правила",
      "description": "Подробное описание",
      "severity": "error",
      "examples": [{"bad": "пример нарушения", "good": "правильный вариант"}],
      "source": "ссылка на раздел"
    }
  ],
  "summary": "Краткое описание политики"
}

Категории (category):
  stop-word    — запрещённые слова/обороты
  style        — стилистика и оформление
  tone         — тональность и голос
  structure    — структура текста
  typography   — типографика и пунктуация
  abbreviation — сокращения
  factual      — фактические нормы
  custom       — прочие правила

ВАЖНО:
- ИГНОРИРУЙ метаданные PDF (format, version, page_count и т.) — работай только с содержимым текста
- Извлекай ВСЕ правила, даже неявные
- ОТВЕТ ДОЛЖЕН НАЧИНАТЬСЯ С { И ЗАКАНЧИВАТЬСЯ НА }
`;
}

/**
 * Извлекает первый JSON-объект из строки:
 * - убирает ```json ... ``` / ``` ... ``` обёртки
 * - находит первый { и последний } на случай преамбулы
 */
function extractJson(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  return s;
}

export async function parsePolicy(
  req: ParsePolicyRequest,
): Promise<ParsePolicyResponse> {
  const apiKey  = process.env.GEMINI_API_KEY!;
  const docText = req.rawText.slice(0, MAX_CHARS);

  console.info(`${LOG} starting parse «${req.name}» (${req.rawText.length} chars total, sending ${docText.length})`);

  const contents = [
    { role: "user", parts: [{ text: buildPrompt(req.name, docText) }] },
  ];

  // Не используем responseMimeType — нестабильно работает на lite-моделях
  const generationConfig = { temperature: 0.2 };

  try {
    const result = await callGemini(contents, generationConfig, apiKey);

    console.info(`${LOG} raw response from ${result.model} (${result.raw.length} chars):`);
    console.info(`${LOG} --- RAW START ---`);
    console.info(result.raw.slice(0, 3000));
    if (result.raw.length > 3000)
      console.info(`${LOG} ... [truncated, total ${result.raw.length} chars]`);
    console.info(`${LOG} --- RAW END ---`);

    const jsonStr = extractJson(result.raw);
    console.info(`${LOG} extracted JSON (${jsonStr.length} chars)`);

    let parsed: { rules: PolicyRule[]; summary?: string };
    try {
      parsed = JSON.parse(jsonStr) as { rules: PolicyRule[]; summary?: string };
    } catch (jsonErr) {
      console.error(`${LOG} JSON.parse FAILED:`, jsonErr instanceof Error ? jsonErr.message : jsonErr);
      console.error(`${LOG} first 500 chars of extracted: ${jsonStr.slice(0, 500)}`);
      throw new Error(
        `JSON parse error: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}. ` +
        `Raw (first 200): ${result.raw.slice(0, 200)}`
      );
    }

    const ruleCount = parsed.rules?.length ?? 0;
    console.info(`${LOG} parsed OK — ${ruleCount} rules, summary: ${parsed.summary?.slice(0, 80) ?? "(none)"}`);

    if (ruleCount === 0) {
      console.warn(`${LOG} WARNING: 0 rules extracted. Full parsed object:`);
      console.warn(JSON.stringify(parsed, null, 2).slice(0, 1000));
    }

    return {
      rules:   parsed.rules ?? [],
      summary: parsed.summary,
      _label:  result.label,
    };
  } catch (err) {
    console.error(`${LOG} parsePolicy ERROR:`, err instanceof Error ? err.message : err);
    return {
      rules: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
