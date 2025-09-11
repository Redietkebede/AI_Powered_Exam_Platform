// client/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:2800",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (_proxyReq, req) => {
            console.log("[VITE PROXY] ->", req.method, req.url);
          });
          proxy.on("proxyRes", (proxyRes, req) => {
            console.log("[VITE PROXY RES] <-", req.method, req.url, proxyRes.statusCode);
          });
        },
      },
    },
  },
});
