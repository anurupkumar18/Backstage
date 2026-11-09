import { describe, expect, it } from "vitest";
import { boxesAt, readDetections, zoneCounts, type ClipDetections, type PersonBox } from "./detections";
const left: PersonBox = { box: [0.1, 0.1, 0.3, 0.8], confidence: 0.9 };
const boundary: PersonBox = { box: [0.4, 0.1, 0.6, 0.8], confidence: 0.9 };
const clip: ClipDetections = { model: "yolo26n.pt", sample_fps: 4, duration: 1, frames: [{ at: 0, boxes: [left] }, { at: 0.25, boxes: [] }, { at: 0.5, boxes: [boundary] }] };
describe("recorded YOLO alignment", () => {
  it("follows seeks and loop restarts without holding the previous shot's boxes", () => {
    expect(boxesAt(clip, 0.6)).toEqual([boundary]);
    expect(boxesAt(clip, 0.3)).toEqual([]);
    expect(boxesAt(clip, 0)).toEqual([left]);
    expect(boxesAt(clip, 1)).toEqual([]);
    expect(boxesAt(clip, NaN)).toEqual([]);
  });
  it("counts each person once at a zone boundary", () => expect(zoneCounts([left, boundary], 0.5)).toEqual({ left: 1, right: 1 }));
  it("rejects bad geometry, confidence and unsorted timestamps", () => {
    expect(() => readDetections({ ...clip, frames: [...clip.frames].reverse() })).toThrow();
    expect(() => readDetections({ ...clip, frames: [{ at: 0, boxes: [{ ...left, box: [0.9, 0, 0.1, 1] }] }] })).toThrow();
    expect(() => readDetections({ ...clip, frames: [{ at: 0, boxes: [{ ...left, confidence: NaN }] }] })).toThrow();
    expect(readDetections(clip)).toEqual(clip);
  });
});
