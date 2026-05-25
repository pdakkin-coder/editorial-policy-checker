/**
 * useChecker.ts
 * React hook: orchestrates heuristic + AI check pipeline.
 *
 * Flow:
 *   1. heuristicCheck() → immediate violations
 *   2. POST /api/check  → AI violations
 *   3. merge (AI overrides heuristic for same span)
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

      // Merge: AI violations replace heuristic if same span overlaps
      const aiViolations = data.violations ?? [];
      const merged = mergeViolations(heuristic, aiViolations);

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

function mergeViolations(
  heuristic: PolicyViolation[],
  ai: PolicyViolation[],
): PolicyViolation[] {
  // Remove heuristic items whose span overlaps with an AI item
  const aiSpans = ai.map((v) => [v.start, v.end] as [number, number]);
  const filtered = heuristic.filter(
    (h) => !aiSpans.some(([s, e]) => h.start < e && h.end > s)
  );
  return [...filtered, ...ai].sort((a, b) => a.start - b.start);
}
