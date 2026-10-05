/*
 * 生成 PWA 图标（PNG）的**可重跑**脚本（步骤13）。
 *
 * 为什么自己写：本仓库不引图片处理依赖（会为了两个图标装一个几十 MB 的库），
 * 也不把二进制图标的来源留给「某人本机做过一次」。PNG 的最小结构（签名 + IHDR + IDAT + IEND）
 * 用 Node 内置的 `zlib` 就能写出来，并在这里写成可复现的一步。
 *
 * 用法：
 *   node scripts/make-icons.mjs        # 写出 public/icons/icon-192.png 与 icon-512.png
 *
 * 图形：深色圆角方块 + 三根白色柱（与项目「看板」的意象一致，纯几何、无文字、无外部素材）。
 * 校验：`src/pwa/pwaAssets.test.ts` 会读回这两个文件，按 IHDR 断言尺寸、位深与颜色类型，
 * 因此「生成脚本坏了 / 文件被换掉」会让测试失败。
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 颜色（与界面主色一致：slate-900 背景 + 白色柱 + 一抹 indigo 强调） */
const BACKGROUND = [15, 23, 42, 255] // #0f172a
const BAR = [248, 250, 252, 255] // #f8fafc
const ACCENT = [129, 140, 248, 255] // #818cf8

/* ------------------------------------------------------------------ PNG 编码 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** RGBA 像素数组 → PNG 字节（8 位色深、颜色类型 6、无隔行） */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8) // bit depth
  header.writeUInt8(6, 9) // color type: RGBA
  header.writeUInt8(0, 10) // compression
  header.writeUInt8(0, 11) // filter
  header.writeUInt8(0, 12) // interlace

  // 每行前面加一个 filter 字节（0 = None），简单且无损
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ 图形 */

/** 圆角矩形判定：角上按距离裁掉，做出「圆角方块」 */
function insideRoundedSquare(x, y, size, radius) {
  const inner = size / 2
  const dx = Math.abs(x - inner + 0.5)
  const dy = Math.abs(y - inner + 0.5)
  const straight = inner - radius
  if (dx <= straight || dy <= straight) {
    return true
  }
  const cornerX = dx - straight
  const cornerY = dy - straight
  return cornerX * cornerX + cornerY * cornerY <= radius * radius
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = Math.round(size * 0.18)
  // 三根柱：位置与高度按比例算，因此 192 与 512 两个尺寸图形一致
  const barWidth = Math.round(size * 0.13)
  const gap = Math.round(size * 0.075)
  const bars = [
    { height: 0.34, color: BAR },
    { height: 0.52, color: ACCENT },
    { height: 0.42, color: BAR },
  ]
  const totalWidth = bars.length * barWidth + (bars.length - 1) * gap
  const startX = Math.round((size - totalWidth) / 2)
  const baseline = Math.round(size * 0.72)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4
      if (!insideRoundedSquare(x, y, size, radius)) {
        continue // 圆角外保持透明
      }
      let color = BACKGROUND
      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index]
        const left = startX + index * (barWidth + gap)
        const top = baseline - Math.round(size * bar.height)
        if (x >= left && x < left + barWidth && y >= top && y < baseline) {
          color = bar.color
          break
        }
      }
      rgba[offset] = color[0]
      rgba[offset + 1] = color[1]
      rgba[offset + 2] = color[2]
      rgba[offset + 3] = color[3]
    }
  }
  return { rgba, size }
}

/* ------------------------------------------------------------------ 写出 */

const outputDir = join(ROOT, 'public', 'icons')
mkdirSync(outputDir, { recursive: true })

for (const size of [192, 512]) {
  const { rgba } = drawIcon(size)
  const png = encodePng(size, size, rgba)
  const target = join(outputDir, `icon-${size}.png`)
  writeFileSync(target, png)
  process.stdout.write(`wrote ${target} (${png.length} bytes)\n`)
}
