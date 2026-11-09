import { useCallback, useState } from "react";

const STORAGE_KEY = "backstage.tokens";

function read(): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Live-mode bearer tokens, entered at runtime and kept for the browser session only. */
export function useSessionTokens(): [Record<string, string>, (identityId: string, token: string) => void] {
  const [tokens, setTokens] = useState<Record<string, string>>(read);
  const setToken = useCallback((identityId: string, token: string) => {
    setTokens((current) => {
      const next = { ...current, [identityId]: token };
      try {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        return next;
      }
      return next;
    });
  }, []);
  return [tokens, setToken];
}
