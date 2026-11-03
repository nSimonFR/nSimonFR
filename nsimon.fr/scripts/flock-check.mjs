#!/usr/bin/env node
/**
 * Long-run flock health check for the WebGPU boids.
 *
 * Boots the Vite dev server, opens the site in headless Chrome with WebGPU,
 * fast-forwards the simulation (via the dev-only window.__boids hook) and
 * reads every boid back from the GPU to measure clumping, overlap, speed and
 * how much of the flock fuses into one mass. Fails on regressions.
 *
 *   npm run test:flock            (needs Google Chrome installed)
 */
import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const CHECKPOINTS = [10, 60, 180, 300]; // simulated seconds
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1000, height: 844 },
  { width: 390, height: 844 },
];
// Thresholds, checked from 60s on (the flock needs time to settle).
const LIMITS = {
  maxCellXmean: 8, // busiest 60px cell vs. average density
  top5share: 0.3, // share of boids in the busiest 5% of cells
  overlap: 0.03, // boids with a neighbour closer than 5px
  largestFlock: 0.85, // share of boids in the largest connected group
  minSpeed: 115, // px/s, mean
  pointerClear: 0.15, // boids left near a held pointer vs. an even spread
};
const POINTER_RADIUS = 100; // px, the zone that should empty out
const POINTER_HOLD = 3; // s

const metrics = ({ width, height, stride, data }) => {
  const n = data.length / stride, pts = [];
  let nan = 0, speed = 0;
  for (let i = 0; i < n; i++) {
    const [x, y, vx, vy] = data.slice(i * stride, i * stride + 4);
    if (![x, y, vx, vy].every(Number.isFinite)) { nan++; continue; }
    pts.push([x, y]); speed += Math.hypot(vx, vy);
  }
  const C = 60, cols = Math.ceil(width / C), rows = Math.ceil(height / C), grid = new Array(cols * rows).fill(0);
  for (const [x, y] of pts) { const cx = Math.floor(x / C), cy = Math.floor(y / C); if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) grid[cy * cols + cx]++; }
  const onScreen = grid.reduce((a, b) => a + b, 0), mean = onScreen / grid.length;
  const sorted = [...grid].sort((a, b) => b - a), top5 = sorted.slice(0, Math.ceil(grid.length * 0.05)).reduce((a, b) => a + b, 0);
  // nearest-neighbour distances (brute force is fine for a few thousand)
  const nn = pts.map(([x, y], i) => { let m = Infinity; for (let j = 0; j < pts.length; j++) if (j !== i) { const d = Math.hypot(pts[j][0] - x, pts[j][1] - y); if (d < m) m = d; } return m; }).sort((a, b) => a - b);
  // largest flock: connected components, boids linked when closer than 30px
  const parent = pts.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const L = 30, buckets = new Map(), key = (a, b) => a + ',' + b;
  pts.forEach(([x, y], i) => { const k = key(Math.floor(x / L), Math.floor(y / L)); (buckets.get(k) || buckets.set(k, []).get(k)).push(i); });
  pts.forEach(([x, y], i) => { const cx = Math.floor(x / L), cy = Math.floor(y / L);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of buckets.get(key(cx + dx, cy + dy)) || [])
      if (j > i && Math.hypot(pts[j][0] - x, pts[j][1] - y) < L) parent[find(i)] = find(j); });
  const sizes = new Map(); pts.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) || 0) + 1));
  const largest = Math.max(...sizes.values());
  return {
    largestFlock: +(largest / pts.length).toFixed(2),
    flocks10: [...sizes.values()].filter(v => v >= 10).length,
    coverage: +(grid.filter(c => c > 0).length / grid.length).toFixed(2),
    top5share: +(top5 / onScreen).toFixed(2),
    maxCellXmean: +(sorted[0] / mean).toFixed(1),
    nnMedian: +nn[nn.length >> 1].toFixed(1),
    overlap: +(nn.filter(d => d < 5).length / nn.length).toFixed(3),
    speed: +(speed / pts.length).toFixed(0),
    nan,
  };
};

const server = await createServer({
  configFile: fileURLToPath(new URL("../vite.config.js", import.meta.url)),
  root: fileURLToPath(new URL("../src", import.meta.url)),
  server: { port: 0 },
  logLevel: "error",
});
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-gpu", "--use-angle=metal"],
});

const failures = [];
try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(url);
    await page.waitForFunction(() => window.__boids, null, { timeout: 15000 });
    await page.evaluate(() => window.__boids.pause());

    const name = `${viewport.width}x${viewport.height}`;
    const rows = [];
    let t = 0;
    for (const cp of CHECKPOINTS) {
      await page.evaluate((steps) => window.__boids.step(steps), (cp - t) * 60);
      t = cp;
      const m = metrics(await page.evaluate(() => window.__boids.read()));
      rows.push({ t: `${cp}s`, ...m });
      if (m.nan) failures.push(`${name} @${cp}s: ${m.nan} NaN boids`);
      if (cp < 60) continue;
      for (const key of ["maxCellXmean", "top5share", "overlap", "largestFlock"]) {
        if (m[key] > LIMITS[key]) failures.push(`${name} @${cp}s: ${key}=${m[key]} > ${LIMITS[key]}`);
      }
      if (m.speed < LIMITS.minSpeed) failures.push(`${name} @${cp}s: speed=${m.speed} < ${LIMITS.minSpeed}`);
    }
    // Pointer avoidance: hold the pointer mid-screen and check boids clear out.
    const mouse = { x: viewport.width / 2, y: viewport.height / 2 };
    const near = ({ data, stride }) => {
      let c = 0;
      for (let i = 0; i < data.length; i += stride) if (Math.hypot(data[i] - mouse.x, data[i + 1] - mouse.y) < POINTER_RADIUS) c++;
      return c;
    };
    const total = await page.evaluate(() => window.__boids.count);
    const expected = (total * Math.PI * POINTER_RADIUS ** 2) / (viewport.width * viewport.height);
    await page.evaluate(([s, m]) => window.__boids.step(s, 1 / 60, m), [POINTER_HOLD * 60, mouse]);
    const left = near(await page.evaluate(() => window.__boids.read()));
    const clear = +(left / expected).toFixed(2);
    console.log(`pointer held ${POINTER_HOLD}s: ${left} boids within ${POINTER_RADIUS}px (even spread would be ~${expected.toFixed(0)}, ratio ${clear})`);
    if (clear > LIMITS.pointerClear) failures.push(`${name}: pointer avoidance ratio=${clear} > ${LIMITS.pointerClear}`);

    errors.forEach((e) => failures.push(`${name}: page error: ${e}`));
    console.log(`\n${name}, ${await page.evaluate(() => window.__boids.count)} boids`);
    console.table(rows);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

if (failures.length) {
  console.error(`\nFAIL\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nPASS: flock stays healthy over 5 simulated minutes");
