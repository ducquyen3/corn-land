// Builds assets/models/corn-kernel.glb, a corn kernel modelled on a reference photo.
// The outline and palette were measured from that photo; every texture is painted here,
// so no photo pixels end up in the model. Needs only Node.
//   node tools/build-kernel.mjs [out.glb]      TEX=1024 gives a fast draft.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildGlb, clamp, cross, encodeJpeg, fbm, fibres, field, hex, mix, mixC, noise, smooth, unit } from './model-kit.mjs';

const OUT = resolve(process.argv[2] ?? 'assets/models/corn-kernel.glb');
const TEX = Number(process.env.TEX ?? 2048), WEB = process.env.QUALITY === 'web';
const DEBUG_DIR = process.env.DEBUG_TEX;

// Measurements from the photo, in its pixels (x right, y down) ---------------------------
const CX = 204.34, CY = 172.11, TILT_DEG = 6, TILT = (TILT_DEG * Math.PI) / 180;
// Radius of the outline about (CX, CY) every 3 degrees, counter-clockwise from +x.
const RADII = [202.8, 215.4, 229.2, 232.5, 227.2, 218.8, 211.1, 205.4, 199.1, 192, 183.8, 178, 174.1, 170.4, 166.6, 162.6, 158.3, 154.2, 150.4, 147, 143.8, 140.9, 138.4, 135.7, 133.9, 132.1, 130.4, 129.1, 128, 127.3, 126.5, 126.1, 126.1, 126.2, 126.7, 127.5, 128.5, 129.9, 131.7, 133.8, 136.1, 139, 142.5, 146.2, 150.2, 154.9, 160.2, 166.1, 171.6, 177.1, 182.2, 185.4, 187.7, 189.4, 190.3, 190.7, 190.1, 189, 187.8, 186.7, 185.7, 184.8, 184, 183.4, 183.1, 183.2, 183.4, 183.9, 184.8, 185.5, 187.2, 188.2, 190.1, 189.9, 189.5, 188.9, 187.2, 184.1, 178.7, 173.6, 168.3, 162.6, 157.4, 154.4, 148, 143.3, 140.3, 137.8, 135.3, 131.9, 129.8, 128.1, 126.8, 125.3, 125, 124.4, 124.5, 124.1, 124.9, 125.2, 126, 126.9, 128.3, 130.3, 132.5, 135.5, 138, 142, 145.3, 149.3, 154.1, 158.8, 163.2, 169.5, 176.6, 182, 185.4, 188.1, 191.5, 196.1];
// The tip cap is its own shell, so the body closes with a straight end hidden inside it.
{
  const [ax, ay, bx, by] = [375.4, 84.9, 397, 187];
  for (const k of [119, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const t = (k * 3 * Math.PI) / 180, dx = Math.cos(t), dy = -Math.sin(t), ex = bx - ax, ey = by - ay;
    RADII[k] = ((ax - CX) * ey - (ay - CY) * ex) / (dx * ey - dy * ex);
  }
}
for (let pass = 0; pass < 2; pass++) {
  const copy = [...RADII], m = copy.length;
  copy.forEach((_, k) => { RADII[k] = (copy[(k - 1 + m) % m] + 2 * copy[k] + copy[(k + 1) % m]) / 4; });
}
const RADIUS_LUT = (() => {
  const n = 2048, out = new Float64Array(n + 1), m = RADII.length;
  for (let i = 0; i <= n; i++) {
    const f = (i / n) * m, k = Math.floor(f), t = f - k, a = RADII[(k - 1 + m) % m], b = RADII[k % m], c = RADII[(k + 1) % m], d = RADII[(k + 2) % m];
    out[i] = 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  }
  return out;
})();
const outline = theta => {
  const f = (((theta / (2 * Math.PI)) % 1 + 1) % 1) * 2048, k = Math.floor(f);
  return mix(RADIUS_LUT[k], RADIUS_LUT[k + 1], f - k);
};

// Top and bottom of the tip cap by column; the first rows sit hidden inside the body.
const CAP_TABLE = [[352, 88, 160], [361, 85, 170], [367, 84.5, 176], [373, 84.5, 180], [379, 86.5, 184], [385, 91, 189], [391, 95, 193], [394, 97, 191], [397, 99.5, 187], [400, 103, 182], [403, 106, 177.5], [406, 108.7, 173.5], [409, 111, 170], [412, 113.5, 168], [415, 116, 165.5], [418, 118.3, 162], [421, 120.7, 159.5], [424, 123, 157.5], [427, 125.3, 155], [430, 128, 152], [433, 132.5, 149]];
const CAP_START = 352, CAP_NECK = 428, CAP_END = 436.8, CAP_PHI0 = -Math.PI / 2;
const capTop = new Float64Array(100), capBot = new Float64Array(100);
{
  const sample = (x, col) => {
    let i = 0; while (i < CAP_TABLE.length - 2 && CAP_TABLE[i + 1][0] <= x) i++;
    const a = CAP_TABLE[i], b = CAP_TABLE[i + 1];
    return mix(a[col], b[col], clamp((x - a[0]) / (b[0] - a[0]), 0, 1));
  };
  const raw = col => Array.from({ length: 100 }, (_, i) => sample(CAP_START + i, col));
  const soften = a => a.map((_, i) => { let s = 0; for (let j = -2; j <= 2; j++) s += a[clamp(i + j, 0, a.length - 1)]; return s / 5; });
  soften(raw(1)).forEach((v, i) => { capTop[i] = v; });
  soften(raw(2)).forEach((v, i) => { capBot[i] = v; });
}
function capSection(x) {
  const q = clamp(x, CAP_START, CAP_NECK) - CAP_START, i = Math.min(98, Math.floor(q)), f = q - i;
  const top = mix(capTop[i], capTop[i + 1], f), bot = mix(capBot[i], capBot[i + 1], f);
  const c = (top + bot) / 2; let a = (bot - top) / 2;
  if (x > CAP_NECK) { const v = Math.max(0, CAP_END - x); a = Math.sqrt(17.96 * v + 0.491 * v * v); }
  return { c, a };
}

// Shapes painted and carved on the germ side, from hand-placed points on the photo.
const SCOOP = field([[74, 168], [92, 132], [118, 114], [157, 109], [210, 100], [267, 96], [310, 95], [358, 94], [380, 100], [384, 160], [380, 205], [340, 224], [300, 240], [250, 252], [200, 254], [150, 242], [105, 212]]);
const GERM = field([[143, 217], [165, 205], [195, 195], [222, 175], [245, 158], [266, 150], [285, 146], [310, 146], [337, 147], [362, 149], [376, 160], [376, 188], [345, 198], [317, 210], [292, 220], [267, 227], [240, 232], [213, 235], [180, 233]]);
const TONGUE = field([[338, 146], [337, 155], [333, 163], [326, 173], [322, 180], [330, 186], [346, 187], [374, 186], [378, 165], [374, 146]]);
const SHEEN = field([[56, 132], [68, 104], [100, 86], [147, 76], [213, 66], [267, 59], [300, 62], [333, 72], [376, 88], [382, 104], [340, 112], [267, 112], [205, 118], [150, 124], [110, 134], [78, 150]]);
const creaseY = x => (x < 315 ? mix(133, 131, clamp((x - 268) / 47, 0, 1)) : x < 340 ? mix(131, 133.5, (x - 315) / 25) : x < 358 ? mix(133.5, 136, (x - 340) / 18) : mix(136, 138, clamp((x - 358) / 12, 0, 1)));

// Surfaces, in photo pixels with z toward the viewer -------------------------------------
const DOME = 2.8, FRONT_HEIGHT = 68, BACK_HEIGHT = 82;
const taper = x => 1 - 0.38 * smooth(200, 395, x);
const bend = (x, y) => 5.5 * ((x - 205) / 200) ** 2 - 1.5 * ((y - 175) / 130) ** 2;

function frontRelief(x, y) {
  const sd = SCOOP(x, y);
  const width = Math.max(mix(9, 44, smooth(104, 190, y)), mix(58, 9, smooth(72, 150, x)), mix(9, 34, smooth(262, 340, x)));
  const depth = 8 * smooth(78, 190, x) * (1 - 0.7 * smooth(300, 376, x));
  let z = -depth * smooth(0, width, -sd);
  // The crease that runs into the tip cap, sharper on its lower side.
  const dy = y - creaseY(x), w = mix(11, 6, smooth(290, 365, x)) * (dy > 0 ? 0.9 : 1);
  z -= 2.2 * smooth(262, 305, x) * Math.exp(-((dy / w) ** 2));
  return z + 0.8 * fbm(x / 64 + 3, y / 64 - 5, 2);
}
const backRelief = (x, y) => 1.1 * fbm(x / 78 - 11, y / 78 + 4, 2);
const rimFade = rho => smooth(1, 0.84, rho);

function surfaceZ(x, y, rho, env, front) {
  const z = front
    ? FRONT_HEIGHT * taper(x) * env + frontRelief(x, y) * rimFade(rho) + bend(x, y)
    : -BACK_HEIGHT * taper(x) * env + backRelief(x, y) * rimFade(rho) + bend(x, y);
  const cap = capSkinZ(x, y, front);
  if (cap === null) return z;
  const { c, a } = capSection(x), gap = Math.max(front ? z - cap : cap - z, 0);
  return z + (front ? 1 : -1) * 3.4 * Math.exp(-gap / 5.5) * smooth(1, 0.7, Math.abs((y - c) / a)) * smooth(352, 362, x);
}
function bodyPoint(theta, alpha, p) {
  const s = Math.abs(Math.sin(alpha)), c = Math.cos(alpha), rho = Math.pow(s, 2 / DOME), r = rho * outline(theta);
  const x = CX + r * Math.cos(theta), y = CY - r * Math.sin(theta);
  p[0] = x - CX; p[1] = CY - y; p[2] = surfaceZ(x, y, rho, Math.abs(c), c >= 0);
}

// The cap: a wrinkled, flattened cone. t runs from its hidden base to the very end.
const capX = t => CAP_START + (CAP_END - CAP_START) * (1 - Math.pow(1 - t, 1.8));
const capDepth = x => mix(0.5, 0.86, smooth(372, 432, x)) + 0.09 * Math.exp(-(((x - 392) / 13) ** 2));
const capFold = (phi, t) => {
  const c = Math.cos(phi), s = Math.sin(phi);
  return 0.55 * noise(2.6 * c + 5 + 2.2 * t, 2.6 * s - 3 - 1.6 * t) + 0.3 * noise(5.5 * c - 8 - 4.5 * t, 5.5 * s + 2 + 3.5 * t) + 0.28 * (1 - t) * noise(15 * c + 4 + 10 * t, 15 * s - 7 - 9 * t);
};
const capFoldAmount = t => 0.12 * Math.pow(1 - t, 0.8) * smooth(0, 0.16, t);
function capPoint(phi, t, p) {
  t = clamp(t, 0, 1);
  const x = capX(t), { c, a } = capSection(x), r = 1 + capFoldAmount(t) * capFold(phi, t);
  p[0] = x - CX; p[1] = CY - c + a * Math.cos(phi) * r; p[2] = a * capDepth(x) * Math.sin(phi) * r + bend(x, c);
}
// Height of the cap above the body's skin at a point; zero traces the collar line.
function capAboveBody(x, y, z) {
  const dx = x - CX, dy = CY - y, r = Math.hypot(dx, dy), rho = r / outline(Math.atan2(dy, dx));
  if (rho >= 1) return 40;
  const env = Math.sqrt(Math.max(0, 1 - Math.pow(rho, DOME)));
  return z >= bend(x, y) ? z - surfaceZ(x, y, rho, env, true) : surfaceZ(x, y, rho, env, false) - z;
}
function capSkinZ(x, y, front) {
  if (x < CAP_START || x > CAP_END) return null;
  const { c, a } = capSection(x), v = (y - c) / a;
  if (Math.abs(v) >= 1) return null;
  const h = a * capDepth(x) * Math.sqrt(1 - v * v);
  return front ? h + bend(x, c) : -h + bend(x, c);
}

// Atlas: germ side on top, back below, cap in the strip on the right ----------------------
const AT = TEX / 2048;
const PX_LEFT = 12, PX_TOP = 40, SCALE = 3.55 * AT, BORDER = 12 * AT;
const CAP_U0 = 1424 * AT, CAP_U1 = 2036 * AT, CAP_V0 = 12 * AT, CAP_V1 = 1700 * AT;
const frontUV = (x, y) => [(BORDER + (x - PX_LEFT) * SCALE) / TEX, (BORDER + (y - PX_TOP) * SCALE) / TEX];
const backUV = (x, y) => [(BORDER + (404 - x) * SCALE) / TEX, (TEX / 2 + BORDER + (y - PX_TOP) * SCALE) / TEX];
const capUV = (f, t) => [(CAP_U0 + (CAP_U1 - CAP_U0) * t) / TEX, (CAP_V0 + (CAP_V1 - CAP_V0) * f) / TEX];

// Paint ---------------------------------------------------------------------------------
const C = Object.fromEntries(Object.entries({
  lemon: '#fbe028', gold: '#fbd200', warm: '#f8c818', sheenL: '#fbd030', sheenM: '#f9d060', sheenR: '#f5e2c0',
  lipTop: '#f8eab0', lipMid: '#f9dc78', lipLow: '#f8c92e', crease: '#f5c600', creaseDeep: '#f0b800',
  germL: '#f9d45a', germM: '#fae598', germN: '#faeec0', germR: '#fcf6dc', germCore: '#fdfaea', fleck: '#f5be22',
  tongue: '#f4dc8c', tongueTop: '#f2d268', band: '#f8de30', edge: '#f9d004', edgeLow: '#fbd668', edgeTop: '#f6e4a8', collar: '#f6e6b4',
  back: '#f9d204', backDeep: '#f7ca00', backLight: '#fbda30', white: '#fdfaec', capBase: '#f9e4a4', capTip: '#f6edcf', capValley: '#f6d67e', capLemon: '#f6dc70', capGold: '#f0c850',
}).map(([k, v]) => [k, hex(v)]));

const o = { r: 0, g: 0, b: 0, rough: 0.4, coat: 1, h: 0, skin: 1 };
const put = (c, t) => { o.r += (c[0] - o.r) * t; o.g += (c[1] - o.g) * t; o.b += (c[2] - o.b) * t; };

// Thin pale lines along the collar, where the skin stops and the cap begins.
function collarLines(x, y, above) {
  const near = smooth(9, 2, Math.abs(above));
  if (near <= 0) return 0;
  const a = fibres(x, y, 0.28, 0.96, 26, 1.7), b = fibres(x + 31, y - 12, 0.1, 0.99, 16, 1.2);
  return near * Math.max(smooth(0.3, 0.8, a), 0.8 * smooth(0.4, 0.85, b));
}
function collarSkin(x, y, rho, front) {
  const zSkin = surfaceZ(x, y, rho, Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(rho, 0.9999), DOME))), front), zCap = capSkinZ(x, y, front);
  if (zCap === null) return;
  const above = front ? zCap - zSkin : zSkin - zCap, l = above < 2 ? collarLines(x, y + (front ? 0 : 40), above) : 0;
  put(C.white, 0.55 * l);
  o.h += 0.14 * l;
  o.coat = mix(o.coat, 0.5, smooth(-10, -1, above));
  o.rough = mix(o.rough, 0.55, smooth(-10, -1, above));
}

const edgeColour = (x, y) => mixC(mixC(mixC(C.edge, C.lemon, smooth(150, 100, y)), C.edgeLow, smooth(250, 340, x) * smooth(160, 190, y)), C.edgeTop, smooth(270, 345, x) * smooth(135, 110, y));
const fadeToEdge = (x, y, edge) => put(edgeColour(x, y), smooth(18, 2, edge));

function paintFront(x, y, rho, edge) {
  const wx = x + 2.8 * fbm(x / 24, y / 24), wy = y + 2.8 * fbm(x / 24 + 40, y / 24 + 9);
  o.rough = 0.4; o.coat = 1; o.h = 0; o.skin = Math.max(mix(0.3, 1, smooth(135, 215, wy)), 0.7 * smooth(255, 335, wx));
  o.r = C.lemon[0]; o.g = C.lemon[1]; o.b = C.lemon[2];
  put(C.gold, smooth(92, 168, wy + 0.1 * (wx - 120)));
  put(C.warm, 0.45 * smooth(36, 4, Math.hypot(wx - 175, (wy - 190) * 1.25)));

  // The pale sheen above the lip, crisp where the scoop cuts it off.
  const scoop = SCOOP(wx, wy), crisp = Math.max(mix(13, 2.6, smooth(108, 170, wx)), mix(2.6, 5, smooth(270, 330, wx)));
  const sheen = smooth(14, -9, SHEEN(wx, wy)) * smooth(-crisp, crisp, scoop);
  put(wx < 220 ? mixC(C.sheenL, C.sheenM, smooth(95, 220, wx)) : mixC(C.sheenM, C.sheenR, smooth(220, 325, wx)), 0.85 * sheen);

  // The band above the crease, running from pale at the lip to deep gold at the groove.
  const lipFade = smooth(254, 306, wx) * smooth(-3, 4, -scoop) * smooth(142, 134, wy);
  if (lipFade > 0) {
    const v = clamp((wy - 95) / 38, 0, 1);
    put(v < 0.5 ? mixC(C.lipTop, C.lipMid, smooth(0, 0.5, v)) : mixC(C.lipMid, C.lipLow, smooth(0.5, 1, v)), 0.92 * lipFade);
  }

  // The germ: feathered and flecked on its upper left, crisp along the bottom.
  const sdGerm = GERM(wx, wy), low = smooth(198, 232, wy) * smooth(292, 252, wx), left = smooth(250, 170, wx);
  const feather = mix(26, 1.9, low), bendX = x + 7 * noise(x / 40, y / 40), bendY = y + 7 * noise(x / 40 + 7, y / 40 - 2), streak = 0.65 * fibres(bendX, bendY, 0.92, -0.39, 8, 0.7) + 0.45 * fibres(bendX + 9, bendY + 21, 0.92, -0.39, 4, 0.5);
  const germ = smooth(feather, -feather * 0.3, sdGerm + 4 * streak * (1 - low) * left);
  if (germ > 0) {
    put(wx < 225 ? mixC(C.germL, C.germM, smooth(160, 225, wx)) : wx < 280 ? mixC(C.germM, C.germN, smooth(225, 280, wx)) : mixC(C.germN, C.germR, smooth(280, 322, wx)), germ * mix(0.72, 1, smooth(165, 255, wx)));
    put(C.fleck, germ * left * smooth(0.1, 0.7, streak) * 0.26);
    put(C.germCore, germ * smooth(40, 4, Math.hypot(wx - 318, (wy - 183) * 1.1)));
    o.h += germ * left * streak * 0.08;
    o.rough = mix(o.rough, 0.46, germ);
    // A few white hairs where the germ meets the groove.
    put(C.white, germ * smooth(0.28, 0.72, fibres(x, y, 0.97, -0.24, 13, 0.8)) * smooth(318, 334, x) * smooth(153, 145, y) * 0.8);
  }

  // The embryo: a soft straw tongue with a crisp bay on its left edge.
  const sdT = TONGUE(x + 1.1 * noise(x / 7, y / 7), y + 1.1 * noise(x / 7 + 8, y / 7 - 3)), tongueSoft = Math.max(mix(1.4, 9, smooth(342, 358, x)), mix(1.4, 6, smooth(178, 188, y))), tongue = smooth(tongueSoft, -tongueSoft, sdT);
  if (sdT < 4) {
    put(C.tongue, tongue * smooth(384, 352, x) * 0.86);
    put(C.tongueTop, tongue * smooth(158, 143, y) * 0.8);
    put(C.germCore, smooth(2.6, 0.9, Math.abs(sdT - 1.6)) * smooth(344, 334, x) * 0.5);
    o.h += 1.1 * smooth(tongueSoft, -tongueSoft, sdT);
  }

  // The groove itself.
  const dy = wy - creaseY(wx), w = mix(12, 6.5, smooth(290, 362, wx)) * (dy > 0 ? mix(1, 0.55, smooth(315, 345, wx)) : 1), crease = smooth(266, 312, wx) * Math.exp(-((dy / w) ** 2));
  put(C.crease, crease * 0.96);
  put(C.creaseDeep, 0.9 * smooth(300, 345, wx) * Math.exp(-((dy / (dy > 0 ? 2.4 : 5)) ** 2)));
  o.rough = mix(o.rough, 0.32, crease);
  o.coat = mix(o.coat, 0.82, crease);

  // Below the germ the skin turns lemon, then pale and thin at the rim.
  put(C.band, 0.75 * smooth(3, 16, sdGerm) * smooth(240, 310, wx) * smooth(44, 22, edge) * smooth(170, 205, wy));
  fadeToEdge(x, y, edge);

  const collar = smooth(346, 372, x);
  put(C.collar, 0.72 * collar);
  put(C.capGold, 0.6 * smooth(14, 3, Math.hypot(x - 388, (y - 193) / 2.2)) * smooth(-0.2, 0.4, fibres(x, y, 0.5, 0.86, 9, 1.4)));
  if (x > 338) collarSkin(x, y, rho, true);
  o.h += 0.07 * fbm(x / 2.6, y / 2.6, 2) * (1 - collar) * smooth(0, 12, edge);
  const mott = (0.01 * fbm(x / 2.1, y / 2.1, 2) + 0.01 * fbm(x / 8, y / 8, 2)) * smooth(0, 10, edge);
  o.r = clamp(o.r * (1 + mott), 0, 1); o.g = clamp(o.g * (1 + mott * 1.7), 0, 1); o.b = clamp(o.b * (1 + mott * 1.5), 0, 1);
}

function paintBack(x, y, rho, edge) {
  const wx = x + 3 * fbm(x / 30 - 7, y / 30), wy = y + 3 * fbm(x / 30, y / 30 + 13);
  o.rough = 0.42; o.coat = 1; o.h = 0; o.skin = 0.7;
  o.r = C.back[0]; o.g = C.back[1]; o.b = C.back[2];
  put(C.backDeep, 0.8 * smooth(0.82, 0.25, rho));
  put(C.backLight, 0.2 * smooth(0, 0.7, fibres(x, y, 0.995, -0.1, 90, 7)));
  fadeToEdge(x, y, edge);
  put(C.collar, 0.72 * smooth(342, 372, x));
  if (x > 338) collarSkin(x, y, rho, false);
  o.h += 0.07 * fbm(x / 2.6 + 90, y / 2.6, 2) * smooth(0, 12, edge);
  const mott = (0.01 * fbm(x / 2.1, y / 2.1, 2) + 0.01 * fbm(x / 8, y / 8, 2)) * smooth(0, 10, edge);
  o.r = clamp(o.r * (1 + mott), 0, 1); o.g = clamp(o.g * (1 + mott * 1.7), 0, 1); o.b = clamp(o.b * (1 + mott * 1.5), 0, 1);
}

function paintCap(phi, t) {
  const x = capX(t), { c, a } = capSection(x), cs = Math.cos(phi), sn = Math.sin(phi);
  const y = c - a * cs, fold = capFold(phi, t), z = a * capDepth(x) * sn + bend(x, c);
  const fib = noise(48 * cs + 3 + t * 8, 48 * sn - 4 - t * 6), fib2 = noise(96 * cs - 9 + t * 12, 96 * sn + 6 + t * 10), patch = smooth(-0.25, 0.35, noise(6 * cs + 1 + t * 4, 6 * sn + 8 - t * 3));
  o.rough = 0.5; o.coat = 0.42; o.skin = 0.05;
  o.r = C.capBase[0]; o.g = C.capBase[1]; o.b = C.capBase[2];
  put(C.capTip, smooth(0.5, 1, t));
  put(C.capValley, 0.62 * smooth(0.05, -0.5, fold) * (1 - 0.6 * smooth(0.5, 1, t)));
  put(C.capGold, 0.72 * smooth(0.5, 0.95, -cs) * smooth(0.05, 0.14, t) * smooth(0.42, 0.2, t) * smooth(-0.1, 0.45, noise(20 * cs + 2, 20 * sn + t * 3)));
  put(C.white, 0.34 * patch * smooth(0.02, 0.14, t) * (1 - 0.7 * smooth(0.55, 0.95, t)));
  put(C.white, 0.6 * patch * smooth(-0.05, 0.55, fib + 0.5 * fib2) * smooth(0.02, 0.14, t) * (1 - 0.8 * smooth(0.5, 0.92, t)));
  put(C.capLemon, 0.55 * smooth(0.1, 0.6, cs) * smooth(0.42, 0.14, t) * smooth(-0.3, 0.3, noise(5 * cs + 3 + t * 6, 5 * sn - 1 - t * 5)));
  put(C.capTip, 0.3 * smooth(-0.3, 0.5, fbm(5 * cs - 2 + t * 3, 5 * sn + 6 + t * 2)));
  o.h = (0.14 * fib + 0.08 * fib2) * patch * (1 - 0.8 * smooth(0.5, 0.92, t));
  const above = capAboveBody(x, y, z);
  if (above < 12) {
    const l = collarLines(x, y + (sn >= 0 ? 0 : 40), above);
    put(C.white, 0.55 * l);
    o.h += 0.14 * l;
    o.coat = mix(o.coat, 0.5, smooth(9, 0, above));
  }
}

// Bake ----------------------------------------------------------------------------------
function bake() {
  const base = new Uint8Array(TEX * TEX * 3), rough = new Float32Array(TEX * TEX), coat = new Float32Array(TEX * TEX), skin = new Float32Array(TEX * TEX), height = new Float32Array(TEX * TEX);
  const row = TEX / 2;
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const p = j * TEX + i;
    o.r = 0.97; o.g = 0.84; o.b = 0.28; o.rough = 0.45; o.coat = 1; o.h = 0; o.skin = 0.7;
    if (i < CAP_U0 - BORDER) {
      const back = j >= row;
      const y = PX_TOP + ((back ? j - row : j) + 0.5 - BORDER) / SCALE;
      const x = back ? 404 - (i + 0.5 - BORDER) / SCALE : PX_LEFT + (i + 0.5 - BORDER) / SCALE;
      const dx = x - CX, dy = CY - y, r = Math.hypot(dx, dy), R = outline(Math.atan2(dy, dx)), rho = r / R;
      if (rho < 1.14) {
        const edge = (1 - Math.min(rho, 1)) * R;
        if (back) paintBack(x, y, rho, edge); else paintFront(x, y, rho, edge);
      }
    } else if (i >= CAP_U0 && i < CAP_U1 && j >= CAP_V0 && j < CAP_V1) {
      paintCap(CAP_PHI0 + ((j + 0.5 - CAP_V0) / (CAP_V1 - CAP_V0)) * 2 * Math.PI, (i + 0.5 - CAP_U0) / (CAP_U1 - CAP_U0));
    }
    base[p * 3] = clamp(Math.round(o.r * 255), 0, 255); base[p * 3 + 1] = clamp(Math.round(o.g * 255), 0, 255); base[p * 3 + 2] = clamp(Math.round(o.b * 255), 0, 255);
    rough[p] = o.rough; coat[p] = o.coat; skin[p] = o.skin; height[p] = o.h;
  }
  // Fine relief goes in a tangent-space normal map; big forms are real geometry.
  const normal = new Uint8Array(TEX * TEX * 3);
  const capLen = (CAP_END - CAP_START) / (CAP_U1 - CAP_U0), capRound = (2 * Math.PI * 45) / (CAP_V1 - CAP_V0);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const p = j * TEX + i, l = height[j * TEX + Math.max(i - 1, 0)], r = height[j * TEX + Math.min(i + 1, TEX - 1)], u = height[Math.max(j - 1, 0) * TEX + i], d = height[Math.min(j + 1, TEX - 1) * TEX + i];
    const isCap = i >= CAP_U0, sx = isCap ? capLen : 1 / SCALE, sy = isCap ? capRound : 1 / SCALE;
    const nx = -(r - l) / (2 * sx), ny = (d - u) / (2 * sy), len = Math.hypot(nx, ny, 1);
    normal[p * 3] = Math.round(((nx / len + 1) / 2) * 255); normal[p * 3 + 1] = Math.round(((ny / len + 1) / 2) * 255); normal[p * 3 + 2] = Math.round(((1 / len + 1) / 2) * 255);
  }
  // Occlusion and clearcoat share red, roughness is green, the skin mask is blue. Half size is plenty.
  const half = TEX / 2, orm = new Uint8Array(half * half * 3);
  for (let j = 0; j < half; j++) for (let i = 0; i < half; i++) {
    let c = 0, g = 0, m = 0;
    for (const q of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = (j * 2 + q[1]) * TEX + i * 2 + q[0]; c += coat[p]; g += rough[p]; m += skin[p]; }
    const p = (j * half + i) * 3;
    orm[p] = Math.round((c / 4) * 255); orm[p + 1] = Math.round((g / 4) * 255); orm[p + 2] = Math.round((m / 4) * 255);
  }
  return { base, normal, orm, half };
}

// Mesh ----------------------------------------------------------------------------------
function buildMesh(NT, NA, NF, NS) {
  const pos = [], nor = [], uvs = [], idx = [], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0], e = 1e-3;
  const bodyNormal = (theta, alpha) => {
    bodyPoint(theta, alpha + e, a); bodyPoint(theta, alpha - e, b); bodyPoint(theta + e, alpha, c); bodyPoint(theta - e, alpha, d);
    return unit(cross([a[0] - b[0], a[1] - b[1], a[2] - b[2]], [c[0] - d[0], c[1] - d[1], c[2] - d[2]]));
  };
  for (const front of [true, false]) {
    const start = pos.length / 3, uvOf = front ? frontUV : backUV, sign = front ? 1 : -1;
    bodyPoint(0, front ? 0 : Math.PI, a);
    pos.push(a[0], a[1], a[2]); nor.push(0, 0, sign); uvs.push(...uvOf(a[0] + CX, CY - a[1]));
    for (let j = 1; j <= NA; j++) {
      const alpha = (j / NA) * (Math.PI / 2), al = front ? alpha : Math.PI - alpha;
      for (let i = 0; i < NT; i++) {
        const theta = (i / NT) * Math.PI * 2;
        bodyPoint(theta, al, a);
        const px = a[0], py = a[1], pz = a[2], n = bodyNormal(theta, al);
        pos.push(px, py, pz); nor.push(n[0], n[1], n[2]); uvs.push(...uvOf(px + CX, CY - py));
      }
    }
    const ring = j => start + 1 + (j - 1) * NT;
    for (let i = 0; i < NT; i++) {
      const i1 = (i + 1) % NT;
      if (front) idx.push(start, ring(1) + i, ring(1) + i1); else idx.push(start, ring(1) + i1, ring(1) + i);
      for (let j = 1; j < NA; j++) {
        const p0 = ring(j) + i, p1 = ring(j + 1) + i, p2 = ring(j + 1) + i1, p3 = ring(j) + i1;
        if (front) idx.push(p0, p1, p2, p0, p2, p3); else idx.push(p0, p2, p1, p0, p3, p2);
      }
    }
  }
  // Tip cap: closed at both ends.
  const capStart = pos.length / 3, E = 1e-3;
  const capNormal = (phi, t) => {
    capPoint(phi + E, t, a); capPoint(phi - E, t, b); capPoint(phi, t + E, c); capPoint(phi, t - E, d);
    return unit(cross([a[0] - b[0], a[1] - b[1], a[2] - b[2]], [c[0] - d[0], c[1] - d[1], c[2] - d[2]]));
  };
  for (let j = 0; j <= NS; j++) {
    const t = (j / NS) * 0.9995;
    for (let i = 0; i <= NF; i++) {
      const f = i / NF, phi = CAP_PHI0 + f * Math.PI * 2;
      capPoint(phi, t, a);
      const px = a[0], py = a[1], pz = a[2], n = capNormal(phi, t);
      pos.push(px, py, pz); nor.push(n[0], n[1], n[2]); uvs.push(...capUV(f, t));
    }
  }
  const at = (j, i) => capStart + j * (NF + 1) + i;
  for (let j = 0; j < NS; j++) for (let i = 0; i < NF; i++) idx.push(at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j, i), at(j + 1, i + 1), at(j + 1, i));
  capPoint(0, 1, a);
  const tip = pos.length / 3; pos.push(a[0], a[1], a[2]); nor.push(1, 0, 0); uvs.push(...capUV(0.5, 1));
  for (let i = 0; i < NF; i++) idx.push(at(NS, i), at(NS, i + 1), tip);
  const { c: bc } = capSection(CAP_START);
  const base = pos.length / 3; pos.push(CAP_START - CX, CY - bc, bend(CAP_START, bc)); nor.push(-1, 0, 0); uvs.push(...capUV(0.5, 0));
  for (let i = 0; i < NF; i++) idx.push(at(0, i + 1), at(0, i), base);

  // Level the long axis, centre on the bounding box, make the longest side exactly 1.
  const cosT = Math.cos(-TILT), sinT = Math.sin(-TILT), n = pos.length / 3;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    P[i * 3] = x * cosT - y * sinT; P[i * 3 + 1] = x * sinT + y * cosT; P[i * 3 + 2] = pos[i * 3 + 2];
    const nx = nor[i * 3], ny = nor[i * 3 + 1];
    N[i * 3] = nx * cosT - ny * sinT; N[i * 3 + 1] = nx * sinT + ny * cosT; N[i * 3 + 2] = nor[i * 3 + 2];
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], P[i * 3 + k]); max[k] = Math.max(max[k], P[i * 3 + k]); }
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]), mid = min.map((v, k) => (v + max[k]) / 2);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) P[i * 3 + k] = (P[i * 3 + k] - mid[k]) / size;
  return { P, N, UV: new Float32Array(uvs), I: n < 65536 ? new Uint16Array(idx) : new Uint32Array(idx), extent: max.map((v, k) => (v - min[k]) / size), size, mid };
}

// Run -----------------------------------------------------------------------------------
const started = Date.now();
const mesh = WEB ? buildMesh(160, 40, 64, 28) : buildMesh(288, 72, 112, 56);
const { base, normal, orm, half } = bake();
const images = [
  { name: 'Kernel base colour', data: encodeJpeg(TEX, TEX, base, 92) },
  { name: 'Kernel coat and roughness', data: encodeJpeg(half, half, orm, 88) },
  { name: 'Kernel fine relief', data: encodeJpeg(TEX, TEX, normal, 94) },
];
if (DEBUG_DIR) {
  mkdirSync(DEBUG_DIR, { recursive: true });
  ['base', 'orm', 'normal'].forEach((n, i) => writeFileSync(resolve(DEBUG_DIR, `tex-${n}.jpg`), images[i].data));
}
const tex = index => ({ index });
const glb = buildGlb({
  generator: 'Corn Land build-kernel.mjs',
  extensionsUsed: ['KHR_materials_clearcoat', 'KHR_materials_sheen', 'KHR_materials_ior'],
  sceneName: 'Corn kernel',
  nodes: [{ name: 'Corn kernel', mesh: 0, extras: { photoPxPerUnit: mesh.size, photoCentre: mesh.mid, photoTiltDeg: TILT_DEG } }],
  meshes: [{ name: 'Corn kernel', primitives: [{ P: mesh.P, N: mesh.N, UV: mesh.UV, I: mesh.I, material: 0 }] }],
  materials: [{
    name: 'Kernel skin',
    pbrMetallicRoughness: { baseColorTexture: tex(0), metallicFactor: 0, roughnessFactor: 1, metallicRoughnessTexture: tex(1) },
    normalTexture: { index: 2, scale: 1 },
    occlusionTexture: { index: 1, strength: 0.6 },
    emissiveTexture: tex(0), emissiveFactor: [0.05, 0.05, 0.05],
    extensions: {
      KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatTexture: tex(1), clearcoatRoughnessFactor: 0.55, clearcoatRoughnessTexture: tex(1) },
      KHR_materials_sheen: { sheenColorFactor: [0.95, 0.82, 0.42], sheenRoughnessFactor: 0.5 },
      KHR_materials_ior: { ior: 1.45 },
    },
    }],
  images,
});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(JSON.stringify({
  out: OUT, MB: +(glb.length / 1048576).toFixed(2), vertices: mesh.P.length / 3, triangles: mesh.I.length / 3,
  extent: mesh.extent.map(v => +v.toFixed(3)),
  images: images.map(i => `${i.name} ${(i.data.length / 1024) | 0}KB`), seconds: (Date.now() - started) / 1000,
}));
