import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { createClient } from "../api/client";
import { incident } from "../test/incident";
import { HistoryView } from "./HistoryView";

it("loads saved incidents, filters them and fetches their real event endpoint", async () => {
  const user = userEvent.setup();
  const transport = vi.fn(async ({ path }: { path: string }) => ({ status: 200, json: path.endsWith('/events') ? {
    items: [{ event_id: 'e1', sequence: 1, type: 'close', actor: { id: 'incident-api' }, state_to: 'resolved', occurred_at: '2026-11-09T20:00:00Z' }], next_cursor: null,
  } : { items: [incident({ id: 'saved-1', state: 'resolved', allowed_actions: [], summary: 'Saved overflow' }), incident({ id: 'active-1', summary: 'Active overflow' })], next_cursor: null } }));
  render(<HistoryView client={createClient({ transport, getToken: () => 'test-token' })} mockMode={false} />);
  await screen.findByText('Saved overflow');
  await user.selectOptions(screen.getByLabelText('Status'), 'resolved');
  expect(screen.queryByText('Active overflow')).not.toBeInTheDocument();
  await user.click(screen.getByText('Saved overflow'));
  expect(await screen.findByText('Closed')).toBeInTheDocument();
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ path: '/incidents/saved-1/events', headers: { Authorization: 'Bearer test-token' } }));
  await user.type(screen.getByLabelText('Search history'), 'missing');
  expect(screen.getByText('No incidents match these filters.')).toBeInTheDocument();
});

it("clears previously displayed history when refreshed access is denied", async () => {
  const user = userEvent.setup();
  const transport = vi.fn().mockResolvedValueOnce({ status: 200, json: { items: [incident({ summary: 'Private incident' })], next_cursor: null } })
    .mockResolvedValue({ status: 403, json: { error: { code: 'forbidden', message: 'Access denied.' } } });
  render(<HistoryView client={createClient({ transport, getToken: () => 'token' })} mockMode={false} />);
  await screen.findByText('Private incident');
  await user.click(screen.getByRole('button', { name: 'Refresh history' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied.');
  expect(screen.queryByText('Private incident')).not.toBeInTheDocument();
});

it("retries failed event reads", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  const transport = vi.fn(async ({ path }: { path: string }) => {
    if (!path.endsWith('/events')) return { status: 200, json: { items: [incident()], next_cursor: null } };
    attempts += 1;
    return attempts === 1 ? { status: 503, json: { error: { code: 'unavailable', message: 'Storage unavailable.' } } }
      : { status: 200, json: { items: [], next_cursor: null } };
  });
  render(<HistoryView client={createClient({ transport, getToken: () => 'token' })} mockMode={false} />);
  await user.click(await screen.findByText('Room B overflow'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Storage unavailable.');
  await user.click(screen.getByRole('button', { name: 'Retry event history' }));
  expect(await screen.findByText('No events recorded.')).toBeInTheDocument();
});
