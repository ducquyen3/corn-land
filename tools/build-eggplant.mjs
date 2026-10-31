// Builds assets/models/eggplant.glb, an eggplant modelled on a reference photo.
// The outline was traced from that photo; every texture is painted here, so no photo pixels
// end up in the model. Needs only Node.
//   node tools/build-eggplant.mjs [out.glb]      TEX=1024 gives a fast draft.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MeshBuilder, buildGlb, clamp, encodeJpeg, fbm, heightToNormal, hex, levelAndFit, loop, mix, mixC, noise, periodicTable, smooth, spline } from './model-kit.mjs';

const OUT = resolve(process.argv[2] ?? 'assets/models/eggplant.glb');
const TEX = Number(process.env.TEX ?? 2048), WEB = process.env.QUALITY === 'web';
const DEBUG_DIR = process.env.DEBUG_TEX;

// Measurements from the photo, in its pixels (x right, y down) ---------------------------
const PHOTO_W = 738, PHOTO_H = 414, TILT_DEG = 10.7, TILT = (TILT_DEG * Math.PI) / 180;
const OX = 175, OY = 262, DX = Math.cos(TILT), DY = -Math.sin(TILT), UX = -Math.sin(TILT), UY = -Math.cos(TILT);
const toAxis = (x, y) => [(x - OX) * DX + (y - OY) * DY, (x - OX) * UX + (y - OY) * UY];
const fromAxis = (s, t) => [OX + s * DX + t * UX, OY + s * DY + t * UY];

// The body's outline; the first and last few points are hidden under the sepals.
const BODY_OUTLINE = [[163, 262], [170, 232], [190, 195], [215, 167], [260, 150], [310, 127], [350, 110], [380, 95], [415, 77], [450, 65], [485, 56], [520, 54], [555, 57], [590, 70], [620, 90], [642, 120], [655, 155], [656, 185], [650, 215], [635, 245], [610, 272], [580, 295], [545, 310], [505, 322], [465, 330], [425, 335], [380, 336], [340, 335], [305, 332], [280, 331], [240, 326], [205, 315], [178, 297]];
const { sMin, sMax, top, bot } = (() => {
  const poly = loop(BODY_OUTLINE, 14), pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push(toAxis(poly[i], poly[i + 1]));
  const sLo = Math.min(...pts.map(p => p[0])), sHi = Math.max(...pts.map(p => p[0])), n = Math.ceil(sHi - sLo) + 1;
  let hi = new Float64Array(n).fill(-Infinity), lo = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], steps = Math.max(2, Math.ceil(Math.abs(b[0] - a[0]) * 2));
    for (let k = 0; k <= steps; k++) { const u = k / steps, s = mix(a[0], b[0], u), t = mix(a[1], b[1], u), q = Math.round(s - sLo); hi[q] = Math.max(hi[q], t); lo[q] = Math.min(lo[q], t); }
  }
  const fill = arr => { for (let i = 0; i < n; i++) if (!Number.isFinite(arr[i])) arr[i] = arr[i - 1] ?? 0; };
  fill(hi); fill(lo);
  const soften = arr => { for (let pass = 0; pass < 2; pass++) { const c = [...arr]; for (let i = 2; i < n - 2; i++) arr[i] = (c[i - 2] + c[i - 1] + c[i] + c[i + 1] + c[i + 2]) / 5; } };
  soften(hi); soften(lo);
  return { sMin: sLo, sMax: sHi, top: hi, bot: lo };
})();
const section = s => {
  const q = clamp(s - sMin, 0, top.length - 1.001), i = Math.floor(q), f = q - i;
  const a = mix(top[i], top[i + 1], f), b = mix(bot[i], bot[i + 1], f);
  // Both ends close as smooth domes.
  const end = clamp(Math.min(s - sMin, sMax - s) / 12, 0, 1);
  return { c: (a + b) / 2, r: Math.max((a - b) / 2, 0) * Math.sqrt(1 - (1 - end) ** 2) };
};

// Sepals: how far the torn edge reaches along the axis at each angle (90 up, 0 toward the viewer).
const JUNCTION = -43.7;
const reach = periodicTable([[0, 68], [10, 73], [20, 65], [32, 60], [50, 72], [70, 88], [90, 102], [110, 85], [140, 60], [170, 90], [200, 75], [230, 60], [255, 110], [270, 140], [280, 133], [290, 78], [306, 42], [324, 29], [338, 44], [350, 56]]);
// Measured top and bottom of the sepals by distance along the axis from the stem.
const CUP = [[-6, 3, -24], [0, 8, -28], [5, 30, -41], [16, 59, -56], [33, 68, -68], [53, 74.6, -80], [71, 79.4, -89], [89, 80, -94], [106, 88, -100], [121, 94, -103], [145, 98, -106]];
const cupAt = a => {
  let i = 0; while (i < CUP.length - 2 && CUP[i + 1][0] <= a) i++;
  const p = CUP[i], q = CUP[i + 1], u = smooth(0, 1, clamp((a - p[0]) / (q[0] - p[0]), 0, 1)), top = mix(p[1], q[1], u), low = mix(p[2], q[2], u);
  return { c: (top + low) / 2, r: (top - low) / 2 };
};
const crumple = (phi, a) => {
  const c = Math.cos(phi), s = Math.sin(phi);
  return 3 * noise(3.6 * c + a / 16 + 2, 3.6 * s - a / 20 + 7) + 2.2 * noise(9 * c + a / 22 - 4, 9 * s - a / 26 + 1) + 1.4 * noise(22 * c - a / 14 + 6, 22 * s + a / 16 - 3) + 0.7 * noise(44 * c + a / 7, 44 * s - a / 8);
};
const tornEdge = phi => {
  const c = Math.cos(phi), s = Math.sin(phi);
  return reach((phi * 180) / Math.PI) + 4.6 * fbm(11 * c + 3, 11 * s - 5, 2) + 1.8 * noise(46 * c - 2, 46 * s + 9);
};

// Surfaces, as x right, y up, z toward the viewer, with the photo's centre of mass near 0.
const CX = 400, CY = 200;
const place = (x, y, z) => [x - CX, CY - y, z];

function bodySurface(phi, s) {
  const { c, r } = section(s), cs = Math.cos(phi), sn = Math.sin(phi), lump = 1 + 0.012 * fbm(1.7 * cs + s / 130 + 3, 1.7 * sn - s / 150 - 2, 2);
  const [x, y] = fromAxis(s, c + r * lump * sn);
  return [x, y, r * lump * cs];
}
function calyxSurface(phi, v, inner) {
  const edge = tornEdge(phi), a = mix(-6, edge, Math.pow(v, 0.92)), cup = cupAt(a), s = a + JUNCTION, sn = Math.sin(phi), cs = Math.cos(phi);
  // Rides just clear of the body, wherever the body is fatter than the measured cup.
  const body = section(s), onBody = s > sMin + 2 ? body.r + (body.c - cup.c) * sn + 1.8 : 0;
  const d = Math.max(cup.r, onBody) - cup.r, smoothed = cup.r + d * smooth(0, 3, d);
  const R = smoothed + crumple(phi, a) * smooth(0, 16, a) + 3 * v ** 6 * (0.4 + noise(5 * cs + 3, 5 * sn)) - (inner ? 1.3 : 0);
  const [x, y] = fromAxis(s, cup.c + R * sn);
  return [x, y, R * cs];
}
const STEM_PATH = spline([[160, 272, 17], [140, 281, 17], [125, 283.5, 16], [110, 285, 15], [97, 285.5, 13.2], [88, 286.5, 10.5], [83, 287, 7.5]]);
function stemSurface(phi, t) {
  const p = STEM_PATH(t), q = STEM_PATH(Math.min(t + 0.01, 1)), o = STEM_PATH(Math.max(t - 0.01, 0));
  const tx = q[0] - o[0], ty = q[1] - o[1], l = Math.hypot(tx, ty) || 1, nx = ty / l, ny = -tx / l, cs = Math.cos(phi), sn = Math.sin(phi);
  const r = p[2] * (1 + 0.05 * Math.cos(6 * phi + 0.8) * smooth(1, 0.8, t) + 0.035 * noise(4 * cs + t * 6, 4 * sn - t * 5));
  const up = ny < 0 ? 1 : -1;
  return [p[0] + nx * up * r * sn, p[1] + ny * up * r * sn, r * cs];
}

// Atlas: body on top, sepals bottom left, stem bottom right -------------------------------
const AT = TEX / 2048;
const RECTS = { body: [8, 8, 2040, 1290], calyx: [8, 1300, 1500, 2040], stem: [1510, 1300, 2040, 2040] };
const inRect = (name, u, v) => { const [x0, y0, x1, y1] = RECTS[name]; return [(x0 + (x1 - x0) * u) / 2048, (y0 + (y1 - y0) * v) / 2048]; };

// Paint ---------------------------------------------------------------------------------
const C = Object.fromEntries(Object.entries({
  purple: '#2e1f38', warm: '#2d2023', low: '#2b2428', crimson: '#8c1f40', crimsonDeep: '#5c1a2e', neck: '#776d82', fleck: '#c9a24a', scratch: '#e6a8b8', spot: '#f4f0ea',
  sepal: '#bab252', sepalGreen: '#869020', sepalDark: '#525610', sepalPale: '#f0e8aa', sepalTan: '#9c7c3c', stem: '#8a9630', stemDark: '#566614', stemPale: '#e4deb0', cut: '#b08648',
}).map(([k, v]) => [k, hex(v)]));
const o = { r: 0, g: 0, b: 0, rough: 0.3, coat: 1, h: 0 };
const put = (c, t) => { o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; };
const set = c => { o.r = c[0]; o.g = c[1]; o.b = c[2]; };

// Small marks scattered by cell: returns 0..1 where a mark falls.
function flecks(x, y, cell, chance, seed) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell), r = n => { const h = Math.imul(cx * 73856093 ^ cy * 19349663 ^ (seed + n) * 83492791, 2654435761) >>> 0; return h / 4294967296; };
  if (r(0) > chance) return 0;
  const px = (cx + 0.2 + 0.6 * r(1)) * cell, py = (cy + 0.2 + 0.6 * r(2)) * cell, angle = r(3) * 0.7 - 0.35, dx = x - px, dy = y - py;
  const u = dx * Math.cos(angle) + dy * Math.sin(angle), v = -dx * Math.sin(angle) + dy * Math.cos(angle), len = 0.8 + r(4) * 2.6;
  return smooth(1, 0.4, Math.hypot(u / len, v / 0.8));
}

function paintBody(phi, s) {
  const [x, y, z] = bodySurface(phi, s), front = smooth(-0.15, 0.25, Math.cos(phi));
  set(mixC(C.purple, C.warm, smooth(340, 560, x)));
  put(C.low, 0.6 * smooth(240, 320, y));
  // The crimson bloom near the far end, seen through the skin.
  const [ps, pt] = toAxis(x, y), bloom = smooth(1.2, 0.2, Math.hypot((ps - 380) / 128, (pt - 100) / 40)) * front;
  put(C.crimsonDeep, 0.9 * bloom);
  put(C.crimson, 0.5 * smooth(0.2, 1, bloom));
  // Paler skin where the sepals have shaded it.
  put(C.neck, 0.8 * smooth(70, 10, s));
  o.rough = 0.36; o.coat = 1;
  const grain = fbm(s / 1.05, phi * 80, 2) * 0.7 + fbm(s / 3 + 9, phi * 30 - 4, 2) * 0.3;
  o.h = grain * mix(0.05, 0.13, smooth(130, 10, s));
  // Tan flecks toward the far end, a few pale scratches in the bloom, one white spot.
  const zone = front * smooth(520, 590, x) * smooth(100, 125, y) * smooth(205, 180, y);
  const f = flecks(x, y, 11, 0.5 * zone, 1) + flecks(x + 5, y + 3, 30, 0.05 * front, 2);
  put(C.fleck, clamp(f, 0, 1) * 0.92);
  const hairs = flecks(x * 0.42, y, 7, 0.45 * bloom, 3);
  put(C.scratch, hairs * 0.7);
  put(C.spot, front * smooth(2.4, 1, Math.hypot(x - 558, y - 174)));
  o.h += clamp(f + hairs, 0, 1) * 0.12;
}
function paintCalyx(phi, v) {
  const cs = Math.cos(phi), sn = Math.sin(phi), edge = tornEdge(phi), a = v * edge, toEdge = (1 - v) * edge, arc = phi * 70;
  const grain = 0.6 * noise(a / 1.3 + 3, arc / 1.3) + 0.4 * noise(a / 0.7 - 9, arc / 0.7 + 4), patch = fbm(a / 9 + 5 * cs, 6 * sn + 5 * cs, 3), band = noise(14 * cs + 3 + a / 13, 14 * sn - 2 - a / 15);
  set(C.sepal);
  put(C.sepalPale, 0.72 * smooth(-0.15, 0.45, grain + 0.9 * patch) * smooth(12, 30, a));
  put(C.sepalGreen, 0.9 * smooth(0.05, 0.55, band + 0.7 * grain));
  put(C.sepalDark, 0.75 * smooth(0.42, 0.85, band + 0.8 * grain - 0.3 * patch));
  put(C.sepalGreen, 0.5 * smooth(30, 6, a));
  put(C.sepalTan, 0.92 * smooth(6, 1.2, toEdge + 2.4 * grain));
  o.rough = 0.74; o.coat = 0.1;
  o.h = 0.55 * grain + 0.35 * band;
}
function paintStem(phi, t) {
  const cs = Math.cos(phi), sn = Math.sin(phi), arc = phi * 15, along = t * 80, grain = 0.6 * noise(along / 1.4 + 2, arc / 1.2) + 0.4 * noise(along / 0.7 - 6, arc / 0.7 + 3), band = noise(6 * cs + t * 3, 6 * sn - t * 4);
  set(C.stem);
  put(C.stemDark, 0.85 * smooth(0.02, 0.5, grain + 0.6 * band));
  put(C.stemPale, 0.92 * smooth(0.25, 0.8, sn + 0.35 * grain));
  put(C.cut, smooth(0.84, 0.95, t + 0.035 * grain));
  o.rough = 0.66; o.coat = 0.12;
  o.h = 0.42 * grain + 0.12 * band;
}

function bake() {
  const base = new Uint8Array(TEX * TEX * 3), coat = new Float32Array(TEX * TEX), rough = new Float32Array(TEX * TEX), height = new Float32Array(TEX * TEX);
  const inside = (name, i, j) => { const [x0, y0, x1, y1] = RECTS[name]; return i >= x0 * AT && i < x1 * AT && j >= y0 * AT && j < y1 * AT; };
  const rel = (name, i, j) => { const [x0, y0, x1, y1] = RECTS[name]; return [clamp((i + 0.5 - x0 * AT) / ((x1 - x0) * AT), 0, 1), clamp((j + 0.5 - y0 * AT) / ((y1 - y0) * AT), 0, 1)]; };
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const p = j * TEX + i;
    set([0.18, 0.13, 0.18]); o.rough = 0.4; o.coat = 1; o.h = 0;
    if (inside('body', i, j)) { const [u, v] = rel('body', i, j); paintBody(-Math.PI + u * 2 * Math.PI, mix(sMin, sMax, v)); }
    else if (inside('calyx', i, j)) { const [u, v] = rel('calyx', i, j); paintCalyx(-Math.PI + u * 2 * Math.PI, v); }
    else if (inside('stem', i, j)) { const [u, v] = rel('stem', i, j); paintStem(-Math.PI + u * 2 * Math.PI, v); }
    base[p * 3] = clamp(Math.round(o.r * 255), 0, 255); base[p * 3 + 1] = clamp(Math.round(o.g * 255), 0, 255); base[p * 3 + 2] = clamp(Math.round(o.b * 255), 0, 255);
    coat[p] = o.coat; rough[p] = o.rough; height[p] = o.h;
  }
  const scale = (i, j) => (j < 1295 * AT ? [0.263 / AT, 0.39 / AT] : i < 1505 * AT ? [0.295 / AT, 0.13 / AT] : [0.18 / AT, 0.11 / AT]);
  const normal = heightToNormal(TEX, height, scale);
  const half = TEX / 2, orm = new Uint8Array(half * half * 3);
  for (let j = 0; j < half; j++) for (let i = 0; i < half; i++) {
    let c = 0, g = 0;
    for (const q of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = (j * 2 + q[1]) * TEX + i * 2 + q[0]; c += coat[p]; g += rough[p]; }
    const p = (j * half + i) * 3;
    orm[p] = Math.round((c / 4) * 255); orm[p + 1] = Math.round((g / 4) * 255); orm[p + 2] = 0;
  }
  return { base, normal, orm, half };
}

// Mesh ----------------------------------------------------------------------------------
const mesh = new MeshBuilder();
const NA = WEB ? 72 : 128, NL = WEB ? 112 : 208;
mesh.loft({
  around: NA, along: NL, capStart: true, capEnd: true,
  point: (f, t) => {
    const s = mix(sMin, sMax, (1 - Math.cos(Math.PI * mix(0.004, 0.996, t))) / 2), [x, y, z] = bodySurface(-Math.PI + f * 2 * Math.PI, s);
    return place(x, y, z);
  },
  uv: (f, t) => inRect('body', f, (1 - Math.cos(Math.PI * mix(0.004, 0.996, t))) / 2),
});
const NC = WEB ? 132 : 240, NV = WEB ? 22 : 44;
mesh.loft({
  around: NC, along: NV * 2,
  point: (f, t) => {
    const phi = -Math.PI + f * 2 * Math.PI, inner = t > 0.5, v = inner ? 2 - 2 * t : 2 * t, [x, y, z] = calyxSurface(phi, v, inner);
    return place(x, y, z);
  },
  uv: (f, t) => inRect('calyx', f, t > 0.5 ? 2 - 2 * t : 2 * t),
});
mesh.loft({
  around: WEB ? 24 : 48, along: WEB ? 24 : 56, capEnd: true, flip: true,
  point: (f, t) => { const [x, y, z] = stemSurface(-Math.PI + f * 2 * Math.PI, t); return place(x, y, z); },
  uv: (f, t) => inRect('stem', f, t),
});

// Run -----------------------------------------------------------------------------------
const started = Date.now();
const { cos, sin, size, mid, extent } = levelAndFit([mesh], TILT_DEG);
const arrays = mesh.arrays(cos, sin, mid, size);
const { base, normal, orm, half } = bake();
const images = [
  { name: 'Eggplant colour', data: encodeJpeg(TEX, TEX, base, 92) },
  { name: 'Eggplant coat and roughness', data: encodeJpeg(half, half, orm, 88) },
  { name: 'Eggplant relief', data: encodeJpeg(TEX, TEX, normal, 94) },
];
if (DEBUG_DIR) { mkdirSync(DEBUG_DIR, { recursive: true }); ['base', 'orm', 'normal'].forEach((n, i) => writeFileSync(resolve(DEBUG_DIR, `egg-${n}.jpg`), images[i].data)); }
const tex = index => ({ index });
const glb = buildGlb({
  generator: 'Corn Land build-eggplant.mjs',
  extensionsUsed: ['KHR_materials_clearcoat', 'KHR_materials_ior'],
  sceneName: 'Eggplant',
  nodes: [{ name: 'Eggplant', mesh: 0, extras: { photoPxPerUnit: size, photoMid: mid, photoTiltDeg: TILT_DEG, photoWidth: PHOTO_W, photoHeight: PHOTO_H, photoOrigin: [CX, CY] } }],
  meshes: [{ name: 'Eggplant', primitives: [{ ...arrays, material: 0 }] }],
  materials: [{
    name: 'Eggplant skin',
    pbrMetallicRoughness: { baseColorTexture: tex(0), metallicFactor: 0, roughnessFactor: 1, metallicRoughnessTexture: tex(1) },
    normalTexture: { index: 2, scale: 1 },
    extensions: {
      KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatTexture: tex(1), clearcoatRoughnessFactor: 0.8, clearcoatRoughnessTexture: tex(1) },
      KHR_materials_ior: { ior: 1.5 },
    },
  }],
  images,
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(JSON.stringify({ out: OUT, MB: +(glb.length / 1048576).toFixed(2), vertices: mesh.count, triangles: mesh.idx.length / 3, extent, images: images.map(i => `${i.name} ${(i.data.length / 1024) | 0}KB`), seconds: (Date.now() - started) / 1000 }));
