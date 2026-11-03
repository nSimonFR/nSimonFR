// Shared by the WebGPU and WASM backgrounds: how many boids, how they spawn,
// the palette, pointer tracking and reduced-motion handling.

export const PALETTE = [0xab47bc, 0xce93d8, 0x7e57c2, 0x80deea];
const TINT_WEIGHTS = [0.45, 0.3, 0.2, 0.05];

const pick = (weights) => {
  let r = Math.random();
  for (let i = 0; i < weights.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
};

// Density-based count: about one boid per 900 CSS px², so a phone gets a few
// hundred and a large desktop a couple of thousand, never 20k.
export const boidCount = (width, height, { min = 200, max = 2000, perPx = 900 } = {}) =>
  Math.round(Math.min(max, Math.max(min, (width * height) / perPx)));

// Spawn spread over the whole screen, already flying roughly the same way
// (shared heading +/- ~70°), so the flock starts calm instead of exploding
// from random directions.
export const spawnBoids = (count, width, height) => {
  const heading = Math.random() * Math.PI * 2;
  return Array.from({ length: count }, () => {
    const angle = heading + (Math.random() - 0.5) * 2.4;
    const tier = pick([0.7, 0.25, 0.05]);
    const size = [0.8, 1.15, 1.5][tier] + Math.random() * 0.15;
    const speed = 110 / Math.sqrt(size);
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size,
      tint: pick(TINT_WEIGHTS),
      seed: Math.random() * Math.PI * 2,
    };
  });
};

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Pointer position plus a 0..1 strength that eases out once the pointer stops.
export const createPointer = () => {
  const state = { x: 0, y: 0, strength: 0, last: -Infinity };
  window.addEventListener(
    "pointermove",
    (e) => {
      state.x = e.clientX;
      state.y = e.clientY;
      state.last = performance.now();
    },
    { passive: true }
  );
  document.addEventListener("pointerleave", () => {
    state.last = -Infinity;
  });
  state.update = (now, dt) => {
    const target = now - state.last < 1200 ? 1 : 0;
    state.strength += (target - state.strength) * Math.min(1, dt * 4);
    return state;
  };
  return state;
};

// Fade a background canvas in once it has something to show (no pop-in).
export const fadeIn = (canvas) => {
  requestAnimationFrame(() => canvas.classList.add("ready"));
};

export const mountCanvas = (canvas) => {
  canvas.classList.add("boids");
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  return canvas;
};
