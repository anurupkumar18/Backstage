export type MicState = "idle" | "requesting" | "listening" | "lost" | "error";

export interface MicTrack extends EventTarget {
  readonly readyState: string;
  stop(): void;
  getSettings?(): { deviceId?: string; groupId?: string };
}

export interface MicStream {
  getAudioTracks(): MicTrack[];
}

export interface MicDeviceInfo {
  kind: string;
  deviceId: string;
  groupId: string;
}

const PSEUDO_DEVICE_IDS = new Set(["", "default", "communications"]);

export interface MicMonitorOptions {
  /** With a deviceId, must request exactly that device (`{deviceId: {exact}}`) and fail if it is absent. */
  getUserMedia: (deviceId?: string) => Promise<MicStream>;
  /** Resolves Chrome's "default" pseudo-device to the concrete device in the same group. */
  enumerateDevices?: () => Promise<MicDeviceInfo[]>;
  /** `navigator.mediaDevices`, or any EventTarget that fires `devicechange`. */
  devices?: EventTarget;
  onStateChange: (state: MicState, detail?: string) => void;
  onLost: () => void;
  onRestored: () => void;
}

/**
 * Watches the live audio track. An ended track never comes back, so recovery means acquiring a new one:
 * on `devicechange` (USB mic plugged back in) or when the operator presses reconnect. Recovery requests the
 * exact device first acquired, so a laptop's built-in mic never counts as the stage mic coming back.
 */
export class MicMonitor {
  private track: MicTrack | null = null;
  private state: MicState = "idle";
  private lostEpisode = false;
  private pinnedDeviceId: string | undefined;
  private readonly onEnded = () => this.handleEnded();
  private readonly onDeviceChange = () => {
    if (this.state === "lost" || this.state === "error") {
      void this.acquire();
    }
  };

  constructor(private readonly options: MicMonitorOptions) {
    options.devices?.addEventListener("devicechange", this.onDeviceChange);
  }

  get current(): MicState {
    return this.state;
  }

  start(): Promise<void> {
    return this.acquire();
  }

  reconnect(): Promise<void> {
    return this.acquire();
  }

  dispose(): void {
    this.options.devices?.removeEventListener("devicechange", this.onDeviceChange);
    this.release();
  }

  private setState(state: MicState, detail?: string): void {
    this.state = state;
    this.options.onStateChange(state, detail);
  }

  private release(): void {
    if (this.track) {
      this.track.removeEventListener("ended", this.onEnded);
      this.track.stop();
      this.track = null;
    }
  }

  private async acquire(): Promise<void> {
    if (this.state === "requesting") {
      return;
    }
    this.release();
    this.setState("requesting");
    const wanted = this.lostEpisode ? this.pinnedDeviceId : undefined;
    let track: MicTrack | undefined;
    try {
      const stream = await this.options.getUserMedia(wanted);
      track = stream.getAudioTracks().find((candidate) => candidate.readyState === "live");
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      this.setState(this.lostEpisode ? "lost" : "error", name);
      return;
    }
    if (!track) {
      this.setState(this.lostEpisode ? "lost" : "error", "NoLiveAudioTrack");
      return;
    }
    const actual = track.getSettings?.().deviceId;
    if (wanted && actual && actual !== wanted) {
      track.stop();
      this.setState("lost", "DifferentDevice");
      return;
    }
    if (!this.lostEpisode) {
      this.pinnedDeviceId = await this.resolveDeviceId(track);
    }
    this.track = track;
    track.addEventListener("ended", this.onEnded);
    this.setState("listening");
    if (this.lostEpisode) {
      this.lostEpisode = false;
      this.options.onRestored();
    }
  }

  private async resolveDeviceId(track: MicTrack): Promise<string | undefined> {
    const settings = track.getSettings?.() ?? {};
    if (settings.deviceId && !PSEUDO_DEVICE_IDS.has(settings.deviceId)) {
      return settings.deviceId;
    }
    if (!this.options.enumerateDevices || !settings.groupId) {
      return undefined;
    }
    try {
      const devices = await this.options.enumerateDevices();
      return devices.find(
        (device) =>
          device.kind === "audioinput" && device.groupId === settings.groupId && !PSEUDO_DEVICE_IDS.has(device.deviceId),
      )?.deviceId;
    } catch {
      return undefined;
    }
  }

  private handleEnded(): void {
    if (this.lostEpisode) {
      return;
    }
    this.lostEpisode = true;
    if (this.track) {
      this.track.removeEventListener("ended", this.onEnded);
      this.track = null;
    }
    this.setState("lost");
    this.options.onLost();
  }
}

export interface CaptionHeartbeatOptions {
  timeoutMs: number;
  onLine: (lineSeq: number) => void;
  onStale: () => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Counts caption lines and reports staleness. Only the sequence number leaves this class; caption text
 * stays with the caller. Emits one `stale` per gap and re-arms on the next line.
 */
export class CaptionHeartbeat {
  private seq = 0;
  private timer: unknown = null;
  private staleReported = false;
  private running = false;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: CaptionHeartbeatOptions) {
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get lastSeq(): number {
    return this.seq;
  }

  get isStale(): boolean {
    return this.staleReported;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
    this.arm();
  }

  stop(): void {
    this.running = false;
    this.disarm();
  }

  setTimeout(ms: number): void {
    this.options.timeoutMs = ms;
    if (this.running) {
      this.arm();
    }
  }

  beat(): number {
    this.seq += 1;
    this.staleReported = false;
    this.options.onLine(this.seq);
    if (this.running) {
      this.arm();
    }
    return this.seq;
  }

  private disarm(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private arm(): void {
    this.disarm();
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.running && !this.staleReported) {
        this.staleReported = true;
        this.options.onStale();
      }
    }, this.options.timeoutMs);
  }
}
