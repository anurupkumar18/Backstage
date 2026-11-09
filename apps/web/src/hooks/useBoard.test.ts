import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { createClient } from "../api/client";
import { incident } from "../test/incident";
import { useBoard } from "./useBoard";

it("retries a failed timeline on the next poll even when its incident version did not change", async () => {
  let eventRequests = 0;
  const item = incident();
  const client = createClient({ getToken: () => "test", maxRetries: 0, transport: async (request) => {
    if (request.path.endsWith("/events")) {
      eventRequests += 1;
      if (eventRequests === 1) throw new TypeError("Offline");
      return { status: 200, json: { items: [], next_cursor: null } };
    }
    return { status: 200, json: { items: [item], next_cursor: null } };
  } });
  const announce = () => {};
  const { result } = renderHook(() => useBoard({ client, announce, pollMs: 100000 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => result.current.onTimelineOpen(item.id));
  expect(eventRequests).toBe(1);
  await act(async () => result.current.refresh());
  expect(eventRequests).toBe(2);
  await waitFor(() => expect(result.current.eventsById[item.id]).toEqual([]));
});

it("reloads same-version timelines after a temporary denied read", async () => {
  let denied = false;
  let eventRequests = 0;
  const item = incident();
  const client = createClient({ getToken: () => "test", maxRetries: 0, transport: async (request) => {
    if (request.path.endsWith("/events")) { eventRequests += 1; return { status: 200, json: { items: [], next_cursor: null } }; }
    return denied ? { status: 403, json: { error: { code: "forbidden", message: "Denied" } } }
      : { status: 200, json: { items: [item], next_cursor: null } };
  } });
  const announce = () => {};
  const { result } = renderHook(() => useBoard({ client, announce, pollMs: 100000 }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => result.current.onTimelineOpen(item.id));
  expect(eventRequests).toBe(1);
  denied = true;
  await act(async () => result.current.refresh());
  expect(result.current.eventsById).toEqual({});
  expect(result.current.incidents).toEqual([]);
  denied = false;
  await act(async () => result.current.refresh());
  expect(eventRequests).toBe(2);
  expect(result.current.eventsById[item.id]).toEqual([]);
});
