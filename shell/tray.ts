import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'

/** Ícono 16x16 dibujado a mano (un cubito voxel): sin archivos de imagen que empaquetar. */
function icon() {
  const n = 16
  const buf = Buffer.alloc(n * n * 4)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      const inside = x >= 2 && x < 14 && y >= 2 && y < 14
      const [r, g, b] = !inside ? [0, 0, 0] : y < 6 ? [0xe8, 0x8a, 0x3f] : x < 8 ? [0xc2, 0x5a, 0x2c] : [0x9a, 0x42, 0x1f]
      buf[i] = b
      buf[i + 1] = g
      buf[i + 2] = r
      buf[i + 3] = inside ? 255 : 0 // BGRA
    }
  }
  return nativeImage.createFromBitmap(buf, { width: n, height: n })
}

export function createTray(win: BrowserWindow, onQuit: () => void): Tray {
  const tray = new Tray(icon())
  tray.setToolTip('Oficina virtual')
  const toggle = () => (win.isVisible() && win.isFocused() ? win.hide() : (win.show(), win.focus()))
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Mostrar / ocultar', click: toggle },
      { type: 'separator' },
      { label: 'Salir', click: onQuit },
    ]),
  )
  tray.on('click', toggle)
  return tray
}
