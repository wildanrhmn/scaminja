import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API runs in the same Express process in production (same-origin /try, /x402).
// In dev/preview there is no local backend, so proxy the API calls to the live site
// so the checker works while iterating on the UI.
const apiProxy = {
  "/try": { target: "https://scaminja.app", changeOrigin: true, secure: true },
  "/repo-try": { target: "https://scaminja.app", changeOrigin: true, secure: true },
  "/x402": { target: "https://scaminja.app", changeOrigin: true, secure: true },
  "/health": { target: "https://scaminja.app", changeOrigin: true, secure: true },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: { outDir: "dist", target: "es2020" },
});
