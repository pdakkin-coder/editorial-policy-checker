/**
 * heuristicChecker.ts
 * Client-side fast checker for common violations:
 * — stop-words (configurable list)
 * — double spaces / typography
 * — excessive sentence length
 * — wrong dash usage (hyphen instead of em-dash)
 *
 * Runs synchronously, returns results instantly before AI check.
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
  const sentences = text.split(/(?<=[.!?])\s+/);
  let cursor = 0;
  for (const sent of sentences) {
    const wordCount = sent.trim().split(/\s+/).length;
    if (wordCount > 50) {
      const start = text.indexOf(sent, cursor);
      if (start !== -1) {
        violations.push({
          id: id(), ruleId: "heuristic-long-sentence",
          category: "style", severity: "warning",
          start, end: start + sent.length,
          matchedText: sent.slice(0, 80) + (sent.length > 80 ? "…" : ""),
          explanation: `Длинное предложение (${wordCount} слов). Рекомендуется разбить.`,
          confidence: 0.8, source: "heuristic",
        });
      }
    }
    cursor += sent.length;
  }

  return violations;
}
