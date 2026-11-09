import { expect, it } from "vitest";
import { createClient } from "../api/client";
it("encodes evidence filters and preserves an unavailable response as an error", async () => {
  let requested = "";
  const c = createClient({
    getToken: () => "",
    transport: async ({ path }) => {
      requested = path;
      return {
        status: 503,
        json: {
          error: { code: "evidence_unavailable", message: "Evidence disabled" },
        },
      };
    },
  });
  const response = await c.searchEvidence({
    q: "door & queue",
    room_id: "room-b",
    event_type: "raise",
    limit: 20,
  });
  expect(new URL(requested, "https://example.test").searchParams.get("q")).toBe(
    "door & queue",
  );
  expect(requested).toContain("/evidence/search?");
  expect(response).toMatchObject({
    ok: false,
    code: "evidence_unavailable",
    message: "Evidence disabled",
  });
});

it("labels unimplemented mock evidence instead of presenting a fake empty search", async () => {
  const { createMockTransport, MOCK_PRINCIPALS } = await import(
    "../mock/transport"
  );
  const { MockIncidentApi } = await import("../mock/store");
  const c = createClient({
    getToken: () => "mock-organizer",
    transport: createMockTransport(
      new MockIncidentApi({ principals: MOCK_PRINCIPALS }),
    ),
  });
  const result = await c.searchEvidence({ q: "overflow" });
  expect(result).toMatchObject({ ok: false, code: "evidence_unavailable" });
  if (!result.ok) expect(result.message).toContain("in-browser mock");
});
