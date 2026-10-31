// Shared parts of the model builders: noise, painted shapes, lofted meshes, JPEG and GLB writers.
// Needs only Node.

// Maths ---------------------------------------------------------------------------------
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const mix = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);
export const mixC = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

export function hash(ix, iy) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return 2 * (a + (b - a) * ux + (c - a + (a - b - c + d) * ux) * uy) - 1;
}
export function fbm(x, y, octaves = 3) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { sum += amp * noise(x * f + i * 17.3, y * f - i * 9.1); amp *= 0.5; f *= 2.03; }
  return sum;
}
// Fine fibres running along the direction (dx, dy).
export function fibres(x, y, dx, dy, along, across) {
  const u = x * dx + y * dy, v = -x * dy + y * dx;
  return noise(u / along, v / across);
}

// Shapes from hand-placed points: a smooth closed loop and its distance field.
export function loop(points, steps = 8) {
  const out = [], n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n], b = points[i], c = points[(i + 1) % n], d = points[(i + 2) % n];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, cr = k => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t);
      out.push(cr(0), cr(1));
    }
  }
  return out;
}
export function signedDistance(x, y, poly) {
  let best = Infinity, inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const ax = poly[j], ay = poly[j + 1], ex = poly[i] - ax, ey = poly[i + 1] - ay, wx = x - ax, wy = y - ay;
    const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1), dx = wx - ex * t, dy = wy - ey * t, dd = dx * dx + dy * dy;
    if (dd < best) best = dd;
    if ((ay > y) !== (poly[i + 1] > y) && x < ax + ((y - ay) * ex) / ey) inside = !inside;
  }
  return Math.sqrt(best) * (inside ? -1 : 1);
}
// Distance fields on a 1px grid, so carving and painting stay cheap.
export function field(points) {
  const poly = loop(points), x0 = -40, y0 = -40, w = 560, h = 460, data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = signedDistance(x0 + i, y0 + j, poly);
  return (x, y) => {
    const fx = clamp(x - x0, 0, w - 1.001), fy = clamp(y - y0, 0, h - 1.001), i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, p = j * w + i;
    return mix(mix(data[p], data[p + 1], tx), mix(data[p + w], data[p + w + 1], tx), ty);
  };
}
// Vectors -------------------------------------------------------------------------------
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function unit(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// Lofted meshes -------------------------------------------------------------------------
export const toLinear = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

// Collects shells into one mesh. A loft is a ring of points (f around, t along), wrapped at f = 1.
export class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vertex(p, n, uv, c) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]);
    if (uv) this.uv.push(uv[0], uv[1]);
    if (c) this.col.push(c[0], c[1], c[2], 1);
    return this.count - 1;
  }
  loft({ around, along, point, uv, color, flip = false, capStart = false, capEnd = false }) {
    const grid = [];
    for (let j = 0; j <= along; j++) { const row = []; for (let i = 0; i < around; i++) row.push(point(i / around, j / along)); grid.push(row); }
    const at = (i, j) => grid[clamp(j, 0, along)][((i % around) + around) % around];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const normalAt = (i, j) => { const n = unit(cross(sub(at(i, j + 1), at(i, j - 1)), sub(at(i + 1, j), at(i - 1, j)))); return flip ? [-n[0], -n[1], -n[2]] : n; };
    const start = this.count, stride = around + 1;
    for (let j = 0; j <= along; j++) for (let i = 0; i <= around; i++) {
      const f = i / around, t = j / along, ii = i % around;
      this.vertex(grid[j][ii], normalAt(ii, j), uv && uv(f, t), color && color(f, t));
    }
    const v = (i, j) => start + j * stride + i;
    for (let j = 0; j < along; j++) for (let i = 0; i < around; i++) {
      if (flip) this.idx.push(v(i, j), v(i + 1, j + 1), v(i, j + 1), v(i, j), v(i + 1, j), v(i + 1, j + 1));
      else this.idx.push(v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i, j), v(i + 1, j + 1), v(i + 1, j));
    }
    // A cap closes a ring with one centre vertex, keeping the winding of the shell.
    const cap = (j, end) => {
      let c = [0, 0, 0];
      for (let i = 0; i < around; i++) { const p = grid[j][i]; c = [c[0] + p[0] / around, c[1] + p[1] / around, c[2] + p[2] / around]; }
      const axis = unit(sub(grid[end ? j : j + 1][0], grid[end ? j - 1 : j][0])), next = unit(sub(c, grid[end ? j - 1 : j + 1].reduce((m, p) => [m[0] + p[0] / around, m[1] + p[1] / around, m[2] + p[2] / around], [0, 0, 0])));
      const pole = this.vertex(c, Number.isFinite(next[0]) && Math.hypot(...next) > 0.5 ? next : axis, uv && uv(0.5, j / along), color && color(0.5, j / along));
      for (let i = 0; i < around; i++) {
        if (end !== flip) this.idx.push(v(i, j), pole, v(i + 1, j)); else this.idx.push(v(i + 1, j), pole, v(i, j));
      }
    };
    if (capStart) cap(0, false);
    if (capEnd) cap(along, true);
  }
  // Rotates, then applies a shared centre and scale.
  arrays(cos, sin, mid, size) {
    const n = this.count, P = new Float32Array(n * 3), N = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], nx = this.nor[i * 3], ny = this.nor[i * 3 + 1];
      P[i * 3] = (x * cos - y * sin - mid[0]) / size; P[i * 3 + 1] = (x * sin + y * cos - mid[1]) / size; P[i * 3 + 2] = (this.pos[i * 3 + 2] - mid[2]) / size;
      N[i * 3] = nx * cos - ny * sin; N[i * 3 + 1] = nx * sin + ny * cos; N[i * 3 + 2] = this.nor[i * 3 + 2];
    }
    const out = { P, N, I: n < 65536 ? new Uint16Array(this.idx) : new Uint32Array(this.idx) };
    if (this.uv.length) out.UV = new Float32Array(this.uv);
    if (this.col.length) { const C = new Uint16Array(this.col.length); this.col.forEach((v, i) => { C[i] = Math.round(clamp(v, 0, 1) * 65535); }); out.C = C; }
    return out;
  }
}
// Levels the long axis (tilted by tiltDeg, y up) and scales so the longest side is exactly 1.
export function levelAndFit(builders, tiltDeg) {
  const a = (-tiltDeg * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of builders) for (let i = 0; i < b.count; i++) {
    const x = b.pos[i * 3], y = b.pos[i * 3 + 1], q = [x * cos - y * sin, x * sin + y * cos, b.pos[i * 3 + 2]];
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], q[k]); max[k] = Math.max(max[k], q[k]); }
  }
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]), mid = min.map((v, k) => (v + max[k]) / 2);
  return { cos, sin, size, mid, extent: max.map((v, k) => +((v - min[k]) / size).toFixed(3)) };
}
// Tangent-space normal map from a height field, with world pixels per texel for each direction.
export function heightToNormal(size, height, scaleAt) {
  const normal = new Uint8Array(size * size * 3);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const p = j * size + i, l = height[j * size + Math.max(i - 1, 0)], r = height[j * size + Math.min(i + 1, size - 1)], u = height[Math.max(j - 1, 0) * size + i], d = height[Math.min(j + 1, size - 1) * size + i];
    const [sx, sy] = scaleAt(i, j), nx = -(r - l) / (2 * sx), ny = (d - u) / (2 * sy), len = Math.hypot(nx, ny, 1);
    normal[p * 3] = Math.round(((nx / len + 1) / 2) * 255); normal[p * 3 + 1] = Math.round(((ny / len + 1) / 2) * 255); normal[p * 3 + 2] = Math.round(((1 / len + 1) / 2) * 255);
  }
  return normal;
}
// Periodic Catmull-Rom through [angle in degrees, value] pairs, sorted by angle.
export function periodicTable(rows) {
  const n = rows.length;
  return degrees => {
    const d = ((degrees % 360) + 360) % 360;
    let i = n - 1; for (let k = 0; k < n; k++) if (rows[k][0] <= d) i = k;
    const a = rows[(i - 1 + n) % n][1], b = rows[i][1], c = rows[(i + 1) % n][1], e = rows[(i + 2) % n][1];
    const span = ((rows[(i + 1) % n][0] - rows[i][0]) + 360) % 360 || 360, t = (((d - rows[i][0]) + 360) % 360) / span;
    return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - e) * t * t + (3 * b - a - 3 * c + e) * t * t * t);
  };
}
// Catmull-Rom through evenly weighted control rows; t runs 0 to 1 over the whole list.
export function spline(rows) {
  const n = rows.length;
  return t => {
    const f = clamp(t, 0, 1) * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
    const a = rows[Math.max(i - 1, 0)], b = rows[i], c = rows[i + 1], e = rows[Math.min(i + 2, n - 1)];
    return b.map((_, k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * u + (2 * a[k] - 5 * b[k] + 4 * c[k] - e[k]) * u * u + (3 * b[k] - a[k] - 3 * c[k] + e[k]) * u * u * u));
  };
}

// JPEG (baseline, 4:4:4) ----------------------------------------------------------------
const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const CHROMA_Q = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...Array(32).fill(99)];
const DC_LUMA = [[0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const DC_CHROMA = [[0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];
const AC_LUMA = [[0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];
const AC_CHROMA = [[0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa]];

function huffman([bits, vals]) {
  const code = new Int32Array(256), size = new Uint8Array(256);
  let c = 0, k = 0;
  for (let l = 1; l <= 16; l++) { for (let i = 0; i < bits[l - 1]; i++) { code[vals[k]] = c++; size[vals[k++]] = l; } c <<= 1; }
  return { code, size };
}
const COS = (() => {
  const t = new Float64Array(64);
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) t[u * 8 + x] = 0.5 * (u === 0 ? Math.SQRT1_2 : 1) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return t;
})();

export function encodeJpeg(w, h, rgb, quality) {
  const scale = quality < 50 ? 5000 / quality : 200 - quality * 2;
  const table = t => t.map(q => clamp(Math.floor((q * scale + 50) / 100), 1, 255));
  const qY = table(LUMA_Q), qC = table(CHROMA_Q);
  const tY = [huffman(DC_LUMA), huffman(AC_LUMA)], tC = [huffman(DC_CHROMA), huffman(AC_CHROMA)];
  let out = new Uint8Array(1 << 20), n = 0, acc = 0, cnt = 0;
  const byte = b => { if (n === out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; } out[n++] = b; };
  const word = v => { byte(v >> 8); byte(v & 255); };
  const emit = (code, len) => {
    acc = (acc << len) | code; cnt += len;
    while (cnt >= 8) { const b = (acc >>> (cnt - 8)) & 255; byte(b); if (b === 255) byte(0); cnt -= 8; }
    acc &= (1 << cnt) - 1;
  };
  word(0xffd8);
  word(0xffe0); word(16); for (const b of [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]) byte(b);
  word(0xffdb); word(132); byte(0); for (let i = 0; i < 64; i++) byte(qY[ZIGZAG[i]]); byte(1); for (let i = 0; i < 64; i++) byte(qC[ZIGZAG[i]]);
  word(0xffc0); word(17); byte(8); word(h); word(w); byte(3); for (const [id, q] of [[1, 0], [2, 1], [3, 1]]) { byte(id); byte(0x11); byte(q); }
  for (const [cls, [bits, vals]] of [[0x00, DC_LUMA], [0x10, AC_LUMA], [0x01, DC_CHROMA], [0x11, AC_CHROMA]]) {
    word(0xffc4); word(19 + vals.length); byte(cls); for (const b of bits) byte(b); for (const v of vals) byte(v);
  }
  word(0xffda); word(12); byte(3); for (const [id, t] of [[1, 0x00], [2, 0x11], [3, 0x11]]) { byte(id); byte(t); } byte(0); byte(63); byte(0);

  const Y = new Float64Array(64), U = new Float64Array(64), V = new Float64Array(64), tmp = new Float64Array(64), freq = new Float64Array(64), prev = [0, 0, 0];
  const bitsOf = v => { let a = Math.abs(v), b = 0; while (a) { b++; a >>= 1; } return b; };
  const value = (v, b) => (v < 0 ? v + (1 << b) - 1 : v);
  const encodeBlock = (block, q, [dc, ac], c) => {
    for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += block[y * 8 + x] * COS[u * 8 + x]; tmp[y * 8 + u] = s; }
    for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += tmp[y * 8 + u] * COS[v * 8 + y]; freq[v * 8 + u] = s; }
    const d = Math.round(freq[0] / q[0]), diff = d - prev[c]; prev[c] = d;
    const b0 = bitsOf(diff); emit(dc.code[b0], dc.size[b0]); if (b0) emit(value(diff, b0), b0);
    let run = 0;
    for (let k = 1; k < 64; k++) {
      const v = Math.round(freq[ZIGZAG[k]] / q[ZIGZAG[k]]);
      if (!v) { run++; continue; }
      while (run > 15) { emit(ac.code[0xf0], ac.size[0xf0]); run -= 16; }
      const b = bitsOf(v), sym = (run << 4) | b; emit(ac.code[sym], ac.size[sym]); emit(value(v, b), b); run = 0;
    }
    if (run) emit(ac.code[0], ac.size[0]);
  };
  for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) {
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const p = (Math.min(by + j, h - 1) * w + Math.min(bx + i, w - 1)) * 3, r = rgb[p], g = rgb[p + 1], b = rgb[p + 2], q = j * 8 + i;
      Y[q] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
      U[q] = -0.168736 * r - 0.331264 * g + 0.5 * b;
      V[q] = 0.5 * r - 0.418688 * g - 0.081312 * b;
    }
    encodeBlock(Y, qY, tY, 0); encodeBlock(U, qC, tC, 1); encodeBlock(V, qC, tC, 2);
  }
  if (cnt) emit((1 << (8 - cnt)) - 1, 8 - cnt);
  word(0xffd9);
  return Buffer.from(out.subarray(0, n));
}

// GLB -----------------------------------------------------------------------------------
// meshes: [{ name, primitives: [{ P, N, UV?, C?, I, material }] }]; one texture per image.
export function buildGlb({ generator, extensionsUsed, sceneName, nodes, meshes, materials, images, sceneNodes = [0] }) {
  const chunks = [], bufferViews = [], accessors = []; let offset = 0;
  const view = (buf, target) => {
    const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength), pad = (4 - (b.length % 4)) % 4;
    chunks.push(b); if (pad) chunks.push(Buffer.alloc(pad));
    const v = { buffer: 0, byteOffset: offset, byteLength: b.length }; if (target) v.target = target;
    offset += b.length + pad; bufferViews.push(v); return bufferViews.length - 1;
  };
  const accessor = a => { accessors.push(a); return accessors.length - 1; };
  const outMeshes = meshes.map(m => ({
    name: m.name,
    primitives: m.primitives.map(p => {
      const n = p.P.length / 3, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.P[i * 3 + k]); max[k] = Math.max(max[k], p.P[i * 3 + k]); }
      const attributes = {};
      attributes.POSITION = accessor({ bufferView: view(p.P, 34962), componentType: 5126, count: n, type: 'VEC3', min, max });
      attributes.NORMAL = accessor({ bufferView: view(p.N, 34962), componentType: 5126, count: n, type: 'VEC3' });
      if (p.UV) attributes.TEXCOORD_0 = accessor({ bufferView: view(p.UV, 34962), componentType: 5126, count: n, type: 'VEC2' });
      if (p.C) attributes.COLOR_0 = accessor({ bufferView: view(p.C, 34962), componentType: 5123, normalized: true, count: n, type: 'VEC4' });
      const indices = accessor({ bufferView: view(p.I, 34963), componentType: p.I instanceof Uint16Array ? 5123 : 5125, count: p.I.length, type: 'SCALAR' });
      return { attributes, indices, material: p.material };
    }),
  }));
  const imageDefs = images.map(({ name, data }) => ({ name, mimeType: 'image/jpeg', bufferView: view(data) }));
  const json = {
    asset: { version: '2.0', generator },
    extensionsUsed,
    scene: 0, scenes: [{ name: sceneName, nodes: sceneNodes }],
    nodes,
    meshes: outMeshes,
    materials,
    textures: images.map((_, source) => ({ sampler: 0, source })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: imageDefs, accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  let head = Buffer.from(JSON.stringify(json)); if (head.length % 4) head = Buffer.concat([head, Buffer.alloc(4 - (head.length % 4), 0x20)]);
  const bin = Buffer.concat(chunks), total = 12 + 8 + head.length + 8 + bin.length, h = Buffer.alloc(12), a = Buffer.alloc(8), b = Buffer.alloc(8);
  h.write('glTF', 0, 'latin1'); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  a.writeUInt32LE(head.length, 0); a.write('JSON', 4, 'latin1');
  b.writeUInt32LE(bin.length, 0); b.write('BIN ', 4, 'latin1');
  return Buffer.concat([h, a, head, b, bin]);
}
