import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 2 has built-in Vite support - no vite-plugin-tauri needed
// https://tauri.app/v2/guides/build/configure-the-backend#vite

// Tauri 2 uses these environment variables
const TAURI_DEV_HOST = process.env.TAURI_DEV_HOST || "127.0.0.1";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: TAURI_DEV_HOST,
    watch: {
      // Ignore src-tauri directory to avoid unnecessary reloads
      ignored: /src-tauri/,
    },
  },
  build: {
    target: "es2022",
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
});