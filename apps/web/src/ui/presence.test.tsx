import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceCounts } from "../api/types";
import { PresenceField } from "./index";

type FrameCallback = (time: number) => void;

function stubContext() {
  const gradient = { addColorStop: vi.fn() };
  const calls = { arc: 0, clear: 0 };
  const ctx = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === "createRadialGradient") return () => gradient;
        if (key === "arc") return () => (calls.arc += 1);
        if (key === "clearRect") return () => (calls.clear += 1);
        return () => undefined;
      },
      set: () => true,
    },
  );
  return { ctx, calls };
}

function setup(reduced: boolean) {
  const { ctx, calls } = stubContext();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const queue: FrameCallback[] = [];
  const raf = vi.fn((callback: FrameCallback) => {
    queue.push(callback);
    return queue.length;
  });
  vi.stubGlobal("requestAnimationFrame", raf);
  window.requestAnimationFrame = raf as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn();
  const tick = (time: number) => {
    const callback = queue.shift();
    if (callback) act(() => callback(time));
  };
  return { raf, calls, tick };
}

const counts: PresenceCounts = { attendee: 266, speaker: 24, staff: 18, organizer: 4 };

describe("PresenceField", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("states each tier count and a summary sentence as real text, with an aria-hidden canvas", () => {
    setup(false);
    const { container } = render(<PresenceField counts={counts} variant="hero" />);
    expect(screen.getByText("312 people checked in: 266 attendees, 24 speakers, 18 staff, 4 organizers.")).toBeInTheDocument();
    for (const [tier, value, name] of [
      ["attendee", "266", "Attendees"],
      ["speaker", "24", "Speakers"],
      ["staff", "18", "Staff"],
      ["organizer", "4", "Organizers"],
    ] as const) {
      const zone = container.querySelector(`[data-tier="${tier}"]`) as HTMLElement;
      expect(zone).toHaveTextContent(value);
      expect(zone).toHaveTextContent(name);
    }
    expect(container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(screen.queryByText(/names|faces|identities/)).not.toBeInTheDocument();
  });

  it("uses singular wording for one person", () => {
    setup(false);
    render(<PresenceField counts={{ attendee: 1, speaker: 0, staff: 0, organizer: 0 }} variant="compact" />);
    expect(screen.getByText("1 person checked in: 1 attendee, 0 speakers, 0 staff, 0 organizers.")).toBeInTheDocument();
  });

  it("shows no scaling caption at or below maxBlobs and one above it", () => {
    setup(false);
    const { rerender } = render(<PresenceField counts={counts} variant="compact" maxBlobs={400} />);
    expect(screen.queryByText(/1 dot/)).not.toBeInTheDocument();
    rerender(<PresenceField counts={{ attendee: 400, speaker: 0, staff: 0, organizer: 0 }} variant="compact" />);
    expect(screen.getByText("1 dot ≈ 3 people")).toBeInTheDocument();
    rerender(<PresenceField counts={{ attendee: 400, speaker: 0, staff: 0, organizer: 0 }} variant="compact" maxBlobs={50} />);
    expect(screen.getByText("1 dot ≈ 8 people")).toBeInTheDocument();
  });

  it("requests no animation frames when reduced motion is preferred, and still draws once", () => {
    const { raf, calls } = setup(true);
    const { rerender } = render(<PresenceField counts={counts} variant="hero" />);
    rerender(<PresenceField counts={{ ...counts, attendee: 300 }} variant="hero" />);
    expect(raf).not.toHaveBeenCalled();
    expect(calls.clear).toBeGreaterThan(0);
  });

  it("animates with requestAnimationFrame by default", () => {
    const { raf, tick } = setup(false);
    render(<PresenceField counts={counts} variant="hero" />);
    expect(raf).toHaveBeenCalled();
    tick(16);
    tick(32);
    expect(raf.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("handles increases and decreases in counts without errors and updates the legend", () => {
    const { tick } = setup(false);
    const { rerender } = render(<PresenceField counts={counts} variant="hero" />);
    tick(16);
    rerender(<PresenceField counts={{ attendee: 280, speaker: 24, staff: 18, organizer: 4 }} variant="hero" />);
    tick(500);
    expect(screen.getByText(/326 people checked in/)).toBeInTheDocument();
    rerender(<PresenceField counts={{ attendee: 100, speaker: 10, staff: 5, organizer: 1 }} variant="hero" />);
    tick(520);
    tick(1500);
    tick(2500);
    expect(screen.getByText(/116 people checked in/)).toBeInTheDocument();
    rerender(<PresenceField counts={{ attendee: 0, speaker: 0, staff: 0, organizer: 0 }} variant="hero" />);
    tick(3500);
    expect(screen.getByText(/0 people checked in/)).toBeInTheDocument();
  });
});
