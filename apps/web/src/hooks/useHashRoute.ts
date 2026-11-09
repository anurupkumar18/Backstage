import { useCallback, useSyncExternalStore } from "react";
import type { Route } from "../ui/types";

function parse(hash: string): Route {
  if (hash.startsWith("#/join")) return "join";
  if (hash.startsWith("#/status")) {
    return "status";
  }
  if (hash.startsWith("#/projector")) {
    return "projector";
  }
  return "board";
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(
    subscribe,
    () => parse(window.location.hash),
    () => "board" as Route,
  );
  const navigate = useCallback((next: Route) => {
    window.location.hash = next === "board" ? "#/" : `#/${next}`;
  }, []);
  return [route, navigate];
}
