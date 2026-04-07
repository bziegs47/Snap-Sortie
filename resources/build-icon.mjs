import sharp from 'sharp'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mkdirSync, rmSync } from 'fs'
import { execFileSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const INPUT = join(__dirname, 'snap-sortie-logo-v4.png')
const ICONSET = join(__dirname, 'icon.iconset')
const OUTPUT = join(__dirname, 'icon.icns')

const SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

async function buildIcon() {
  const meta = await sharp(INPUT).metadata()
  const w = meta.width
  const h = meta.height

  // Source is 1376x768. The logo's dark rounded rect is roughly centered.
  // Crop to center square matching the height.
  const squareSize = h
  const left = Math.round((w - squareSize) / 2)

  const cropped = await sharp(INPUT)
    .extract({ left, top: 0, width: squareSize, height: squareSize })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { data, info } = cropped
  const pixels = Buffer.from(data)

  // The image has a dark rounded-rect on a lighter background.
  // Strategy: make everything OUTSIDE the dark area transparent,
  // keeping the dark area + logo content intact.
  // Outside pixels are lighter (the background behind the rounded rect).
  // We detect them by: low saturation AND brightness > threshold
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    const brightness = (r + g + b) / 3
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const saturation = maxC > 0 ? (maxC - minC) / maxC : 0

    // Light, desaturated pixels = outside the dark rounded rect
    if (brightness > 100 && saturation < 0.1) {
      pixels[i + 3] = 0
    }
    // Anti-aliased edge pixels (medium brightness, low saturation)
    else if (brightness > 60 && saturation < 0.1) {
      // Fade based on brightness — darker = more opaque
      const alpha = Math.round(255 * (1 - (brightness - 60) / 60))
      pixels[i + 3] = Math.min(pixels[i + 3], Math.max(0, alpha))
    }
  }

  const logoWithAlpha = await sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toBuffer()

  // Build 1024x1024 master icon
  const SIZE = 1024
  const LOGO_SIZE = Math.round(SIZE * 0.82) // logo fills 82% — floating with breathing room
  const OFFSET = Math.round((SIZE - LOGO_SIZE) / 2)

  // Subtle dark gradient background
  const bgSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stop-color="#1a1a1a"/>
        <stop offset="100%" stop-color="#0a0a0a"/>
      </radialGradient>
    </defs>
    <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  </svg>`

  const resizedLogo = await sharp(logoWithAlpha)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer()

  const master = await sharp(Buffer.from(bgSvg))
    .composite([{ input: resizedLogo, left: OFFSET, top: OFFSET }])
    .png()
    .toBuffer()

  // Save preview
  await sharp(master).toFile(join(__dirname, 'icon-preview.png'))

  // Generate iconset
  try { rmSync(ICONSET, { recursive: true }) } catch {}
  mkdirSync(ICONSET, { recursive: true })

  for (const [name, size] of SIZES) {
    await sharp(master)
      .resize(size, size, { fit: 'contain' })
      .png()
      .toFile(join(ICONSET, name))
  }

  execFileSync('iconutil', ['-c', 'icns', ICONSET, '-o', OUTPUT])
  rmSync(ICONSET, { recursive: true })

  console.log(`Built ${OUTPUT}`)
}

buildIcon().catch(err => { console.error(err); process.exit(1) })
