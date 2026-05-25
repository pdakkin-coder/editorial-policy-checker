/**
 * policyParser.ts
 * Принимает rawText редакционной политики и возвращает
 * структурированный массив PolicyRule через Gemini.
 */

import { geminiGenerate } from "./geminiRouter.js";
import type { ParsePolicyRequest, ParsePolicyResponse, PolicyRule } from "../shared/types.js";

const SYSTEM = `Ты — редактор и лингвист. Твоя задача — разобрать документ редакционной политики
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
  const prompt = `Документ редакционной политики «${req.name}»:\n\n${req.rawText.slice(0, 12000)}`;

  try {
    const result = await geminiGenerate(prompt, SYSTEM);
    const parsed = JSON.parse(stripFences(result.text)) as { rules: PolicyRule[]; summary?: string };
    return {
      rules:   parsed.rules ?? [],
      summary: parsed.summary,
      _label:  result.label,
    };
  } catch (err) {
    return {
      rules: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function stripFences(s: string): string {
  return s.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
}
