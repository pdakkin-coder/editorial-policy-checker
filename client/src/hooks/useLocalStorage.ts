import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drop-in replacement for useState that persists to localStorage.
 * Writes are debounced (default 600ms) to avoid hammering storage on
 * every keystroke (e.g. RichEditor onChange).
 *
 * @param key     - localStorage key
 * @param initial - initial / fallback value when key is absent or unparseable
 * @param debounce - write debounce in ms (pass 0 for synchronous writes)
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
  debounce = 600,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T>(state);

  const persist = useCallback(
    (value: T) => {
      if (timer.current) clearTimeout(timer.current);
      if (debounce === 0) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      } else {
        timer.current = setTimeout(() => {
          try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
        }, debounce);
      }
    },
    [key, debounce],
  );

  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw((prev) => {
        const next = typeof value === "function"
          ? (value as (p: T) => T)(prev)
          : value;
        latest.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    try { localStorage.removeItem(key); } catch {}
    setStateRaw(initial);
    latest.current = initial;
  }, [key, initial]);

  // Persist initial value on first mount if nothing was stored
  useEffect(() => {
    try {
      if (localStorage.getItem(key) === null) {
        localStorage.setItem(key, JSON.stringify(initial));
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [state, setState, clear];
}

/** Clears all keys that start with a given prefix. */
export function clearStorageByPrefix(prefix: string): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}
