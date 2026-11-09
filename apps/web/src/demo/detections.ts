export interface PersonBox { box: [number, number, number, number]; confidence: number }
export interface ClipDetections { model: string; sample_fps: number; duration: number; frames: { at: number; boxes: PersonBox[] }[] }

export function readDetections(value: unknown): ClipDetections {
  const data = value as ClipDetections;
  if (!data || typeof data.model !== "string" || !Number.isFinite(data.duration) || data.duration <= 0 || !Array.isArray(data.frames) || !data.frames.length) throw new Error("Detection recording is unavailable.");
  let previous = -1;
  for (const frame of data.frames) {
    if (!Number.isFinite(frame.at) || frame.at < 0 || frame.at <= previous || frame.at > data.duration || !Array.isArray(frame.boxes)) throw new Error("Invalid detection timeline.");
    previous = frame.at;
    for (const item of frame.boxes) {
      if (!Array.isArray(item.box) || item.box.length !== 4 || item.box.some((n) => !Number.isFinite(n) || n < 0 || n > 1) || item.box[0] > item.box[2] || item.box[1] > item.box[3] || !Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) throw new Error("Invalid person box.");
    }
  }
  return data;
}

export function boxesAt(data: ClipDetections, seconds: number): PersonBox[] {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds >= data.duration) return [];
  // Binary search follows the media clock, including seeks and looping playback.
  let lo = 0, hi = data.frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (data.frames[mid]!.at <= seconds) lo = mid; else hi = mid - 1;
  }
  const frame = data.frames[lo];
  return frame && frame.at <= seconds ? frame.boxes : [];
}

export function zoneCounts(boxes: PersonBox[], divider: number) {
  const left = boxes.filter(({ box }) => (box[0] + box[2]) / 2 < divider).length;
  return { left, right: boxes.length - left };
}
