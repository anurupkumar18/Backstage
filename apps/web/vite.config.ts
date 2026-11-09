import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = fileURLToPath(
  new URL("../../fixtures/shared", import.meta.url),
);
const contracts = fileURLToPath(new URL("../../contracts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@fixtures": fixtures, "@contracts": contracts },
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        stage: fileURLToPath(new URL("./stage.html", import.meta.url)),
      },
    },
  },
  server: {
    fs: { allow: [repoRoot] },
    allowedHosts: process.env.DEMO_PUBLIC === "1" ? true : undefined,
    proxy: {
      "/otel": {
        target: process.env.OTEL_PROXY_TARGET ?? "http://127.0.0.1:4318",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/otel/, ""),
      },
      "/api/v1": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
      },
      "/presence": {
        target: process.env.PRESENCE_PROXY_TARGET ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
