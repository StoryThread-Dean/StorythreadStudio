import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri sets this environment variable when running in dev mode.
// It tells Vite which host address the Tauri window is listening on.
// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// Vite is the build tool that compiles and serves the React frontend.
// Think of it as the "assembly line" that takes your TypeScript/JSX source
// files and turns them into something the browser can run -- fast.
export default defineConfig(async () => ({
  plugins: [
    react(),         // Handles JSX and React-specific transforms
    tailwindcss(),   // Processes all Tailwind utility classes in your components
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
