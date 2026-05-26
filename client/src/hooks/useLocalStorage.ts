import { useCallback, useState } from "react";

/**
 * In-memory state hook with the same API as the old useLocalStorage.
 * localStorage is NOT used because the app runs inside a sandboxed iframe
 * where storage access is blocked and throws on initialisation, crashing
 * the React tree before any component renders.
 *
 * All state is held in JS memory and is reset on page reload — which is
 * acceptable for the editing session model of this application.
 */
export function useLocalStorage<T>(
  _key: string,
  initial: T,
  _debounce = 600,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [state, setStateRaw] = useState<T>(initial);

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw((prev) =>
        typeof value === "function" ? (value as (p: T) => T)(prev) : value,
      );
    },
    [],
  );

  const clear = useCallback(() => {
    setStateRaw(initial);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [state, setState, clear];
}

/** No-op: nothing to clear in memory. */
export function clearStorageByPrefix(_prefix: string): void {}
