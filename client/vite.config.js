import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, forward /api calls to the Express server so no CORS setup is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        timeout: 300000,
        proxyTimeout: 300000,
      },
    },
  },
});
