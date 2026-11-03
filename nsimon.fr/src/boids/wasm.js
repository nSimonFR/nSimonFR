/**
 * WASM fallback (Rust simulation from wasm-boids, drawn with PixiJS).
 * Same palette, density, spawn and reduced-motion handling as the WebGPU one.
 */
import * as PIXI from "pixi.js";
import { Rules, Universe } from "wasm-boids";
import { PALETTE, boidCount, createPointer, fadeIn, mountCanvas, reducedMotion, spawnBoids } from "./common.js";

const width = window.innerWidth;
const height = window.innerHeight;
// The Rust simulation runs on the CPU, so keep it lighter than the GPU one.
const count = boidCount(width, height, { min: 120, max: 500, perPx: 2600 });

const app = new PIXI.Application({ resizeTo: window, antialias: true, backgroundAlpha: 0 });
mountCanvas(app.view);

const boidGraphic = new PIXI.Graphics();
boidGraphic.beginFill(0xffffff);
boidGraphic.moveTo(-20, 10);
boidGraphic.lineTo(20, 0);
boidGraphic.lineTo(-20, -10);
const boidTexture = app.renderer.generateTexture(boidGraphic);

const universe = Universe.new(width, height);
const boidSprites = spawnBoids(count, width, height).map((b) => {
  const rotation = Math.atan2(b.vy, b.vx);
  const scale = 0.3 * b.size;
  const speed = 2 / Math.sqrt(scale);
  universe.create_boid(b.x, b.y, rotation, Rules.new(speed, scale, 100, 5, 0.1, 0.005, 0.2, 0.001));

  const sprite = new PIXI.Sprite(boidTexture);
  sprite.anchor.set(0.5);
  sprite.tint = PALETTE[b.tint];
  sprite.alpha = 0.6 + 0.35 * Math.min(1, (b.size - 0.7) / 0.9);
  sprite.scale.set(scale);
  sprite.position.set(b.x, b.y);
  sprite.rotation = rotation;
  app.stage.addChild(sprite);
  return sprite;
});

const drawBoids = () => {
  for (let i = 0; i < count; i += 1) {
    const boid = universe.get_boid(i);
    const sprite = boidSprites[i];
    sprite.x = boid.x();
    sprite.y = boid.y();
    sprite.rotation = boid.rotation();
  }
};

window.addEventListener("resize", () => universe.resize(window.innerWidth, window.innerHeight, false));

const pointer = createPointer();
let last = performance.now();
const tick = () => {
  const now = performance.now();
  pointer.update(now, (now - last) / 1000);
  last = now;
  const active = pointer.strength > 0.5;
  universe.tick(active ? pointer.x : 0, active ? pointer.y : 0);
  drawBoids();
};

const run = () => {
  app.ticker.remove(tick);
  if (reducedMotion.matches) {
    for (let i = 0; i < 240; i += 1) universe.tick(0, 0);
    drawBoids();
    app.render();
    app.ticker.stop();
  } else {
    app.ticker.add(tick);
    app.ticker.start();
  }
};

reducedMotion.addEventListener("change", run);
run();
fadeIn(app.view);
