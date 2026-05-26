/**
 * policyParser.ts
 * Принимает rawText редакционной политики и возвращает
 * структурированный массив PolicyRule через Gemini.
 */

import { callGemini } from "./geminiRouter.js";
import type { ParsePolicyRequest, ParsePolicyResponse, PolicyRule } from "../shared/types.js";

const LOG = "[policy-parser]";

const SYSTEM_INSTRUCTION = `Ты — редактор и лингвист. Твоя задача — разобрать документ редакционной политики
и вернуть строго JSON без markdown-блоков. Формат:
{
  "rules": [
    {
      "id": "rule-1",
      "category": "stop-word" | "style" | "abbreviation" | "tone" | "structure" | "typography" | "factual" | "custom",
      "name": "Краткое название",
      "description": "Подробное объяснение правила (2-4 предложения)",
      "severity": "error" | "warning" | "info",
      "examples": [{"bad": "...", "good": "..."}],
      "source": "п. X.X"
    }
  ],
  "summary": "Краткое описание политики"
}
Категории: stop-word — запрещённые слова/обороты; style — стилистика; abbreviation — сокращения;
tone — тональность; structure — структура текста; typography — типографика; factual — фактические нормы;
custom — прочие правила.`;

export async function parsePolicy(
  req: ParsePolicyRequest,
): Promise<ParsePolicyResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const userText = `Документ редакционной политики «${req.name}»:\n\n${req.rawText.slice(0, 12000)}`;

  console.info(`${LOG} starting parse «${req.name}» (${req.rawText.length} chars)`);

  const contents = [
    { role: "user", parts: [{ text: userText }] },
  ];
  const generationConfig = {
    temperature:      0.2,
    responseMimeType: "application/json",
  };

  try {
    const result = await callGemini(contents, generationConfig, apiKey);

    // ── Логирование сырого ответа ─────────────────────────────────────────
    console.info(`${LOG} raw response from ${result.model} (${result.raw.length} chars):`);
    console.info(`${LOG} --- RAW START ---`);
    console.info(result.raw.slice(0, 3000));
    if (result.raw.length > 3000)
      console.info(`${LOG} ... [truncated, total ${result.raw.length} chars]`);
    console.info(`${LOG} --- RAW END ---`);

    // ── Парсинг JSON ─────────────────────────────────────────────────────
    let parsed: { rules: PolicyRule[]; summary?: string };
    try {
      parsed = JSON.parse(result.raw) as { rules: PolicyRule[]; summary?: string };
    } catch (jsonErr) {
      console.error(`${LOG} JSON.parse FAILED:`, jsonErr instanceof Error ? jsonErr.message : jsonErr);
      console.error(`${LOG} first 500 chars of raw: ${result.raw.slice(0, 500)}`);
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
