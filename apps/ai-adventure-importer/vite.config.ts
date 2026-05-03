import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: "src/module.ts",
      name: "AiAdventureImporter",
      fileName: () => "module.js",
      formats: ["es"],
    },
    outDir: ".",
    emptyOutDir: false,
    rollupOptions: {
      external: [],
      output: { inlineDynamicImports: true },
    },
    sourcemap: true,
    minify: false,
  },
  resolve: {
    alias: {
      "@ai-adventure/bundle-schema": path.resolve(
        __dirname,
        "../../packages/bundle-schema/src/index.ts"
      ),
    },
  },
});
// Note: CSS is in styles/ and must be copied to root after build.
// The verify-build.mjs script handles this check.
// Run: cp styles/ai-adventure-importer.css ai-adventure-importer.css after build.
