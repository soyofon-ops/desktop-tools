#!/usr/bin/env node
// 系統列圖示產生器：無外部相依（只用 Node 內建 zlib）。
// 以 signed distance + 超取樣光柵化，並對每個尺寸個別對齊像素格，避免小尺寸糊掉。
// 用法：node design/tray-icon/generate.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, 'output');
const SS = 8; // 每軸超取樣數

// 色彩取樣自 assets/icon.png
const C = {
  tile: [0x16, 0x19, 0x26],
  gold: [0xc9, 0xa9, 0x61],
  body: [0x8f, 0xd3, 0xff],
  facet: [0xc8, 0xec, 0xff],
  ink: [0x10, 0x2a, 0x4a], // 描邊：深藍，淺色系統列上提供對比
  black: [0, 0, 0]
};

// ---------- PNG 編碼 ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------- 幾何 ----------
// 凸多邊形的 signed distance（內部為負），頂點須為順時針（y 向下座標）
function sdConvex(pts) {
  return (x, y) => {
    let inside = -Infinity;
    let outside = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[(i + 1) % pts.length];
      const ex = bx - ax;
      const ey = by - ay;
      const len = Math.hypot(ex, ey);
      const d = (ey * (x - ax) - ex * (y - ay)) / len;
      inside = Math.max(inside, d);
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (len * len)));
      const dist = Math.hypot(x - ax - t * ex, y - ay - t * ey);
      if (d > 0) outside = outside === 0 ? dist : Math.min(outside, dist);
    }
    return inside <= 0 ? inside : outside;
  };
}
const sdRoundRect = (x0, y0, x1, y1, r) => (x, y) => {
  const qx = Math.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2 + r;
  const qy = Math.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2 + r;
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
};

// 菱形（風箏形）：與主圖示相同的剪影
const kitePts = g => [[g.cx, g.top], [g.cx + g.hw, g.sh], [g.cx, g.bottom], [g.cx - g.hw, g.sh]];
const facetPts = g => [[g.cx, g.top], [g.cx + g.hw, g.sh], [g.cx, g.sh]];

// ---------- 光柵化 ----------
// layers: [{ inside(x, y) => bool, color, alpha }]，由下往上疊
function rasterize(size, layers) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0; // 預乘累加
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          let sr = 0, sg = 0, sb = 0, sa = 0;
          for (const l of layers) {
            if (!l.inside(x, y)) continue;
            const la = l.alpha === undefined ? 1 : l.alpha;
            sr = l.color[0] * la + sr * (1 - la);
            sg = l.color[1] * la + sg * (1 - la);
            sb = l.color[2] * la + sb * (1 - la);
            sa = la + sa * (1 - la);
          }
          r += sr; g += sg; b += sb; a += sa;
        }
      }
      const n = SS * SS;
      const o = (py * size + px) * 4;
      const af = a / n;
      buf[o] = af ? Math.round(r / n / af) : 0;
      buf[o + 1] = af ? Math.round(g / n / af) : 0;
      buf[o + 2] = af ? Math.round(b / n / af) : 0;
      buf[o + 3] = Math.round(af * 255);
    }
  }
  return buf;
}

// ---------- 單色（macOS Template）：對齊像素的幾何與切面間隙 ----------
const MONO_GEOM = {
  16: { cx: 8, top: 0.4, bottom: 15.6, hw: 6, sh: 6.5, gapX: [8, 9], gapY: [6, 7] },
  32: { cx: 16, top: 1, bottom: 31, hw: 12, sh: 13, gapX: [15, 17], gapY: [12, 14] }
};
function monoSlit(size) {
  const g = MONO_GEOM[size];
  const kite = sdConvex(kitePts(g));
  const inGap = (x, y) =>
    (x >= g.gapX[0] && x < g.gapX[1] && y < g.gapY[1]) ||
    (y >= g.gapY[0] && y < g.gapY[1] && x >= g.gapX[0]);
  return rasterize(size, [{ inside: (x, y) => kite(x, y) <= 0 && !inGap(x, y), color: C.black }]);
}
function monoNotch(size) {
  const g = MONO_GEOM[size];
  const kite = sdConvex(kitePts(g));
  const inFacet = (x, y) => x >= g.gapX[0] && y < g.gapY[1];
  return rasterize(size, [{ inside: (x, y) => kite(x, y) <= 0 && !inFacet(x, y), color: C.black }]);
}

// ---------- 彩色（Windows）----------
// 各尺寸描邊寬與幾何（內層淺藍）個別指定，確保描邊落在整數像素
const COLOR_GEOM = {
  16: { o: 1, cx: 8, top: 1.6, bottom: 14.4, hw: 5, sh: 6.5, fx: 8, fy: 7 },
  20: { o: 1, cx: 10, top: 1.8, bottom: 18.2, hw: 6.5, sh: 8, fx: 10, fy: 8 },
  24: { o: 1.5, cx: 12, top: 2.2, bottom: 21.8, hw: 7.5, sh: 10, fx: 12, fy: 10 },
  32: { o: 2, cx: 16, top: 3, bottom: 29, hw: 10, sh: 13, fx: 16, fy: 13 },
  48: { o: 3, cx: 24, top: 4.5, bottom: 43.5, hw: 15, sh: 19.5, fx: 24, fy: 20 }
};
function colorOutlined(size) {
  const g = COLOR_GEOM[size];
  const kite = sdConvex(kitePts(g));
  const facet = (x, y) => kite(x, y) <= 0 && x >= g.fx && y < g.fy;
  return rasterize(size, [
    { inside: (x, y) => kite(x, y) <= g.o, color: C.ink },
    { inside: (x, y) => kite(x, y) <= 0, color: C.body },
    { inside: facet, color: C.facet }
  ]);
}

// 深色底板版：沿用主圖示的 tile，但放大菱形、移除會糊掉的金邊
const TILE_GEOM = {
  16: { r: 3, cx: 8, top: 1.4, bottom: 14.6, hw: 5, sh: 6.5, fx: 8, fy: 7 },
  20: { r: 4, cx: 10, top: 1.6, bottom: 18.4, hw: 6.5, sh: 8, fx: 10, fy: 8 },
  24: { r: 5, cx: 12, top: 2, bottom: 22, hw: 8, sh: 10, fx: 12, fy: 10 },
  32: { r: 7, cx: 16, top: 2.5, bottom: 29.5, hw: 10.5, sh: 13, fx: 16, fy: 13 },
  48: { r: 10, cx: 24, top: 4, bottom: 44, hw: 15.5, sh: 20, fx: 24, fy: 20 }
};
function colorTile(size) {
  const g = TILE_GEOM[size];
  const tile = sdRoundRect(0, 0, size, size, g.r);
  const kite = sdConvex(kitePts(g));
  return rasterize(size, [
    { inside: (x, y) => tile(x, y) <= 0, color: C.tile },
    { inside: (x, y) => kite(x, y) <= 0, color: C.body },
    { inside: (x, y) => kite(x, y) <= 0 && x >= g.fx && y < g.fy, color: C.facet }
  ]);
}

// ---------- ICO（內嵌 PNG，Windows Vista 以上皆支援）----------
function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(([size, png]) => {
    const e = Buffer.alloc(16);
    e[0] = size;
    e[1] = size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...entries.map(e => e[1])]);
}

// ---------- 輸出 ----------
function write(rel, data) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
}

// macOS：Electron 依檔名自動辨識 Template 與 @2x
for (const [name, fn] of [['a-slit', monoSlit], ['b-notch', monoNotch]]) {
  write(`mac/${name}/trayTemplate.png`, encodePNG(16, fn(16)));
  write(`mac/${name}/trayTemplate@2x.png`, encodePNG(32, fn(32)));
}

// Windows：兩案各出五個 DPI 尺寸（100/125/150/200/300%）與 .ico
for (const [name, fn] of [['a-outlined', colorOutlined], ['b-tile', colorTile]]) {
  const entries = [16, 20, 24, 32, 48].map(s => {
    const png = encodePNG(s, fn(s));
    write(`win/${name}/tray-${s}.png`, png);
    return [s, png];
  });
  write(`win/${name}/tray.ico`, encodeICO(entries));
}

console.log('done:', OUT);
