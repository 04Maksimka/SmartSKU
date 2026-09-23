import { defineConfig } from "vite";

// Dev server only: in Docker nginx serves the build and proxies /api (nginx/default.conf)
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.SMARTSKU_BACKEND_URL ?? "http://localhost:8000",
    },
  },
});
