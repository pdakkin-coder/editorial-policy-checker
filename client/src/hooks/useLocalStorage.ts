import { useCallback, useEffect, useRef, useState } from "react";

// ── Safe localStorage accessor ────────────────────────────────────────────────
// In some environments (Safari ITP, sandboxed iframes, private mode)
// ANY access to localStorage — even reading — throws a SecurityError
// before try/catch can intercept it. We probe once at module load time.
let _storageAvailable: boolean | null = null;
function isStorageAvailable(): boolean {
  if (_storageAvailable !== null) return _storageAvailable;
  try {
    const probe = "__epc_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    _storageAvailable = true;
  } catch {
    _storageAvailable = false;
  }
  return _storageAvailable;
}

function lsGet(key: string): string | null {
  if (!isStorageAvailable()) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key: string, value: string): void {
  if (!isStorageAvailable()) return;
  try { localStorage.setItem(key, value); } catch {}
}
function lsRemove(key: string): void {
  if (!isStorageAvailable()) return;
  try { localStorage.removeItem(key); } catch {}
}
function lsKeys(): string[] {
  if (!isStorageAvailable()) return [];
  try { return Object.keys(localStorage); } catch { return []; }
}

/**
 * Drop-in replacement for useState that persists to localStorage.
 * Writes are debounced (default 600 ms) to avoid hammering storage on
 * every keystroke (e.g. RichEditor onChange).
 *
 * Gracefully degrades to plain useState when localStorage is unavailable
 * (private mode, sandboxed iframe, Safari ITP) — the app still works,
 * just without persistence.
 *
 * @param key      - localStorage key
 * @param initial  - initial / fallback value when key is absent or unparseable
 * @param debounce - write debounce in ms (pass 0 for synchronous writes)
 */
export function useLocalStorage<T>(
  key: string,
  initial: T,
  debounce = 600,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [state, setStateRaw] = useState<T>(() => {
    const raw = lsGet(key);
    if (raw === null) return initial;
    try { return JSON.parse(raw) as T; } catch { return initial; }
  });

  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T>(state);

  const persist = useCallback(
    (value: T) => {
      if (timer.current) clearTimeout(timer.current);
      if (debounce === 0) {
        lsSet(key, JSON.stringify(value));
      } else {
        timer.current = setTimeout(() => {
          lsSet(key, JSON.stringify(value));
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
    lsRemove(key);
    setStateRaw(initial);
    latest.current = initial;
  }, [key, initial]);

  // Persist initial value on first mount if nothing was stored yet
  useEffect(() => {
    if (lsGet(key) === null) {
      lsSet(key, JSON.stringify(initial));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return [state, setState, clear];
}

/** Clears all keys that start with a given prefix. */
export function clearStorageByPrefix(prefix: string): void {
  const keys = lsKeys().filter((k) => k.startsWith(prefix));
  keys.forEach((k) => lsRemove(k));
}
