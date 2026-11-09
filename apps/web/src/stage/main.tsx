import "../telemetry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fetchTransport } from "../api/transport";
import type { MicDeviceInfo, MicStream } from "./monitors";
import { StageApp } from "./StageApp";
import "./stage.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
const getUserMedia = mediaDevices?.getUserMedia
  ? (deviceId?: string): Promise<MicStream> =>
      mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false })
  : undefined;
const enumerateDevices = mediaDevices?.enumerateDevices
  ? (): Promise<MicDeviceInfo[]> => mediaDevices.enumerateDevices()
  : undefined;

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}
createRoot(container).render(
  <StrictMode>
    <StageApp transport={fetchTransport(apiBaseUrl)} apiBaseUrl={apiBaseUrl} getUserMedia={getUserMedia}
      enumerateDevices={enumerateDevices}
      devices={mediaDevices}
    />
  </StrictMode>,
);
