import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

// Sizes the freedesktop icon theme spec and the stock GNOME/Yaru themes resolve.
const SIZES = [16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512]

it('ships a standard icon-theme size ladder instead of one odd-sized png', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    build: { linux: { icon: string } }
  }
  // A single PNG makes electron-builder name the icon-theme directory after the
  // image's pixel width, which produced an unreadable hicolor/1254x1254 entry.
  expect(pkg.build.linux.icon).toBe('build/icons')

  for (const size of SIZES) {
    const file = `build/icons/${size}x${size}.png`
    const meta = await sharp(file).metadata()
    expect([meta.width, meta.height], file).toEqual([size, size])
    expect(meta.hasAlpha, file).toBe(true)
  }
})

it('derives the ladder from the app icon rather than the brand asset', async () => {
  const [appIcon, brandAsset] = await Promise.all([
    sharp('build/app-icon.png').metadata(),
    sharp('build/icon.png').metadata()
  ])
  // build/icon.png is the source install-brand-assets.mjs turns into the Web
  // favicon: light artwork, 1254px wide, no alpha. An app icon cannot come from
  // it, which is why the Linux set has to be generated from app-icon.png — the
  // same source as icon.ico and icon.icns.
  expect(brandAsset.hasAlpha).toBe(false)
  expect(appIcon.hasAlpha).toBe(true)
})

it('keeps the committed ladder in step with the app icon', async () => {
  // Regenerating in place is what scripts/generate-linux-icons.mjs does; if
  // app-icon.png changes without rerunning it, this fails rather than shipping
  // an icon set that no longer matches the Windows and macOS builds.
  const expected = await sharp('build/app-icon.png')
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const committed = await sharp('build/icons/512x512.png').ensureAlpha().raw().toBuffer()
  expect(Buffer.compare(committed, expected)).toBe(0)
})

it('generates the ladder from the app icon source', async () => {
  const script = await readFile('scripts/generate-linux-icons.mjs', 'utf8')
  expect(script).toContain("path.join(projectRoot, 'build', 'app-icon.png')")
  expect(script).not.toContain("'icon.png'")
  for (const size of SIZES) expect(script).toContain(String(size))
})
