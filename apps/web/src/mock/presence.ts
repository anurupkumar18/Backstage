import type { JoinResult, PresenceApi } from "../api/presence";
import type { PresenceCounts, PresenceTier } from "../api/types";

const WAVE_BATCHES = 24;
const WAVE_BATCH_MS = 250;

export class PresenceSimulator implements PresenceApi {
  private counts: PresenceCounts;
  private readonly seed: PresenceCounts;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(seed: PresenceCounts = { attendee: 12, speaker: 2, staff: 4, organizer: 1 }) {
    this.seed = { ...seed };
    this.counts = { ...seed };
  }

  async read(): Promise<PresenceCounts> {
    return { ...this.counts };
  }

  async join(tier: PresenceTier): Promise<JoinResult> {
    this.counts[tier] += 1;
    return { ok: true, message: "You are on the floor." };
  }

  /** Rehearsal only: a burst of anonymous check-ins, mostly attendees. */
  wave(): void {
    for (let batch = 1; batch <= WAVE_BATCHES; batch += 1) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        this.counts.attendee += 5;
        if (batch % 6 === 0) {
          this.counts.speaker += 1;
        }
        if (batch % 8 === 0) {
          this.counts.staff += 1;
        }
      }, batch * WAVE_BATCH_MS);
      this.timers.add(timer);
    }
  }

  reset(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.counts = { ...this.seed };
  }
}
