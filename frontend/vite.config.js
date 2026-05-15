import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: [
      ".ngrok-free.app",
      ".ngrok-free.dev",
      ".ngrok.app",
    ],
    proxy: {
      "/health": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/sources": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/upload-pdf": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/generate-questions": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/generate-student-questions": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/evaluate-answer": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/evaluate-student-answer": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
