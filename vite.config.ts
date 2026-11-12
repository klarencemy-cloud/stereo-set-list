/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // The offline service worker is a second entry, served at a fixed /sw.js.
      input: { main: "index.html", sw: "src/sw/sw.ts" },
      output: { entryFileNames: (chunk) => (chunk.name === "sw" ? "sw.js" : "assets/[name]-[hash].js") },
    },
  },
  test: {
    globals: true,
    environment: "node",
    environmentMatchGlobs: [["tests/app/**", "jsdom"]],
    setupFiles: ["tests/app/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
