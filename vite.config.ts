import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Hash routing means the page path never changes, so relative asset paths work at any URL.
// cssMinify is off on purpose: the minifier drops prefixed rules such as -webkit-backface-visibility
// (the flashcard flip on older iPhones). The stylesheet ships exactly as it was in sidenote.html.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: { target: "es2022", sourcemap: false, cssMinify: false }
});
