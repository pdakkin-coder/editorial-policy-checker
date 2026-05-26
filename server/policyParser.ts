/**
 * policyParser.ts
 *
 * Извлекает ВСЕ правила из документа редакционной политики.
 * Если документ длинный — делит его на чанки по ~6000 символов
 * и обрабатывает каждый чанк отдельным запросом к модели,
 * затем дедуплицирует правила по имени/описанию.
 */

import { callGemini } from "./geminiRouter.js";
import type { ParsePolicyRequest, ParsePolicyResponse, PolicyRule } from "../shared/types.js";

const LOG = "[policy-parser]";

// Максимальный размер одного чанка (символов)
const CHUNK_SIZE = 6000;
// Перекрытие между чанками чтобы не потерять правила на границах
const CHUNK_OVERLAP = 400;

function buildPrompt(name: string, chunkText: string, chunkIndex: number, totalChunks: number): string {
  const chunkNote = totalChunks > 1
    ? `(ФРАГМЕНТ ${chunkIndex + 1} из ${totalChunks} — обрабатывай ТОЛЬКО этот фрагмент)`
    : "(полный документ)";

  return (
    `Ты — опытный редактор и лингвист. Твоя задача — извлечь ВСЕ правила из фрагмента документа редакционной политики.\n\n` +
    `НАЗВАНИЕ ДОКУМЕНТА: ${name} ${chunkNote}\n\n` +
    `ТЕКСТ ФРАГМЕНТА:\n===BEGIN===\n${chunkText}\n===END===\n\n` +
    `ЗАДАЧА:\n` +
    `Проанализируй каждый раздел фрагмента и извлеки из него редакционные правила.\n` +
    `Правило — это любое требование к текстам: запрещённые слова, стилистика, тон,\n` +
    `типографика, структура материала, требования к заголовкам, абзацам, ссылкам,\n` +
    `изображениям, цитированию, оформлению списков, таблиц, сносок и т.д.\n\n` +
    `ВЕРНИ ТОЛЬКО JSON (без code-блоков, без объяснений до или после).\n` +
    `Формат ответа:\n` +
    `{\n` +
    `  "rules": [\n` +
    `    {\n` +
    `      "id": "rule-${chunkIndex}-1",\n` +
    `      "category": "<одно из: stop-word | style | tone | structure | typography | abbreviation | factual | custom>",\n` +
    `      "name": "<краткое название правила>",\n` +
    `      "description": "<подробное описание 2-4 предложения>",\n` +
    `      "severity": "<одно из: error | warning | info>",\n` +
    `      "examples": [\n` +
    `        { "bad": "<пример нарушения>", "good": "<правильный вариант>" }\n` +
    `      ],\n` +
    `      "source": "<ссылка на раздел документа или пустая строка>"\n` +
    `    }\n` +
    `  ],\n` +
    `  "summary": "<только для первого фрагмента: 2-3 предложения о документе; для остальных — пустая строка>"\n` +
    `}\n\n` +
    `ВАЖНО:\n` +
    `1. Ответ ДОЛЖЕН начинаться с { и заканчиваться на } — ничего лишнего\n` +
    `2. Игнорируй PDF-метаданные (format, version, page_count, producer и т.п.)\n` +
    `3. Если в разделе нет явных правил — сформулируй их из смысла текста\n` +
    `4. НЕ ОСТАНАВЛИВАЙСЯ посередине — обработай весь фрагмент до конца\n` +
    `5. Каждое отдельное требование = отдельное правило; не объединяй несвязанные требования\n`
  );
}

function buildSummaryPrompt(name: string, allRules: PolicyRule[]): string {
  return (
    `Ты — редактор. Вот ${allRules.length} правил, извлечённых из документа редакционной политики «${name}».\n` +
    `Напиши краткое резюме документа (2-3 предложения): о чём эта политика и для каких текстов предназначена.\n` +
    `Верни ТОЛЬКО JSON: { "summary": "..." }\n`
  );
}

function extractJson(raw: string): string {
  let s = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  const start = s.indexOf("{");
  const end   = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return s;
}

/** Разбивает текст на чанки с перекрытием по границам абзацев */
function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = pos + CHUNK_SIZE;
    if (end >= text.length) {
      chunks.push(text.slice(pos));
      break;
    }
    // Ищем конец абзаца (\n\n) назад от end
    const boundary = text.lastIndexOf("\n\n", end);
    if (boundary > pos + CHUNK_SIZE / 2) {
      end = boundary + 2;
    }
    chunks.push(text.slice(pos, end));
    pos = Math.max(pos + 1, end - CHUNK_OVERLAP);
  }

  return chunks;
}

/** Дедуплицирует правила: удаляет дубли по нормализованному имени */
function deduplicateRules(rules: PolicyRule[]): PolicyRule[] {
  const seen = new Set<string>();
  const result: PolicyRule[] = [];
  for (const r of rules) {
    const key = (r.name + " " + r.description).toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(r);
    }
  }
  return result;
}

export async function parsePolicy(
  req: ParsePolicyRequest,
): Promise<ParsePolicyResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const docText = req.rawText;
  console.info(`${LOG} starting parse «${req.name}» (${docText.length} chars)`);

  const chunks = splitIntoChunks(docText);
  console.info(`${LOG} split into ${chunks.length} chunk(s)`);

  const allRules: PolicyRule[] = [];
  let firstSummary = "";

  for (let i = 0; i < chunks.length; i++) {
    const prompt = buildPrompt(req.name, chunks[i], i, chunks.length);
    console.info(`${LOG} chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)`);

    try {
      const result = await callGemini(
        [{ role: "user", parts: [{ text: prompt }] }],
        { temperature: 0.1 },
        apiKey,
      );

      console.info(`${LOG} chunk ${i + 1} raw (${result.raw.length} chars): ${result.raw.slice(0, 300)}`);

      const jsonStr = extractJson(result.raw);
      const parsed = JSON.parse(jsonStr) as { rules: PolicyRule[]; summary?: string };

      const chunkRules = (parsed.rules ?? []).map((r, j) => ({
        ...r,
        id: `rule-${i}-${j + 1}`,
      }));

      console.info(`${LOG} chunk ${i + 1}: extracted ${chunkRules.length} rules`);
      allRules.push(...chunkRules);

      if (i === 0 && parsed.summary) firstSummary = parsed.summary;
    } catch (err) {
      console.error(`${LOG} chunk ${i + 1} FAILED:`, err instanceof Error ? err.message : err);
      // Продолжаем с остальными чанками
    }
  }

  const deduped = deduplicateRules(allRules);
  console.info(`${LOG} total rules before dedup: ${allRules.length}, after: ${deduped.length}`);

  // Если summary не получен из первого чанка — запрашиваем отдельно
  let summary = firstSummary;
  if (!summary && deduped.length > 0) {
    try {
      const sumResult = await callGemini(
        [{ role: "user", parts: [{ text: buildSummaryPrompt(req.name, deduped) }] }],
        { temperature: 0.1 },
        apiKey,
      );
      const sumJson = extractJson(sumResult.raw);
      const sumParsed = JSON.parse(sumJson) as { summary?: string };
      summary = sumParsed.summary ?? "";
    } catch (_) {}
  }

  if (deduped.length === 0) {
    return { rules: [], summary, error: "Не удалось извлечь правила из документа." };
  }

  return { rules: deduped, summary };
}
