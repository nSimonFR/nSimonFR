const startWasm = () => import("./boids/wasm.js");

try {
  if (new URLSearchParams(location.search).has("wasm")) {
    throw new Error("WASM forced by ?wasm");
  }
  if (!navigator.gpu) {
    throw new Error("WebGPU is not supported in your browser");
  }
  const { start } = await import("./boids/webgpu.js");
  await start();
} catch (error) {
  console.warn(`WebGPU error: ${error}`);
  console.warn("WebGPU error: falling back to WASM");
  document.querySelector("canvas.boids")?.remove();
  startWasm();
}
