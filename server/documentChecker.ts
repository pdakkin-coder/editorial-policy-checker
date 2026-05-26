/**
 * documentChecker.ts
 *
 * Проверяет текст документа по набору правил PolicyRule.
 * Дополнительно проверяет грамматику, орфографию, синтаксис и стиль,
 * опираясь на авторитетные онлайн-ресурсы и словари.
 *
 * Длинные документы обрабатываются чанками по ~12 000 символов.
 * Позиции нарушений верифицируются через indexOf.
 */

import { callGemini } from "./geminiRouter.js";
import type {
  PolicyRule, PolicyViolation, CheckDocumentRequest, CheckDocumentResponse,
} from "../shared/types.js";

const LOG = "[doc-checker]";

const CHUNK_SIZE    = 12000;
const CHUNK_OVERLAP = 600;

// ── Справочные ресурсы для проверки ──────────────────────────────────────────
const REFERENCE_RESOURCES = `
При проверке грамматики, орфографии, синтаксиса и стиля опирайся на следующие
авторитетные ресурсы (не открывай URL — используй свои знания об их нормах):

## Русский язык
- Грамотa.ру (gramota.ru) — орфография, пунктуация, справочник
- Академический орфографический словарь РАН (oross.ruslang.ru)
- Мегаэнциклопедия Кирилла и Мефодия (megabook.ru)
- НКРЯ — Национальный корпус русского языка (ruscorpora.ru)
- Справочник Розенталя по русскому языку
- ЛексисРус (lexiconrus) — стилистика
- Словарь Ушакова и Ожегова — значение слов
- Орфоэпический словарь РАН — произношение и ударения

## Английский язык
- Merriam-Webster (merriam-webster.com)
- Oxford English Dictionary (oed.com)
- Cambridge Dictionary (dictionary.cambridge.org)
- Grammarly style guide
- Chicago Manual of Style
- AP Stylebook

## Немецкий язык
- Duden (duden.de) — орфография и грамматика
- DWDS (dwds.de) — цифровой словарь немецкого языка

## Французский язык
- Académie française (academie-francaise.fr)
- Le Robert (larousse.fr)

## Общие
- Readability: Flesch-Kincaid, Gunning Fog
- APA Style (apastyle.apa.org)
- ISO 690 — библиографические ссылки
`;

const BASE_SYSTEM = `Ты — профессиональный редактор и лингвист. Проверь текст документа по двум направлениям:

## 1. Правила редакционной политики
Проверь каждое правило из списка. Найди все нарушения в тексте.

## 2. Грамматика, орфография, синтаксис, стиль
Дополнительно к правилам политики проверь:
- Орфографические ошибки (опечатки, неправильное написание слов)
- Пунктуационные ошибки (запятые, тире, кавычки)
- Грамматические ошибки (согласование, падежи, склонения)
- Синтаксические ошибки (структура предложений, порядок слов)
- Стилистические ошибки (канцеляризмы, тавтология, плеоназмы, штампы)
- Типографические ошибки (двойные пробелы, неверные кавычки, дефис вместо тире)

${REFERENCE_RESOURCES}

## Формат ответа
ВАЖНО:
- Поля "start" и "end" — символьные смещения в тексте с 0.
  text.substring(start, end) должно точно совпадать с "matchedText".
- "matchedText" — ТОЧНАЯ подстрока из исходного текста (регистр, пробелы).
- Не включай нарушения без точной позиции.
- Для грамматических/орфографических нарушений используй category: "style" или "typography",
  ruleId: "grammar", "spelling", "punctuation", "syntax" соответственно.

Верни строго JSON без markdown-блоков:
{
  "violations": [
    {
      "id": "v-1",
      "ruleId": "<id правила политики или: grammar | spelling | punctuation | syntax | style-lint>",
      "category": "stop-word | style | tone | structure | typography | abbreviation | factual | custom",
      "severity": "error | warning | info",
      "start": <int>,
      "end": <int>,
      "matchedText": "<точная подстрока из текста>",
      "suggestion": "<предлагаемая замена>",
      "explanation": "<почему нарушение, 1-2 предложения; для grammar/spelling — ссылка на норму>",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "<общий вывод о качестве текста>",
  "detectedLanguage": "ru" | "en" | "de" | "fr" | "mixed"
}
Если нарушений нет — violations: [].`;

function resolvePosition(
  text: string,
  v: PolicyViolation,
  offset: number,
): PolicyViolation | null {
  const matched = v.matchedText;
  if (!matched || matched.length === 0) return null;

  // Корректируем позицию с учётом смещения чанка
  const adjStart = (v.start ?? 0) + offset;
  const adjEnd   = (v.end   ?? 0) + offset;

  // Точное совпадение
  if (
    adjStart >= 0 &&
    adjEnd <= text.length &&
    adjEnd - adjStart === matched.length &&
    text.substring(adjStart, adjEnd) === matched
  ) {
    return { ...v, start: adjStart, end: adjEnd };
  }

  // Поиск в окрестности (±600)
  const searchFrom = Math.max(0, adjStart - 600);
  const idx = text.indexOf(matched, searchFrom);
  if (idx !== -1) return { ...v, start: idx, end: idx + matched.length };

  // Полный поиск (fallback)
  const idxFull = text.indexOf(matched);
  if (idxFull !== -1) return { ...v, start: idxFull, end: idxFull + matched.length };

  console.warn(`${LOG} drop v id=${v.id}: matchedText not found`);
  return null;
}

function splitIntoChunks(text: string): { text: string; offset: number }[] {
  if (text.length <= CHUNK_SIZE) return [{ text, offset: 0 }];

  const chunks: { text: string; offset: number }[] = [];
  let pos = 0;

  while (pos < text.length) {
    let end = pos + CHUNK_SIZE;
    if (end >= text.length) {
      chunks.push({ text: text.slice(pos), offset: pos });
      break;
    }
    const boundary = text.lastIndexOf("\n\n", end);
    if (boundary > pos + CHUNK_SIZE / 2) end = boundary + 2;
    chunks.push({ text: text.slice(pos, end), offset: pos });
    pos = Math.max(pos + 1, end - CHUNK_OVERLAP);
  }

  return chunks;
}

/** Убирает дубликаты нарушений (одинаковый matchedText + ruleId из перекрытий чанков) */
function deduplicateViolations(violations: PolicyViolation[]): PolicyViolation[] {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.ruleId}::${v.matchedText}::${v.start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function checkDocument(
  req: CheckDocumentRequest,
  rules: PolicyRule[],
): Promise<CheckDocumentResponse> {
  const apiKey = process.env.GEMINI_API_KEY!;
  console.info(`${LOG} check: ${rules.length} rules, doc ${req.documentText.length} chars`);

  const rulesText = rules
    .map((r, i) => `${i + 1}. [${r.id}] (${r.category}, ${r.severity}) ${r.name}: ${r.description}`)
    .join("\n");

  const chunks = splitIntoChunks(req.documentText);
  console.info(`${LOG} split into ${chunks.length} chunk(s)`);

  const allViolations: PolicyViolation[] = [];
  let finalSummary   = "";
  let detectedLang: string | undefined;
  let labelUsed      = "";

  for (let i = 0; i < chunks.length; i++) {
    const { text: chunkText, offset } = chunks[i];
    const chunkNote = chunks.length > 1
      ? `\n\n[ФРАГМЕНТ ${i + 1}/${chunks.length}, смещение начала: ${offset} символов]`
      : "";

    const userText =
      `${BASE_SYSTEM}\n\n` +
      `Правила редакционной политики:\n${rulesText}\n\n` +
      `Проверяемый текст (язык: ${req.language ?? "auto"}${chunkNote}, позиции считаются от 0 внутри этого фрагмента):\n` +
      `<<<TEXT_START>>>\n${chunkText}\n<<<TEXT_END>>>`;

    console.info(`${LOG} chunk ${i + 1}/${chunks.length} offset=${offset} len=${chunkText.length}`);

    try {
      const result = await callGemini(
        [{ role: "user", parts: [{ text: userText }] }],
        { temperature: 0.1, responseMimeType: "application/json" },
        apiKey,
      );

      labelUsed = result.label;
      console.info(`${LOG} chunk ${i + 1} raw (${result.raw.length} chars)`);

      const parsed = JSON.parse(result.raw) as {
        violations: PolicyViolation[];
        summary?: string;
        detectedLanguage?: string;
      };

      const raw = (parsed.violations ?? []).map((v, j) => ({
        ...v,
        source: "ai" as const,
        id: v.id ?? `v-${i}-${j}`,
      }));

      // Верифицируем позиции (с учётом offset чанка)
      let corrected = 0; let dropped = 0;
      for (const v of raw) {
        const fixed = resolvePosition(req.documentText, v, offset);
        if (fixed) {
          if (fixed.start !== (v.start ?? 0) + offset) corrected++;
          allViolations.push(fixed);
        } else {
          dropped++;
        }
      }
      console.info(`${LOG} chunk ${i + 1}: ${raw.length} raw, ${corrected} corrected, ${dropped} dropped`);

      if (i === 0) {
        finalSummary = parsed.summary ?? "";
        detectedLang = parsed.detectedLanguage;
      }
    } catch (err) {
      console.error(`${LOG} chunk ${i + 1} ERROR:`, err instanceof Error ? err.message : err);
    }
  }

  const deduped = deduplicateViolations(allViolations);
  console.info(`${LOG} total violations: ${allViolations.length} → after dedup: ${deduped.length}`);

  return {
    violations:       deduped,
    summary:          finalSummary,
    detectedLanguage: detectedLang as "ru" | "en" | "mixed" | undefined,
    checkedAt:        new Date().toISOString(),
    model:            labelUsed,
    _label:           labelUsed,
  } as CheckDocumentResponse;
}
