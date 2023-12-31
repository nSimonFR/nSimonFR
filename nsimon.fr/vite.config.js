import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

export default {
  root: "./src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
  },
  plugins: [wasm(), topLevelAwait()],
};
