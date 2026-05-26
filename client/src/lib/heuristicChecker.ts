/**
 * heuristicChecker.ts
 * Client-side fast checker for common violations:
 * — stop-words (configurable list)
 * — double spaces / typography
 * — excessive sentence length
 * — wrong dash usage (hyphen instead of em-dash)
 *
 * Runs synchronously, returns results instantly before AI check.
 *
 * FIX: long-sentence cursor now advances by the correct byte length
 *      (segment length + separator length), eliminating position drift.
 */

import type { PolicyViolation } from "@shared/types";

const DEFAULT_STOP_WORDS = [
  "очевидно", "безусловно", "конечно", "несомненно",
  "просто", "только лишь", "в принципе",
  "на самом деле", "по факту", "по-настоящему",
];

export function heuristicCheck(
  text: string,
  stopWords: string[] = DEFAULT_STOP_WORDS,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  let idCounter = 0;
  const id = () => `h-${idCounter++}`;

  // ── Stop words ────────────────────────────────────────────────────────────
  for (const word of stopWords) {
    const re = new RegExp(`\\b${word}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      violations.push({
        id: id(), ruleId: "heuristic-stop-word",
        category: "stop-word", severity: "warning",
        start: m.index, end: m.index + m[0].length,
        matchedText: m[0],
        suggestion: "",
        explanation: `Стоп-слово «${word}» — избегайте клише.`,
        confidence: 0.9, source: "heuristic",
      });
    }
  }

  // ── Double spaces ─────────────────────────────────────────────────────────
  const doubleSpace = /  +/g;
  let ds: RegExpExecArray | null;
  while ((ds = doubleSpace.exec(text)) !== null) {
    violations.push({
      id: id(), ruleId: "heuristic-double-space",
      category: "typography", severity: "info",
      start: ds.index, end: ds.index + ds[0].length,
      matchedText: ds[0],
      suggestion: " ",
      explanation: "Двойной пробел.",
      confidence: 1.0, source: "heuristic",
    });
  }

  // ── Long sentences (> 50 words) ───────────────────────────────────────────
  // Split while preserving the separators so we can compute exact offsets.
  // Strategy: iterate with regex to get both match positions and segment text.
  const sentenceRe = /[^.!?]+(?:[.!?]+|$)/g;
  let sm: RegExpExecArray | null;
  while ((sm = sentenceRe.exec(text)) !== null) {
    const sent = sm[0];
    const start = sm.index;
    const wordCount = sent.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 50) {
      violations.push({
        id: id(), ruleId: "heuristic-long-sentence",
        category: "style", severity: "warning",
        start,
        end: start + sent.length,
        matchedText: sent.slice(0, 80) + (sent.length > 80 ? "…" : ""),
        explanation: `Длинное предложение (${wordCount} слов). Рекомендуется разбить.`,
        confidence: 0.8, source: "heuristic",
      });
    }
  }

  // ── Wrong dash (hyphen between words instead of em-dash) ─────────────────
  const dashRe = /(?<=\S) - (?=\S)/g;
  let dm: RegExpExecArray | null;
  while ((dm = dashRe.exec(text)) !== null) {
    violations.push({
      id: id(), ruleId: "heuristic-wrong-dash",
      category: "typography", severity: "warning",
      start: dm.index + 1, // skip the leading \S
      end: dm.index + dm[0].length - 1,
      matchedText: "-",
      suggestion: "—",
      explanation: "Используйте длинное тире вместо дефиса в предложениях.",
      confidence: 0.85, source: "heuristic",
    });
  }

  return violations;
}
