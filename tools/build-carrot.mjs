// Builds assets/models/carrot.glb, a carrot modelled on a reference photo.
// The outline and furrows were traced from that photo, and the stems follow its layout; the
// leaves are grown by rule and every texture is painted here, so no photo pixels end up in
// the model. Needs only Node.
//   node tools/build-carrot.mjs [out.glb]      TEX=1024 gives a fast draft.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MeshBuilder, buildGlb, clamp, cross, encodeJpeg, fbm, heightToNormal, hex, levelAndFit, mix, noise, smooth, spline, toLinear, unit } from './model-kit.mjs';

const OUT = resolve(process.argv[2] ?? 'assets/models/carrot.glb');
const TEX = Number(process.env.TEX ?? 2048), WEB = process.env.QUALITY === 'web';
const DEBUG_DIR = process.env.DEBUG_TEX;

// Measurements from the photo, in its pixels (x right, y down) ---------------------------
const PHOTO_W = 1932, PHOTO_H = 1932, AXIS_DEG = 44.11, TILT_DEG = -AXIS_DEG, A = (AXIS_DEG * Math.PI) / 180;
const OX = 1273.5, OY = 1279.9, DX = Math.cos(A), DY = Math.sin(A), UX = Math.sin(A), UY = -Math.cos(A);
const toAxis = (x, y) => [(x - OX) * DX + (y - OY) * DY, (x - OX) * UX + (y - OY) * UY];
const fromAxis = (s, t) => [OX + s * DX + t * UX, OY + s * DY + t * UY];
// Half-widths of the root by distance along its axis: toward the upper right, toward the lower left.
const PROFILE = [[-519, 2, 2], [-512, 34, 30], [-500, 64, 58], [-480, 101, 93], [-460, 129, 122], [-440, 146, 142], [-420, 154, 152], [-400, 161, 160], [-380, 166, 164], [-360, 169, 168], [-340, 170, 171], [-320, 171, 173], [-300, 171, 174], [-280, 171, 174], [-260, 170, 174], [-240, 168, 174], [-220, 164, 174], [-200, 164, 172], [-180, 164, 170], [-160, 164, 168], [-140, 163, 166], [-120, 161, 163], [-100, 158, 159], [-80, 152, 155], [-60, 151, 150], [-40, 150, 150], [-20, 149, 148], [0, 146, 145], [20, 144, 143], [40, 141, 140], [60, 138, 137], [80, 138, 135], [100, 137, 133], [120, 135, 131], [140, 132, 126], [160, 127, 122], [180, 123, 116], [200, 118, 112], [220, 116, 106], [240, 113, 104], [260, 110, 104], [280, 106, 104], [300, 105, 102], [320, 103, 100], [340, 101, 98], [360, 98, 97], [380, 92, 96], [400, 92, 94], [420, 90, 90], [440, 88, 89], [460, 84, 88], [480, 81, 86], [500, 80, 82], [520, 79, 77], [540, 77, 74], [560, 71, 72], [580, 66, 69], [600, 63, 66], [620, 57, 60], [640, 47, 54], [660, 33, 41], [668, 23, 36], [691, 14.6, 26], [710, 11, 21], [730, 6.2, 15.5], [748, 5, 11.7], [770, 6, 5], [797, 8.8, -2], [809, 5.2, -4.8]];
const S_MIN = -519, S_MAX = 809;
const sectionTable = (() => {
  const n = S_MAX - S_MIN + 1, top = new Float64Array(n), bot = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = S_MIN + i; while (k < PROFILE.length - 2 && PROFILE[k + 1][0] <= s) k++;
    const p = PROFILE[k], q = PROFILE[k + 1], u = clamp((s - p[0]) / (q[0] - p[0]), 0, 1);
    top[i] = mix(p[1], q[1], u); bot[i] = -mix(p[2], q[2], u);
  }
  for (let pass = 0; pass < 2; pass++) for (const arr of [top, bot]) { const c = [...arr]; for (let i = 3; i < n - 3; i++) arr[i] = (c[i - 3] + c[i - 2] + c[i - 1] + c[i] + c[i + 1] + c[i + 2] + c[i + 3]) / 7; }
  return { top, bot };
})();
const section = s => {
  const q = clamp(s - S_MIN, 0, sectionTable.top.length - 1.001), i = Math.floor(q), f = q - i;
  const a = mix(sectionTable.top[i], sectionTable.top[i + 1], f), b = mix(sectionTable.bot[i], sectionTable.bot[i + 1], f);
  return { c: (a + b) / 2, r: Math.max((a - b) / 2, 0) };
};

// Furrows traced from the photo: [depth, width, ...x, y]. Each runs across the root.
const FURROWS = [
  [3.2, 4.5, 905, 1045, 930, 995, 970, 955, 1000, 937], [3.4, 4.5, 1080, 910, 1110, 925, 1145, 932],
  [2.8, 4.5, 1010, 1075, 1045, 1030, 1100, 995], [4.6, 5, 1075, 1042, 1120, 1020, 1165, 1002, 1220, 1000],
  [4.4, 5, 1059, 1158, 1083, 1126, 1119, 1100, 1183, 1053], [3.6, 4.5, 1146, 1153, 1188, 1121, 1230, 1103],
  [5, 5, 1206, 1311, 1240, 1258, 1262, 1237, 1293, 1216, 1325, 1205], [4.2, 4.5, 1198, 1258, 1225, 1221, 1277, 1168],
  [4.6, 5, 1330, 1300, 1367, 1274, 1398, 1261, 1446, 1268], [6.2, 6, 1380, 1473, 1413, 1434, 1441, 1398, 1497, 1382, 1533, 1382],
  [6, 6, 1463, 1562, 1486, 1529, 1508, 1501, 1558, 1468, 1597, 1468], [3.6, 4, 1580, 1540, 1624, 1534, 1655, 1534],
  [5.4, 5, 1574, 1660, 1647, 1607, 1674, 1618, 1716, 1615], [3.2, 3.5, 1605, 1695, 1624, 1665], [5, 5, 1691, 1707, 1724, 1684, 1763, 1679],
  [2.4, 3.5, 1020, 1200, 1030, 1220], [1.8, 4, 1296, 1437, 1309, 1389], [1.6, 4, 1114, 1305, 1119, 1326], [2.4, 3.5, 1493, 1601, 1500, 1585], [1.8, 4, 898, 1100, 905, 1045], [2, 4, 975, 1000, 1045, 950],
];

// Random numbers that come out the same on every build.
function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Root relief: one height field in (around, along), used by the mesh, the paint and the normal map.
const G = TEX, height = new Float32Array(G * G), cavity = new Float32Array(G * G);
const texelOf = (phi, s) => [(((phi + Math.PI) / (2 * Math.PI)) % 1 + 1) % 1 * G, ((s - S_MIN) / (S_MAX - S_MIN)) * G];
function addFurrow(points, depth, width) {
  // points: [s, phi]. Distances are measured on the surface, so widths stay true at every radius.
  const lens = []; let total = 0;
  for (let i = 1; i < points.length; i++) { const r = section(points[i][0]).r, l = Math.hypot(points[i][0] - points[i - 1][0], (points[i][1] - points[i - 1][1]) * r); lens.push(l); total += l; }
  let walked = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [s0, p0] = points[i], [s1, p1] = points[i + 1], steps = Math.max(1, Math.ceil(lens[i] / 2.2));
    for (let k = 0; k < steps; k++) {
      const u = (k + 0.5) / steps, s = mix(s0, s1, u), phi = mix(p0, p1, u), r = Math.max(section(s).r, 4), tau = (walked + u * lens[i]) / total, fade = Math.pow(Math.sin(Math.PI * clamp(tau, 0.01, 0.99)), 0.6);
      // Local frame: tangent, then the normal pointing toward the tip.
      let ts = s1 - s0, ta = (p1 - p0) * r; const tl = Math.hypot(ts, ta) || 1; ts /= tl; ta /= tl;
      let ns = ta, na = -ts; if (ns < 0) { ns = -ns; na = -na; }
      const radius = width * 10, gapS = radius / ((S_MAX - S_MIN) / G), gapF = radius / ((2 * Math.PI * r) / G), [cx, cy] = texelOf(phi, s), stepLen = lens[i] / steps;
      for (let j = Math.max(0, Math.floor(cy - gapS)); j <= Math.min(G - 1, Math.ceil(cy + gapS)); j++) for (let e = Math.floor(cx - gapF); e <= Math.ceil(cx + gapF); e++) {
        const q = ((e % G) + G) % G, p = j * G + q, dS = ((j + 0.5) / G) * (S_MAX - S_MIN) + S_MIN - s, dA = ((e + 0.5) / G - cx / G) * 2 * Math.PI * r;
        if (Math.abs(dS * ts + dA * ta) > stepLen * 0.6) continue;
        const d = dS * ns + dA * na, w = width * 1.5, slit = -1.7 * depth * Math.exp(-((d / (w * 0.75)) ** 2)), puff = 0.9 * depth * Math.exp(-(((d + 2.3 * w) / (2.3 * w)) ** 2)) + 0.55 * depth * Math.exp(-(((d - 2.6 * w) / (2.6 * w)) ** 2));
        const value = (slit + puff) * fade;
        if (Math.abs(value) > Math.abs(height[p])) height[p] = value;
        cavity[p] = Math.max(cavity[p], fade * fade * Math.exp(-((d / (width * 0.42)) ** 2)));
      }
    }
    walked += lens[i];
  }
}
for (const [depth, width, ...xy] of FURROWS) {
  const pts = [];
  for (let i = 0; i + 1 < xy.length; i += 2) {
    const [s, t] = toAxis(xy[i], xy[i + 1]), { c, r } = section(s);
    pts.push([s, Math.asin(clamp((t - c) / r, -0.97, 0.97))]);
  }
  addFurrow(pts, depth, width);
}
// The sides and back get their own furrows, in the same spirit.
{
  const rng = random(77);
  for (let k = 0; k < 44; k++) {
    const s = mix(-460, 640, rng()), start = mix(1.6, 4.1, rng()), span = Math.min(mix(0.5, 1.3, rng()), 4.7 - start), lean = (rng() - 0.5) * 60, pts = [];
    for (let i = 0; i < 4; i++) { const u = i / 3, phi = start + span * u; pts.push([s + lean * (u - 0.5) + 8 * Math.sin(u * 5 + k), phi > Math.PI ? phi - 2 * Math.PI : phi]); }
    // A run that would cross the seam at the back is left out.
    if (pts.some((p, i) => i && Math.abs(p[1] - pts[i - 1][1]) > 2)) continue;
    addFurrow(pts, mix(1.6, 4.6, rng()), mix(3.5, 5.5, rng()));
  }
}
// Soft version of the relief for the mesh; the sharp remainder goes in the normal map.
const soft = (() => {
  const out = Float32Array.from(height), tmp = new Float32Array(G * G), R = Math.max(1, Math.round((3 * G) / 2048));
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < G; j++) { let sum = 0; for (let i = -R; i <= R; i++) sum += out[j * G + ((i + G) % G)]; for (let i = 0; i < G; i++) { tmp[j * G + i] = sum / (2 * R + 1); sum += out[j * G + ((i + R + 1) % G)] - out[j * G + ((i - R + G) % G)]; } }
    for (let i = 0; i < G; i++) { let sum = 0; for (let j = -R; j <= R; j++) sum += tmp[clamp(j, 0, G - 1) * G + i]; for (let j = 0; j < G; j++) { out[j * G + i] = sum / (2 * R + 1); sum += tmp[clamp(j + R + 1, 0, G - 1) * G + i] - tmp[clamp(j - R, 0, G - 1) * G + i]; } }
  }
  return out;
})();
const sample = (field, phi, s) => {
  const [fx, fy] = texelOf(phi, s), x = fx - 0.5, y = clamp(fy - 0.5, 0, G - 1.001), i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j, i0 = ((i % G) + G) % G, i1 = (i0 + 1) % G;
  return mix(mix(field[j * G + i0], field[j * G + i1], tx), mix(field[(j + 1) * G + i0], field[(j + 1) * G + i1], tx), ty);
};

// Surfaces, as x right, y up, z toward the viewer.
const CX = 966, CY = 966;
const place = (x, y, z) => [x - CX, CY - y, z];
const lumps = (phi, s) => 1.8 * fbm(1.3 * Math.cos(phi) + s / 90 + 4, 1.3 * Math.sin(phi) - s / 110, 2) + 0.5 * noise(4 * Math.cos(phi) + s / 26, 4 * Math.sin(phi) - s / 30);
function rootSurface(phi, s) {
  const { c, r } = section(s), edge = smooth(0, 24, r), R = r + (sample(soft, phi, s) + lumps(phi, s)) * edge, [x, y] = fromAxis(s, c + R * Math.sin(phi));
  return [x, y, R * Math.cos(phi)];
}

// Paint the root --------------------------------------------------------------------------
const C = Object.fromEntries(Object.entries({
  orange: '#f55a02', light: '#fd8222', deep: '#e24a00', slit: '#c23e02', pore: '#ffa864', scuff: '#e8a080', crownSpeck: '#8a6a30', tail: '#b6cf3c', tailPale: '#d6e66c', tailDark: '#7f9c24',
}).map(([k, v]) => [k, hex(v)]));
const o = { r: 0, g: 0, b: 0 };
const put = (c, t) => { o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; };
function flecks(x, y, cell, chance, seed, size) {
  const cx = Math.floor(x / cell), cy = Math.floor(y / cell), r = n => (Math.imul(cx * 73856093 ^ cy * 19349663 ^ (seed + n) * 83492791, 2654435761) >>> 0) / 4294967296;
  if (r(0) > chance) return 0;
  return smooth(1, 0.35, Math.hypot(x - (cx + 0.2 + 0.6 * r(1)) * cell, (y - (cy + 0.2 + 0.6 * r(2)) * cell) * 1.6) / size);
}
function bakeRoot() {
  const base = new Uint8Array(G * G * 3), rough = new Float32Array(G * G), coat = new Float32Array(G * G), fine = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const p = j * G + i, phi = -Math.PI + ((i + 0.5) / G) * 2 * Math.PI, s = S_MIN + ((j + 0.5) / G) * (S_MAX - S_MIN), { r, c } = section(s), arc = phi * Math.max(r, 40), cs = Math.cos(phi), sn = Math.sin(phi);
    const cloud = fbm(cs * 1.6 + s / 70 + 2, sn * 1.6 - s / 80 + 5, 3), rings = noise(s / 3.1 + 7, arc / 34) * 0.6 + noise(s / 1.6 - 3, arc / 16) * 0.4, grain = fbm(s / 1.3, arc / 1.3, 2), pores = flecks(s, arc, 15, 0.35, 1, 1.4);
    o.r = C.orange[0]; o.g = C.orange[1]; o.b = C.orange[2];
    put(C.deep, 0.55 * smooth(-0.05, 0.35, cloud));
    put(C.light, 0.5 * smooth(-0.35, 0.02, cloud));
    put(C.light, 0.4 * smooth(0.3, 2.2, height[p]));
    put(C.slit, 0.6 * smooth(0.35, 0.95, cavity[p]));
    put(C.deep, 0.14 * smooth(-0.3, -1.2, height[p]));
    put(C.pore, 0.55 * pores);
    put(C.slit, 0.5 * flecks(s + 4, arc * 0.4, 22, 0.18, 2, 1.8));
    // Pale rubbed patches low on the side that faces the photo.
    const [x, y] = fromAxis(s, c + r * sn), front = smooth(-0.1, 0.2, cs);
    put(C.scuff, 0.65 * front * smooth(1, 0.2, Math.hypot((x - 972) / 22, (y - 1160) / 42) + 0.55 * noise(x / 6, y / 6)));
    put(C.scuff, 0.34 * front * smooth(1, 0.2, Math.hypot((x - 1150) / 80, (y - 1330) / 34) + 0.6 * fbm(x / 14, y / 14, 2)));
    // Crown: paler, with a ring of small dry specks where the stems leave.
    put(C.light, 0.4 * smooth(-440, -505, s));
    put(C.crownSpeck, 0.85 * smooth(-497, -512, s) * smooth(-0.1, 0.5, noise(s / 2.2, arc / 2.4 + 3)));
    // The tail is its own colour, starting on a slant with a dark seam.
    const seam = 652 + 26 * -sn + 5 * noise(arc / 10, 2);
    put(C.tailDark, 0.75 * smooth(5, 1, Math.abs(s - seam)));
    const tail = smooth(seam - 1.8, seam + 1.8, s);
    put(C.tail, tail);
    put(C.tailPale, tail * 0.75 * smooth(-0.2, 0.7, sn));
    rough[p] = mix(0.52, 0.62, cavity[p]) + 0.05 * grain; coat[p] = mix(0.16, 0.05, cavity[p]);
    fine[p] = (height[p] - soft[p]) * 0.9 + 0.11 * rings + 0.05 * grain + 0.2 * pores;
    base[p * 3] = clamp(Math.round(o.r * 255), 0, 255); base[p * 3 + 1] = clamp(Math.round(o.g * 255), 0, 255); base[p * 3 + 2] = clamp(Math.round(o.b * 255), 0, 255);
  }
  const normal = heightToNormal(G, fine, () => [(2 * Math.PI * 120) / G, (S_MAX - S_MIN) / G]);
  const half = G / 2, orm = new Uint8Array(half * half * 3);
  for (let j = 0; j < half; j++) for (let i = 0; i < half; i++) {
    let a = 0, g = 0;
    for (const q of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = (j * 2 + q[1]) * G + i * 2 + q[0]; a += coat[p]; g += rough[p]; }
    const p = (j * half + i) * 3;
    orm[p] = Math.round((a / 4) * 255); orm[p + 1] = Math.round((g / 4) * 255); orm[p + 2] = 0;
  }
  return { base, normal, orm, half };
}

// Greens ---------------------------------------------------------------------------------
const linear = s => hex(s).map(toLinear);
const TONES = { light: linear('#94bb2c'), mid: linear('#6f9c1a'), dark: linear('#4a7a0e') };
const STEM = { pale: linear('#dcec7c'), young: linear('#bedd3c'), green: linear('#8dba28'), deep: linear('#5f9016'), cream: linear('#ece8a0'), tan: linear('#b89c5c') };
const blendL = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

// Each stem follows the photo: [x, y, depth, half-width] from the crown out to the blade's tip.
const FRONDS = [
  { path: [[957, 927, 4, 15], [905, 868, 8, 25], [860, 790, 6, 24], [790, 700, 0, 21], [720, 600, -6, 18], [660, 510, -10, 14], [620, 440, -12, 10], [596, 350, -12, 7], [580, 240, -10, 4], [572, 130, -6, 2.4], [578, 72, -4, 1.2]], blade: 0.44, pinnae: 8, len: 205, tone: 'mid', roll: 0.2 },
  { path: [[971, 913, -8, 12], [925, 858, -6, 20], [880, 800, -10, 18], [820, 700, -14, 15], [780, 610, -12, 12], [760, 540, -8, 9], [775, 470, 0, 6], [815, 400, 6, 4], [870, 330, 10, 2.6], [922, 278, 12, 1.2]], blade: 0.56, pinnae: 5, len: 112, tone: 'light', roll: -0.3 },
  { path: [[940, 945, 12, 18], [880, 885, 28, 30], [810, 850, 34, 28], [740, 780, 34, 24], [660, 690, 30, 19], [590, 600, 26, 14], [520, 530, 22, 10], [440, 470, 18, 7], [340, 410, 14, 4], [205, 370, 10, 1.2]], blade: 0.54, pinnae: 7, len: 170, tone: 'light', roll: 0.25 },
  { path: [[923, 963, 8, 13], [870, 925, 14, 22], [790, 875, 18, 20], [680, 800, 18, 17], [560, 715, 14, 13], [470, 655, 10, 10], [400, 610, 8, 7], [340, 560, 6, 4], [290, 525, 4, 1.2]], blade: 0.6, pinnae: 5, len: 130, tone: 'mid', roll: -0.2 },
  { path: [[909, 977, 12, 15], [850, 945, 20, 26], [780, 905, 24, 24], [680, 850, 22, 20], [580, 785, 18, 15], [470, 690, 14, 11], [360, 620, 10, 7], [280, 570, 6, 4], [180, 520, 3, 2.4], [58, 455, 0, 1]], blade: 0.62, pinnae: 6, len: 140, tone: 'mid', roll: 0.15 },
  { path: [[600, 795, 6, 7], [500, 772, 2, 5], [410, 766, 0, 3], [290, 786, -2, 1]], blade: 0.2, pinnae: 5, len: 74, tone: 'dark', roll: 0.35 },
  { path: [[945, 930, -14, 9], [905, 900, -24, 14], [790, 770, -28, 13], [690, 670, -30, 11], [600, 570, -30, 9], [520, 470, -28, 6], [470, 400, -26, 3], [420, 340, -24, 1]], blade: 0.46, pinnae: 7, len: 165, tone: 'dark', roll: -0.35 },
  { path: [[950, 925, -18, 9], [915, 890, -30, 14], [820, 760, -36, 12], [740, 620, -38, 10], [700, 500, -38, 7], [690, 400, -36, 4], [700, 290, -32, 2.4], [740, 200, -30, 1]], blade: 0.52, pinnae: 6, len: 140, tone: 'light', roll: 0.3 },
  { path: [[935, 945, -8, 8], [890, 925, -14, 12], [760, 820, -18, 11], [640, 730, -22, 9], [540, 660, -26, 6], [450, 600, -24, 3], [360, 640, -22, 1]], blade: 0.56, pinnae: 5, len: 120, tone: 'dark', roll: -0.15 },
  { path: [[955, 925, -22, 8], [925, 890, -40, 12], [830, 740, -44, 10], [760, 610, -44, 8], [690, 540, -40, 5], [620, 480, -36, 3], [540, 420, -32, 1]], blade: 0.56, pinnae: 5, len: 125, tone: 'dark', roll: 0.4 },
  { path: [[940, 935, -10, 8], [800, 800, -30, 9], [680, 700, -36, 7], [600, 640, -38, 4], [520, 620, -36, 1]], blade: 0.42, pinnae: 6, len: 135, tone: 'dark', roll: 0.1 },
  { path: [[945, 930, -20, 8], [820, 790, -40, 8], [720, 680, -44, 6], [640, 580, -44, 3], [600, 470, -40, 1]], blade: 0.42, pinnae: 6, len: 145, tone: 'dark', roll: -0.25 },
];

const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const rotateAbout = (v, axis, angle) => {
  const c = Math.cos(angle), s = Math.sin(angle), d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2], x = cross(axis, v);
  return [v[0] * c + x[0] * s + axis[0] * d * (1 - c), v[1] * c + x[1] * s + axis[1] * d * (1 - c), v[2] * c + x[2] * s + axis[2] * d * (1 - c)];
};

// One flat, toothed lobe: three vertices per station (edge, midrib, edge).
function lobe(mesh, origin, dir, normal, length, halfWidth, tone, rng, curl) {
  const stations = WEB ? 7 : 9, side = unit(cross(normal, dir)), shade = 0.86 + rng() * 0.3, start = mesh.count, tips = 0.1 + rng() * 0.2, rows = [];
  let p = origin, d = dir;
  for (let k = 0; k < stations; k++) {
    const t = k / (stations - 1), tooth = k % 2 ? 1 : 0.42, w = k === stations - 1 ? 0 : halfWidth * Math.pow(Math.sin(Math.PI * Math.pow(mix(0.03, 0.97, t), 0.72)), 0.85) * tooth, lift = w * 0.3;
    rows.push([add(add(p, side, -w), normal, lift), p, add(add(p, side, w), normal, lift), t]);
    d = unit(rotateAbout(d, normal, curl / stations));
    p = add(p, d, length / (stations - 1));
  }
  const colour = (t, mid) => {
    let c = [tone[0] * shade, tone[1] * shade, tone[2] * shade];
    c = blendL(c, TONES.light, t * tips * 1.6);
    return mid ? blendL(c, STEM.young, 0.42) : c;
  };
  for (const [a, b, c, t] of rows) {
    mesh.vertex(a, normal, null, colour(t, false));
    mesh.vertex(b, normal, null, colour(t, true));
    mesh.vertex(c, normal, null, colour(t, false));
  }
  for (let k = 0; k < stations - 1; k++) {
    const q = start + k * 3, r = q + 3;
    mesh.idx.push(q, r, r + 1, q, r + 1, q + 1, q + 1, r + 1, r + 2, q + 1, r + 2, q + 2);
  }
}
function tube(mesh, pts, widths, colourAt, sides) {
  const P = spline(pts.map((p, i) => [...p, widths[i]]));
  mesh.loft({
    around: sides, along: Math.max(6, pts.length * (WEB ? 3 : 4)), capEnd: true,
    point: (f, t) => {
      const q = P(t), a = P(Math.max(t - 0.01, 0)), b = P(Math.min(t + 0.01, 1)), T = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), side = unit(cross(T, Math.abs(T[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])), up = cross(side, T), phi = f * 2 * Math.PI, r = q[3] * (1 + 0.1 * Math.cos(5 * phi) * smooth(0, 0.1, t));
      return [q[0] + (side[0] * Math.cos(phi) + up[0] * Math.sin(phi)) * r, q[1] + (side[1] * Math.cos(phi) + up[1] * Math.sin(phi)) * r, q[2] + (side[2] * Math.cos(phi) + up[2] * Math.sin(phi)) * r];
    },
    color: colourAt,
  });
}
function growFrond(mesh, spec, seed) {
  // Depth grows toward the blade, so the bunch is bushy from the side but unchanged from the front.
  const rng = random(seed), path = spec.path.map(([x, y, z], i) => place(x, y, z * (1 + 2.6 * (i / (spec.path.length - 1)) ** 1.4))), widths = spec.path.map(p => p[3]), P = spline(path.map((p, i) => [...p, widths[i]])), tone = TONES[spec.tone];
  // The stem: cream at the crown, pale along its length, ribbed, green as it nears the blade.
  tube(mesh, path, widths, (f, t) => {
    const rib = 0.5 + 0.5 * Math.cos(5 * f * 2 * Math.PI + seed), streak = 0.5 + 0.5 * noise(f * 40 + seed, t * 6);
    let c = blendL(STEM.young, STEM.pale, 0.55 * rib);
    c = blendL(c, STEM.green, smooth(0.34, 0.85, t) * (0.72 + 0.28 * streak));
    c = blendL(c, STEM.deep, 0.5 * smooth(0.55, 1, t) * (1 - rib * 0.6));
    c = blendL(c, tone, smooth(0.8, 1, t) * 0.6);
    return blendL(c, STEM.cream, smooth(0.12, 0.02, t));
  }, WEB ? 12 : 20);
  for (let k = 0; k < spec.pinnae * 2; k++) {
    const u = spec.blade + (1 - spec.blade) * ((k + 0.6) / (spec.pinnae * 2 + 0.4)), sideSign = k % 2 ? 1 : -1, q = P(u), a = P(Math.max(u - 0.01, 0)), b = P(Math.min(u + 0.01, 1)), T = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const baseNormal = rotateAbout([0, 0, 1], T, spec.roll + (rng() - 0.5) * 0.7 + Math.sin(u * 7 + seed) * 0.25), W = unit(cross(baseNormal, T));
    const rel = (u - spec.blade) / (1 - spec.blade), shape = Math.pow(Math.sin(Math.PI * Math.pow(clamp(rel, 0.02, 0.98), 0.55)), 0.75) * (1 - 0.22 * rel);
    const L = spec.len * shape * (0.82 + rng() * 0.36), angle = mix(0.98, 0.5, rel) + (rng() - 0.5) * 0.14;
    const dir = unit(add(unit(add([T[0] * Math.cos(angle), T[1] * Math.cos(angle), T[2] * Math.cos(angle)], W, sideSign * Math.sin(angle))), baseNormal, -0.08 + rng() * 0.16));
    // The pinna: a thin stalk with toothed lobes down both sides.
    const stalk = [], stations = 6, bend = -sideSign * (0.24 + rng() * 0.2); let p = [q[0], q[1], q[2]], d = dir;
    for (let i = 0; i < stations; i++) { stalk.push(p); d = unit(rotateAbout(d, baseNormal, bend / stations)); p = add(p, d, L / (stations - 1)); }
    const stalkPath = spline(stalk);
    tube(mesh, stalk, stalk.map((_, i) => mix(Math.min(q[3] * 0.34, 3.2), 0.7, i / (stations - 1))), () => blendL(tone, STEM.young, 0.55), 3);
    const lobes = clamp(Math.round(L / 25), 2, 7);
    for (let n = 0; n < lobes * 2; n++) {
      const w = 0.1 + 0.88 * ((n + 0.5) / (lobes * 2)), side = n % 2 ? 1 : -1, at = stalkPath(w), ahead = stalkPath(Math.min(w + 0.04, 1)), back = stalkPath(Math.max(w - 0.04, 0)), axis = unit([ahead[0] - back[0], ahead[1] - back[1], ahead[2] - back[2]]);
      const off = unit(cross(baseNormal, axis)), ang = 0.92 - 0.36 * w + (rng() - 0.5) * 0.2, lobeDir = unit(add([axis[0] * Math.cos(ang), axis[1] * Math.cos(ang), axis[2] * Math.cos(ang)], off, side * Math.sin(ang)));
      const lobeLen = L * (0.42 * Math.pow(1 - w, 0.7) + 0.12) * (0.82 + rng() * 0.36);
      lobe(mesh, at, lobeDir, unit(add(baseNormal, axis, (rng() - 0.5) * 0.5)), lobeLen, clamp(lobeLen * 0.25, 3, 13), tone, rng, -side * 0.5);
    }
    // The pinna ends in one longer lobe.
    const end = stalkPath(1), near = stalkPath(0.9), last = unit([end[0] - near[0], end[1] - near[1], end[2] - near[2]]);
    lobe(mesh, end, last, baseNormal, L * 0.24, clamp(L * 0.07, 3, 12), tone, rng, 0);
  }
  // And the whole blade ends in a small leaf of its own.
  const tip = P(1), prev = P(0.97), last = unit([tip[0] - prev[0], tip[1] - prev[1], tip[2] - prev[2]]);
  lobe(mesh, [tip[0], tip[1], tip[2]], last, [0, 0, 1], spec.len * 0.16, clamp(spec.len * 0.05, 3, 9), tone, rng, 0);
}

// Run ------------------------------------------------------------------------------------
const started = Date.now();
const root = new MeshBuilder(), greens = new MeshBuilder();
// Rings bunch up a little toward the ends, where the outline turns fastest.
const ringT = t => mix(t, (1 - Math.cos(Math.PI * t)) / 2, 0.35);
root.loft({
  around: WEB ? 84 : 144, along: WEB ? 190 : 340, capStart: true, capEnd: true,
  point: (f, t) => { const [x, y, z] = rootSurface(-Math.PI + f * 2 * Math.PI, mix(S_MIN + 0.5, S_MAX - 0.5, ringT(t))); return place(x, y, z); },
  uv: (f, t) => [(1 + f * (G - 2)) / G, (1 + ringT(t) * (G - 2)) / G],
});
FRONDS.forEach((spec, i) => growFrond(greens, spec, 1000 + i * 37));
tube(greens, [[948, 952, 0], [908, 908, 4], [872, 874, 8], [842, 848, 12]].map(([x, y, z]) => place(x, y, z)), [50, 44, 28, 7], (f, t) => {
  const streak = smooth(0.1, 0.5, noise(f * 18 + 3, t * 4 + 1));
  return blendL(blendL(STEM.cream, STEM.pale, smooth(0.35, 1, t)), STEM.tan, 0.75 * streak * smooth(0.3, 0.6, t) * smooth(0.95, 0.7, t));
}, 28);

const { cos, sin, size, mid, extent } = levelAndFit([root, greens], TILT_DEG);
const rootArrays = root.arrays(cos, sin, mid, size), greenArrays = greens.arrays(cos, sin, mid, size);
const { base, normal, orm, half } = bakeRoot();
const images = [
  { name: 'Carrot colour', data: encodeJpeg(G, G, base, 90) },
  { name: 'Carrot coat and roughness', data: encodeJpeg(half, half, orm, 86) },
  { name: 'Carrot relief', data: encodeJpeg(G, G, normal, 92) },
];
if (DEBUG_DIR) { mkdirSync(DEBUG_DIR, { recursive: true }); ['base', 'orm', 'normal'].forEach((n, i) => writeFileSync(resolve(DEBUG_DIR, `carrot-${n}.jpg`), images[i].data)); }
const tex = index => ({ index });
const glb = buildGlb({
  generator: 'Corn Land build-carrot.mjs',
  extensionsUsed: ['KHR_materials_clearcoat', 'KHR_materials_ior'],
  sceneName: 'Carrot',
  nodes: [{ name: 'Carrot', mesh: 0, extras: { photoPxPerUnit: size, photoMid: mid, photoTiltDeg: TILT_DEG, photoWidth: PHOTO_W, photoHeight: PHOTO_H, photoOrigin: [CX, CY] } }],
  meshes: [{ name: 'Carrot', primitives: [{ ...rootArrays, material: 0 }, { ...greenArrays, material: 1 }] }],
  materials: [
    {
      name: 'Carrot skin',
      pbrMetallicRoughness: { baseColorTexture: tex(0), metallicFactor: 0, roughnessFactor: 1, metallicRoughnessTexture: tex(1) },
      normalTexture: { index: 2, scale: 1 },
      extensions: {
        KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatTexture: tex(1), clearcoatRoughnessFactor: 0.6, clearcoatRoughnessTexture: tex(1) },
        KHR_materials_ior: { ior: 1.42 },
      },
    },
    { name: 'Carrot greens', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.5 }, doubleSided: true },
  ],
  images,
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(JSON.stringify({ out: OUT, MB: +(glb.length / 1048576).toFixed(2), rootVerts: root.count, rootTris: root.idx.length / 3, greenVerts: greens.count, greenTris: greens.idx.length / 3, extent, images: images.map(i => `${i.name} ${(i.data.length / 1024) | 0}KB`), seconds: (Date.now() - started) / 1000 }));
