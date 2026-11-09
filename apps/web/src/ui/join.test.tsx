import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { JoinPage } from "./JoinPage";
import { PresenceSimulator } from "../mock/presence";

describe("phone check-in", () => {
  it("joins with the keyboard and focuses the confirmation", async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn(async () => ({ ok: true, message: "You are on the floor." }));
    render(<JoinPage joinedTier={null} onJoin={onJoin} />);
    await user.tab();
    await user.keyboard(" ");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(onJoin).toHaveBeenCalledWith("attendee");
    expect(await screen.findByRole("heading", { name: "You're in." })).toHaveFocus();
    expect(screen.getByText(/It grants no permissions/)).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps failed joins editable and announces the failure", async () => {
    const user = userEvent.setup();
    render(<JoinPage joinedTier={null} onJoin={async () => ({ ok: false, message: "Check-in is full." })} />);
    await user.click(screen.getByRole("radio", { name: /Speaker/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Check-in is full.");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "You're in." })).not.toBeInTheDocument();
  });

  it("moves the same mock check-in instead of adding people on each edit", async () => {
    const presence = new PresenceSimulator({ attendee: 0, speaker: 0, staff: 0, organizer: 0 });
    await presence.join("attendee");
    await presence.join("attendee");
    await presence.join("organizer");
    expect(await presence.read()).toEqual({ attendee: 0, speaker: 0, staff: 0, organizer: 1 });
    presence.reset();
    expect(await presence.read()).toEqual({ attendee: 0, speaker: 0, staff: 0, organizer: 0 });
  });
});
