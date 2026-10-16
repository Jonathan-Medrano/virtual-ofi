// Renderer: monta la oficina (office/) y muestra las sesiones. Mientras la Task 8 (personajes) no esté integrada,
// las sesiones se ven en el listado de texto de la esquina.
import * as THREE from 'three'
import { buildOffice, createOfficeCamera } from '../../office/src/index'
import type { SessionsPayload } from '../api'
import { initSetup } from './setup'

const canvas = document.getElementById('ofi') as HTMLCanvasElement
const rows = document.getElementById('rows')!

const STATUS_ES: Record<string, string> = { working: 'trabajando', waiting: 'esperando', idle: 'libre', closed: 'cerrada' }

function renderList(p: SessionsPayload) {
  rows.textContent = ''
  if (!p.sessions.length) {
    const d = document.createElement('div')
    d.className = 'empty'
    d.textContent = 'No hay sesiones activas.'
    rows.append(d)
    return
  }
  for (const s of p.sessions.filter(x => x.status !== 'closed')) {
    const r = document.createElement('div')
    r.className = 'row'
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = p.colors[s.account] ?? '#888'
    const name = document.createElement('span')
    name.textContent = `${s.project} · ${s.pc}`
    const st = document.createElement('span')
    st.className = 'st ' + s.status
    st.textContent = STATUS_ES[s.status] ?? s.status
    r.title = s.account
    r.append(dot, name, st)
    rows.append(r)
  }
}

function mountOffice() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x15171a)
  const office = buildOffice()
  scene.add(office.group)
  const cam = createOfficeCamera(canvas, { preset: 'entrada' })
  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    cam.camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    cam.camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()
  // TODO (Task 8): al llegar sesiones, assignSeats(office.seats, ids) y createCharacter(...) por sesión; mover/quitar
  // personajes según el estado. Hoy `office.seats` está disponible pero no se pobló ningún personaje.
  let last = performance.now()
  const frame = (now: number) => {
    cam.update(Math.min(0.1, (now - last) / 1000))
    last = now
    renderer.render(scene, cam.camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

try {
  mountOffice()
} catch {
  // Sin WebGL el listado igual funciona.
}
window.ofi.onSessions(renderList)
void initSetup()
