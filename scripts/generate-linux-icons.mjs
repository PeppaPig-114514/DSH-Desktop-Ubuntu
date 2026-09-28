import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

// The Linux counterpart of scripts/generate-app-icons.mjs, using sharp instead
// of the macOS-only sips/iconutil so it runs on any host.
//
// `build/icon.png` is the brand asset install-brand-assets.mjs turns into the
// Web favicon: light artwork, and 1254px wide with no alpha. Handing that single
// file to electron-builder as the Linux icon made it name the icon-theme
// directory after the pixel width, so the deb shipped one
// /usr/share/icons/hicolor/1254x1254/apps entry that no icon loader resolves.
// The app icon is build/app-icon.png, the same source as icon.ico and icon.icns,
// and it needs the standard size ladder.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, 'build', 'app-icon.png')
const destinationDirectory = path.join(projectRoot, 'build', 'icons')

// Sizes the freedesktop icon theme spec and the stock GNOME/Yaru themes resolve.
const sizes = [16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512]

await mkdir(destinationDirectory, { recursive: true })

for (const size of sizes) {
  const png = await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(path.join(destinationDirectory, `${size}x${size}.png`), png)
}

console.log(`wrote ${sizes.length} icons to build/icons from build/app-icon.png`)
