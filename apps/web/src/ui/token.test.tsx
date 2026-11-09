import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AppShell, type AppShellProps } from "./AppShell";

it("commits a token once on submit and discards a draft when switching identity", async () => {
  const user = userEvent.setup();
  const commit = vi.fn();
  const props: AppShellProps = { route: "board", onNavigate: vi.fn(), identities: [], activeIdentityId: "organizer", onIdentityChange: vi.fn(), mockMode: false, token: "", onTokenChange: commit, announcement: "", children: null };
  const { rerender } = render(<AppShell {...props} />);
  await user.type(screen.getByLabelText("API token"), "test-organizer-token");
  expect(commit).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(commit).toHaveBeenCalledExactlyOnceWith("test-organizer-token");
  rerender(<AppShell {...props} activeIdentityId="attendee" />);
  expect(screen.getByLabelText("API token")).toHaveValue("");
});
