// Renderer: monta la oficina (office/) con un personaje por sesión y un panel liviano con el listado de texto.
// Modo Demo (botón "Demo" o ?demo): en vez de las sesiones reales usa el simulador de la oficina (createDemoFeed).
// Modo recorrido (botón "Recorrer" o ?walk): primera persona por la oficina; Esc vuelve a la cámara libre como estaba.
import * as THREE from 'three'
import { buildOffice, createOfficeCamera } from '../../office/src/index'
import { createCrowd, accountColor, type Crowd } from '../../office/src/character'
import { createDemoFeed, type DemoFeed } from '../../office/src/demo'
import { createWalkView, type WalkView } from '../../office/src/walk-view'
import type { SessionSnapshot } from '../../core/identity'
import type { SessionsPayload } from '../api'
import { panelRows, countLine, hexToInt, statusEs } from './panel'
import { initSetup } from './setup'

const canvas = document.getElementById('ofi') as HTMLCanvasElement
const listEl = document.getElementById('list')!
const rows = document.getElementById('rows')!
const cnt = document.getElementById('cnt')!
const hideBtn = document.getElementById('hide')!
const demoBtn = document.getElementById('demo')!
const walkBtn = document.getElementById('walk') as HTMLButtonElement

const store = {
  get(k: string) { try { return localStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { localStorage.setItem(k, v) } catch { /* sin almacenamiento: no se recuerda */ } },
}

let real: SessionsPayload = { sessions: [], colors: {} }
let demoOn = new URLSearchParams(location.search).has('demo')
let demoFeed: DemoFeed | null = null
let demoSnaps: SessionSnapshot[] = []
let crowd: Crowd | null = null
let colors: Record<string, string> = {}
let walk: WalkView | null = null
let enterWalk: () => void = () => {}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const current = (): SessionSnapshot[] => (demoOn ? demoSnaps : real.sessions)

function renderList() {
  const sessions = current()
  rows.textContent = ''
  cnt.textContent = '· ' + countLine(sessions)
  const list = panelRows(sessions)
  if (!list.length) {
    const d = document.createElement('div')
    d.className = 'empty'
    d.textContent = demoOn ? 'Demo: esperando sesiones de ejemplo...' : 'No hay sesiones activas.'
    rows.append(d)
    return
  }
  for (const s of list) {
    const r = document.createElement('div')
    r.className = 'row'
    const dot = document.createElement('span')
    dot.className = 'dot'
    dot.style.background = colors[s.account] ?? hex(accountColor(s.account))
    const name = document.createElement('span')
    name.textContent = s.text
    const st = document.createElement('span')
    st.className = 'st ' + s.status
    st.textContent = statusEs(s.status)
    r.title = s.account
    r.append(dot, name, st)
    rows.append(r)
  }
}

function apply() {
  colors = demoOn ? {} : real.colors
  crowd?.sync(current())
  renderList()
}

function setDemo(on: boolean) {
  demoOn = on
  demoBtn.classList.toggle('on', on)
  demoBtn.textContent = on ? 'Demo (activa)' : 'Demo'
  if (on) { demoFeed = createDemoFeed(); demoSnaps = demoFeed.tick() } else { demoFeed = null; demoSnaps = [] }
  apply()
}

function setHidden(h: boolean) {
  listEl.classList.toggle('min', h)
  hideBtn.textContent = h ? 'mostrar' : 'ocultar'
  store.set('ofi.listHidden', h ? '1' : '0')
}

function mountOffice() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x15171a)
  const office = buildOffice()
  scene.add(office.group)
  crowd = createCrowd(scene, office.seats, office.extraSeats, { shirtOf: a => hexToInt(colors[a]) })
  const cam = createOfficeCamera(canvas, { preset: 'alto' })
  walk = createWalkView({
    canvas,
    crowd: () => crowd,
    sessionOf: id => current().find(s => s.id === id),
    statusText: statusEs,
    onExit: () => { cam.setEnabled(true); document.body.classList.remove('walking') },
  })
  enterWalk = () => { cam.setEnabled(false); document.body.classList.add('walking'); walk!.enter() }
  const resize = () => {
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false)
    cam.camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight)
    cam.camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize)
  resize()
  let last = performance.now(), feedAcc = 0
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (demoOn && demoFeed) {
      feedAcc += dt
      if (feedAcc >= 1) { feedAcc = 0; demoSnaps = demoFeed.tick(); apply() }
    }
    crowd!.update(dt)
    if (walk!.active) walk!.update(dt); else cam.update(dt)
    renderer.render(scene, walk!.active ? walk!.camera : cam.camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

try {
  mountOffice()
} catch {
  crowd = null // sin WebGL el listado igual funciona
  walkBtn.disabled = true
}
hideBtn.addEventListener('click', () => setHidden(!listEl.classList.contains('min')))
demoBtn.addEventListener('click', () => setDemo(!demoOn))
walkBtn.addEventListener('click', () => enterWalk())
setHidden(store.get('ofi.listHidden') === '1')
if (demoOn) setDemo(true)
if (new URLSearchParams(location.search).has('walk')) enterWalk()
window.ofi.onSessions(p => { real = p; if (!demoOn) apply() })
void initSetup()
