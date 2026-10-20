import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, run `npm run dev:api` (Pages Functions + local D1 on :8788) alongside `npm run dev`.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": "http://localhost:8788" },
  },
});
