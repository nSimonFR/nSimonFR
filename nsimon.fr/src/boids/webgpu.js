/**
 * WebGPU boids, bundled with the site (previously an iframe to
 * nsimonfr.github.io/webgpu-boids). Throws if WebGPU can't start, so the
 * caller can fall back to the WASM version.
 */
import computeCode from "./shaders/compute.wgsl?raw";
import renderCode from "./shaders/render.wgsl?raw";
import { boidCount, createPointer, fadeIn, mountCanvas, reducedMotion, spawnBoids } from "./common.js";

const FLOATS_PER_BOID = 8; // pos(2) vel(2) size tint seed pad
const PARAMS_FLOATS = 8; // dt time width height mouse(2) mouseStrength fade
const SAMPLES = 4; // MSAA: smooth edges, no shimmering on thin shapes
const FADE_MS = 1800;
const WARMUP_STEPS = 240; // reduced motion: pre-flock, then show one still frame

export const start = async () => {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) throw new Error("WebGPU disabled");
  const device = await adapter.requestDevice();

  const canvas = mountCanvas(document.createElement("canvas"));
  const context = canvas.getContext("webgpu");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  let width = window.innerWidth;
  let height = window.innerHeight;
  const count = boidCount(width, height);

  // Boid buffers (ping-pong).
  const data = new Float32Array(count * FLOATS_PER_BOID);
  spawnBoids(count, width, height).forEach((b, i) => {
    data.set([b.x, b.y, b.vx, b.vy, b.size, b.tint, b.seed, 0], i * FLOATS_PER_BOID);
  });
  const boidBuffers = [0, 1].map((i) => {
    const buffer = device.createBuffer({
      label: `boids ${i}`,
      size: data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  });

  const params = new Float32Array(PARAMS_FLOATS);
  const paramsBuffer = device.createBuffer({
    label: "params",
    size: params.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const [computePipeline, renderPipeline] = await Promise.all([
    device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: device.createShaderModule({ code: computeCode }), entryPoint: "main" },
    }),
    device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: device.createShaderModule({ code: renderCode }), entryPoint: "vs" },
      fragment: {
        module: device.createShaderModule({ code: renderCode }),
        entryPoint: "fs",
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          },
        ],
      },
      multisample: { count: SAMPLES },
    }),
  ]);

  // computeGroups[k]: reads buffer k, writes buffer 1-k. renderGroups[k]: draws buffer k.
  const computeGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: boidBuffers[k] } },
        { binding: 1, resource: { buffer: boidBuffers[1 - k] } },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    })
  );
  const renderGroups = [0, 1].map((k) =>
    device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: boidBuffers[k] } },
        { binding: 1, resource: { buffer: paramsBuffer } },
      ],
    })
  );

  let msaaTexture;
  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const max = device.limits.maxTextureDimension2D;
    canvas.width = Math.max(1, Math.min(Math.round(width * dpr), max));
    canvas.height = Math.max(1, Math.min(Math.round(height * dpr), max));
    msaaTexture?.destroy();
    msaaTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      sampleCount: SAMPLES,
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  };
  resize();

  const pointer = createPointer();
  let current = 0;
  let time = 0;

  const writeParams = (dt, fade) => {
    params.set([dt, time, width, height, pointer.x, pointer.y, pointer.strength, fade]);
    device.queue.writeBuffer(paramsBuffer, 0, params);
  };

  const encodeStep = (encoder) => {
    const pass = encoder.beginComputePass();
    pass.setPipeline(computePipeline);
    pass.setBindGroup(0, computeGroups[current]);
    pass.dispatchWorkgroups(Math.ceil(count / 64));
    pass.end();
    current = 1 - current;
  };

  const encodeDraw = (encoder) => {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: msaaTexture.createView(),
          resolveTarget: context.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "discard",
        },
      ],
    });
    pass.setPipeline(renderPipeline);
    pass.setBindGroup(0, renderGroups[current]);
    pass.draw(3, count);
    pass.end();
  };

  // Still frame for prefers-reduced-motion: let the flock form off-screen first.
  const drawStill = (warmup = WARMUP_STEPS) => {
    pointer.strength = 0;
    for (let i = 0; i < warmup; i += 1) {
      time += 1 / 60;
      writeParams(1 / 60, 1);
      const encoder = device.createCommandEncoder();
      encodeStep(encoder);
      device.queue.submit([encoder.finish()]);
    }
    const encoder = device.createCommandEncoder();
    encodeDraw(encoder);
    device.queue.submit([encoder.finish()]);
  };

  let startedAt = null;
  let last = 0;
  let raf = 0;
  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (startedAt === null) {
      startedAt = now;
      last = now;
    }
    // Clamp dt: same speed on 60/120/144 Hz, no jump after a hidden tab.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    time += dt;
    pointer.update(now, dt);
    const t = Math.min(1, (now - startedAt) / FADE_MS);
    writeParams(dt, 1 - (1 - t) ** 3);

    const encoder = device.createCommandEncoder();
    encodeStep(encoder);
    encodeDraw(encoder);
    device.queue.submit([encoder.finish()]);
  };

  const run = () => {
    cancelAnimationFrame(raf);
    if (reducedMotion.matches) drawStill();
    else raf = requestAnimationFrame(frame);
  };

  window.addEventListener("resize", () => {
    resize();
    if (reducedMotion.matches) drawStill(0);
  });
  reducedMotion.addEventListener("change", run);
  device.lost.then((info) => console.error(`WebGPU device lost: ${info.message}`));

  run();
  fadeIn(canvas);

  // Dev-only hook for long-run tests (stripped from production builds):
  // fast-forward the simulation and read every boid back from the GPU.
  if (import.meta.env.DEV) {
    window.__boids = {
      count,
      pause: () => cancelAnimationFrame(raf),
      resume: run,
      step: async (steps, dt = 1 / 60) => {
        pointer.strength = 0;
        for (let i = 0; i < steps; i += 1) {
          time += dt;
          writeParams(dt, 1);
          const encoder = device.createCommandEncoder();
          encodeStep(encoder);
          device.queue.submit([encoder.finish()]);
          if (i % 200 === 199) await device.queue.onSubmittedWorkDone();
        }
        const encoder = device.createCommandEncoder();
        encodeDraw(encoder);
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
      },
      read: async () => {
        const read = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(boidBuffers[current], 0, read, 0, data.byteLength);
        device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const out = Array.from(new Float32Array(read.getMappedRange().slice(0)));
        read.destroy();
        return { width, height, stride: FLOATS_PER_BOID, data: out };
      },
    };
  }

  const footer = document.querySelector("#footer-ref");
  footer.href = "https://github.com/nSimonFR/nSimonFR/tree/main/nsimon.fr/src/boids";
  footer.textContent = "Boids in WebGPU !";
};
