/**
 * useChecker.ts
 * React hook: orchestrates heuristic + AI check pipeline.
 *
 * Flow:
 *   1. heuristicCheck() → immediate violations
 *   2. POST /api/check  → AI violations (positions already verified server-side)
 *   3. merge: AI overrides heuristic for same span; client-side guard added
 *
 * FIX: mergeViolations теперь также отфильтровывает нарушения
 *      с невалидными позициями (start < 0, end > textLength, start >= end)
 *      перед рендером, чтобы сегментатор в Workbench не падал.
 */

import { useState, useCallback } from "react";
import type { PolicyViolation, CheckResult } from "@shared/types";
import { heuristicCheck } from "../lib/heuristicChecker";
import { apiRequest } from "../lib/queryClient";

export interface UseCheckerState {
  violations: PolicyViolation[];
  loading: boolean;
  error: string | null;
  result: CheckResult | null;
  activeModel: string | null;
}

export function useChecker() {
  const [state, setState] = useState<UseCheckerState>({
    violations: [], loading: false, error: null, result: null, activeModel: null,
  });

  const check = useCallback(async (documentText: string, policyId: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));

    // Step 1: immediate heuristic results
    const heuristic = heuristicCheck(documentText);
    setState((s) => ({ ...s, violations: heuristic }));

    // Step 2: AI check
    try {
      const res  = await apiRequest("POST", "/api/check", { documentText, policyId });
      const data = await res.json() as CheckResult & { error?: string; _label?: string };

      if (!res.ok || data.error) {
        setState((s) => ({ ...s, loading: false, error: data.error ?? `HTTP ${res.status}` }));
        return;
      }

      const aiViolations = data.violations ?? [];
      const merged = mergeViolations(heuristic, aiViolations, documentText.length);

      setState({
        violations: merged,
        loading:    false,
        error:      null,
        result:     data,
        activeModel: data._label ?? data.model ?? null,
      });
    } catch (err) {
      setState((s) => ({
        ...s, loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({ violations: [], loading: false, error: null, result: null, activeModel: null });
  }, []);

  return { ...state, check, reset };
}

/** Гарантирует, что позиции нарушения находятся в пределах текста. */
function isValidViolation(v: PolicyViolation, textLen: number): boolean {
  return (
    typeof v.start === "number" &&
    typeof v.end   === "number" &&
    v.start >= 0 &&
    v.end   <= textLen &&
    v.start <  v.end
  );
}

function mergeViolations(
  heuristic: PolicyViolation[],
  ai: PolicyViolation[],
  textLen: number,
): PolicyViolation[] {
  // Отфильтровываем невалидные позиции с обеих сторон
  const validH = heuristic.filter((v) => isValidViolation(v, textLen));
  const validA = ai.filter((v) => isValidViolation(v, textLen));

  // AI-нарушения вытесняют эвристику при перекрытии спанов
  const aiSpans = validA.map((v) => [v.start, v.end] as [number, number]);
  const filteredH = validH.filter(
    (h) => !aiSpans.some(([s, e]) => h.start < e && h.end > s)
  );

  return [...filteredH, ...validA].sort((a, b) => a.start - b.start);
}
