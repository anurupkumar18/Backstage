import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ProtocolEvent } from "../api/types";
import { incident } from "../test/incident";
import { useFloorBrief } from "./useFloorBrief";

beforeEach(() => localStorage.clear());

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it("refreshes the brief only after at least 60 seconds away and persists no incident text", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(100000);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const refresh = vi.fn(async () => {});
  const row = incident();
  const events = { [row.id]: [{ incident_id: row.id, occurred_at: new Date(120000).toISOString() } as ProtocolEvent] };
  const { result } = renderHook(() => useFloorBrief([row], events, "organizer", refresh));
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  now.mockReturnValue(159999); visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(refresh).not.toHaveBeenCalled();
  visibility.mockReturnValue("hidden");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  now.mockReturnValue(220000); visibility.mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(refresh).toHaveBeenCalledOnce();
  expect(result.current.lines).toEqual([]);
  expect(localStorage.getItem("backstage.brief.lastSeen.organizer")).toBe("159999");
});

it("still derives a brief when local storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
  const row = incident();
  const { result } = renderHook(() => useFloorBrief([row], { [row.id]: [{ incident_id: row.id, occurred_at: row.updated_at } as ProtocolEvent] }, "organizer", async () => {}));
  expect(result.current.lines[0]).toContain("Your approval is needed");
});

it("does not mark history seen while loading or denied, including the initial token-entry remount", () => {
  const { unmount } = renderHook(() => useFloorBrief([], {}, "organizer", async () => {}, false));
  unmount();
  expect(localStorage.getItem("backstage.brief.lastSeen.organizer")).toBeNull();
});
