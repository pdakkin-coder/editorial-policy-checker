/**
 * useChecker.ts
 * React hook: orchestrates heuristic + AI check pipeline.
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

    const heuristic = heuristicCheck(documentText);
    setState((s) => ({ ...s, violations: heuristic }));

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

  /** Directly overwrite violations (e.g. restore from localStorage on mount). */
  const setViolations = useCallback((violations: PolicyViolation[]) => {
    setState((s) => ({ ...s, violations }));
  }, []);

  return { ...state, check, reset, setViolations };
}

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
  const validH = heuristic.filter((v) => isValidViolation(v, textLen));
  const validA = ai.filter((v) => isValidViolation(v, textLen));

  const aiSpans = validA.map((v) => [v.start, v.end] as [number, number]);
  const filteredH = validH.filter(
    (h) => !aiSpans.some(([s, e]) => h.start < e && h.end > s)
  );

  const combined = [...filteredH, ...validA].sort((a, b) => a.start - b.start);

  const seenPos = new Set<string>();
  const deduped: PolicyViolation[] = [];

  for (const v of combined) {
    const posKey = `${v.start}:${v.end}`;
    if (seenPos.has(posKey)) continue;
    seenPos.add(posKey);
    deduped.push(v);
  }

  return deduped;
}
