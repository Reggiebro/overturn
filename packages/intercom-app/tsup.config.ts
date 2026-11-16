import { defineConfig } from "tsup";
export default defineConfig({ entry: { main: "src/main.ts" }, format: ["iife"], globalName: "OverturnIntercom", platform: "browser", target: "es2020", sourcemap: false, clean: true, minify: true, noExternal: ["@overturn-ai/shared"], outDir: "dist" });
