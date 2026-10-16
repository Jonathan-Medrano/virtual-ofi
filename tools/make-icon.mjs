// Genera build/icon.png y build/icon.ico (256x256) sin dependencias: un cubo voxel simple.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const N = 256
const px = Buffer.alloc(N * N * 4)
const set = (x, y, c) => { const i = (y * N + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255 }
const inTri = (x, y, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
  const p = [x, y], d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}
const top = [[128, 40], [216, 88], [128, 136], [40, 88]]
const left = [[40, 88], [128, 136], [128, 224], [40, 176]]
const right = [[128, 136], [216, 88], [216, 176], [128, 224]]
const quad = (x, y, q) => inTri(x, y, q[0], q[1], q[2]) || inTri(x, y, q[0], q[2], q[3])
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  let c = [21, 23, 26]
  if (quad(x, y, top)) c = [126, 211, 160]
  else if (quad(x, y, left)) c = [74, 144, 217]
  else if (quad(x, y, right)) c = [48, 100, 170]
  set(x, y, c)
}
const raw = Buffer.alloc((N * 4 + 1) * N)
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4) }
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
const ico = Buffer.alloc(22); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = 0; ico[7] = 0; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18)
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)
writeFileSync('build/icon.ico', Buffer.concat([ico, png]))
console.log('icono generado en build/')
