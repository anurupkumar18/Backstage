import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../api/client";
import { useInbox } from "../hooks/useInbox";
import { MockIncidentApi } from "../mock/store";
import { createMockTransport, DEMO_IDENTITIES, MOCK_PRINCIPALS } from "../mock/transport";
import { InboxView } from "../ui/InboxView";
import App from "../App";

const announce = () => {};

function harness(api: MockIncidentApi) {
  const identity = DEMO_IDENTITIES[0]!;
  const client = createClient({ transport: createMockTransport(api), getToken: () => identity.token });
  function Inbox() {
    const inbox = useInbox(client, identity, announce);
    return <InboxView {...inbox} identity={identity} onAction={(incident, action) => void inbox.run(incident, action)} onMarkSeen={inbox.markSeen} />;
  }
  return render(<Inbox />);
}

afterEach(() => { window.location.hash = ""; window.localStorage.clear(); vi.restoreAllMocks(); });

describe("inbox actions", () => {
  it("approves with the keyboard through the real client and mock lifecycle", async () => {
    const user = userEvent.setup();
    const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS, dispatchDelayMs: 0 });
    try {
      harness(api);
      const approve = await screen.findByRole("button", { name: /Approve plan for Room 255 BC/ });
      await user.tab();
      await user.tab();
      expect(approve).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.queryByRole("button", { name: /Approve plan/ })).not.toBeInTheDocument());
      expect(screen.getByRole("article")).toHaveFocus();
      expect(screen.queryByText("Verified")).not.toBeInTheDocument();
    } finally { api.reset(); }
  });

  it("refreshes a stale 409 and requires a fresh human action", async () => {
    const user = userEvent.setup();
    const api = new MockIncidentApi({ principals: MOCK_PRINCIPALS });
    try {
      harness(api);
      const approve = await screen.findByRole("button", { name: /Approve plan for Room 255 BC/ });
      api.bumpVersion();
      await user.click(approve);
      expect(await screen.findByRole("alert")).toHaveTextContent("The board has been refreshed");
      await waitFor(() => expect(approve).toBeEnabled());
      expect(approve).toBeInTheDocument();
      expect(screen.getByText(/Plan proposed/)).toBeInTheDocument();
    } finally { api.reset(); }
  });

  it("removes organizer data on a role switch and never fetches attendee incidents", async () => {
    const user = userEvent.setup();
    const calls = vi.spyOn(MockIncidentApi.prototype, "handle");
    window.location.hash = "#/me";
    render(<App />);
    await screen.findByRole("button", { name: /Approve plan for Room 255 BC/ });
    calls.mockClear();
    await user.click(screen.getByRole("button", { name: "Attendee, tier 0" }));
    expect(await screen.findByRole("heading", { name: "Room status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve plan/ })).not.toBeInTheDocument();
    await screen.findByText("Affected");
    expect(calls.mock.calls.some(([request]) => request.headers.Authorization === "Bearer mock-attendee" && request.path.startsWith("/incidents"))).toBe(false);
  });
});
