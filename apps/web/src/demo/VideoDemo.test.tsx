import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoDemo } from "./VideoDemo";
const recording = { model: "yolo26n.pt", sample_fps: 4, duration: 30, frames: [{ at: 0, boxes: [{ box: [0.1, 0.1, 0.3, 0.8], confidence: 0.9 }] }, { at: 1, boxes: [] }] };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (path: string) => path.includes("detections") ? { ok: true, json: async () => recording } : { ok: false });
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("plays the recorded detector results without transmitting frames or requesting a camera", async () => {
  const camera = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: camera } });
  const { container } = render(<VideoDemo />);
  await screen.findByText("yolo26n.pt");
  expect(container.querySelectorAll(".video-demo__overlay rect")).toHaveLength(1);
  const video = container.querySelector("video")!;
  video.currentTime = 1;
  fireEvent.timeUpdate(video);
  expect(container.querySelectorAll(".video-demo__overlay rect")).toHaveLength(0);
  video.currentTime = 0;
  fireEvent.timeUpdate(video);
  expect(container.querySelectorAll(".video-demo__overlay rect")).toHaveLength(1);
  expect(camera).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.every(([path]) => !String(path).includes("/detect"))).toBe(true);
});
it("stops a late camera grant after the user cancels it", async () => {
  let grant!: (stream: MediaStream) => void;
  const camera = vi.fn(() => new Promise<MediaStream>((resolve) => { grant = resolve; }));
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: camera } });
  render(<VideoDemo />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Use live camera" }));
  await user.click(screen.getByRole("button", { name: "Stop camera" }));
  await act(async () => grant({ getTracks: () => [{ stop }] } as unknown as MediaStream));
  await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  expect(screen.queryByText("Live camera", { exact: true })).not.toBeInTheDocument();
});
it("stops camera tracks when leaving the route", async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  const { unmount } = render(<VideoDemo />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Use live camera" }));
  expect(screen.getAllByText("Live camera").length).toBeGreaterThan(0);
  unmount();
  expect(stop).toHaveBeenCalledOnce();
});

it("ignores a late permission rejection after switching back to the demo", async () => {
  let reject!: (reason: Error) => void;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(() => new Promise((_resolve, failure) => { reject = failure; })) } });
  render(<VideoDemo />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Use live camera" }));
  await user.click(screen.getByRole("button", { name: "Stop camera" }));
  await act(async () => reject(new Error("Permission denied")));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});


it("retries a busy detector and sends the role bearer only on inference", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const drawing = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: drawing } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })));
  let detections = 0;
  fetchMock.mockImplementation(async (path: string) => {
    if (path.includes("detections")) return { ok: true, json: async () => recording };
    if (path === "/camera/detect") {
      detections++;
      return detections === 1 ? { ok: false, status: 429 } : { ok: true, json: async () => ({ model: "live-model", boxes: [], inference_ms: 10 }) };
    }
    return { ok: false };
  });
  const { container, unmount } = render(<VideoDemo token="role-test-token" />);
  fireEvent.click(screen.getByRole("button", { name: "Run YOLO live" }));
  const video = container.querySelector("video")!;
  Object.defineProperties(video, { readyState: { value: 4 }, videoWidth: { value: 640 }, videoHeight: { value: 360 } });
  fireEvent.play(video);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(detections).toBe(1);
  expect(screen.getByRole("button", { name: "Hide detections" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  expect(detections).toBeGreaterThan(1);
  const request = fetchMock.mock.calls.find(([path]) => path === "/camera/detect");
  expect((request?.[1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer role-test-token" });
  expect(fetchMock.mock.calls.filter(([path]) => path !== "/camera/detect").every((call) => !(call[1] as RequestInit)?.headers)).toBe(true);
  unmount();
  vi.useRealTimers();
});
