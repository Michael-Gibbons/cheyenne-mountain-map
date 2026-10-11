import { mkdir, rename, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import ffmpeg from 'ffmpeg-static'

const url = process.env.DEMO_URL || 'http://127.0.0.1:5173/'
const directory = new URL('../artifacts/', import.meta.url)
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: fileURLToPath(directory), size: { width: 1440, height: 900 } },
})
const page = await context.newPage()
const video = page.video()
const errors = []
const chapters = []
page.on('pageerror', (error) => errors.push(error.message))
const started = Date.now()
let recordingStart

async function moveTo(locator) {
  const bounds = await locator.boundingBox()
  if (!bounds) throw new Error('Demo control is not visible.')
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 8 })
}

async function clickControl(locator) {
  await moveTo(locator)
  await locator.click()
}

async function waitForView() {
  await hold(0.15)
  await page.waitForFunction(async () => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => name.includes('/@react-three_fiber.js?'))
    const { _roots } = await import(source)
    return _roots.get(document.querySelector('canvas')).store.getState().controls.enableDamping
  })
}

async function sceneState(operation, value) {
  return page.evaluate(async ({ operation, value }) => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => name.includes('/@react-three_fiber.js?'))
    if (!source) throw new Error('Run this recorder against the Vite development server.')
    const { _roots } = await import(source)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    if (operation === 'rotate') {
      state.controls.autoRotate = value
      state.controls.autoRotateSpeed = 1.2
    }
    if (operation === 'hoverPoint') {
      const group = state.scene.getObjectByName('park-trails')
      const lines = []
      group.traverse((object) => { if (object.geometry?.attributes.instanceStart) lines.push(object) })
      for (const line of lines) {
        const positions = line.geometry.attributes.instanceStart
        for (let index = 0; index < positions.count; index += Math.max(1, Math.floor(positions.count / 20))) {
          const point = state.camera.position.clone().fromBufferAttribute(positions, index).applyMatrix4(line.matrixWorld).project(state.camera)
          const x = (point.x + 1) * state.size.width / 2
          const y = (1 - point.y) * state.size.height / 2
          if (point.z < 1 && x > 340 && x < state.size.width - 80 && y > 200 && y < state.size.height - 200
            && document.elementFromPoint(x, y)?.tagName === 'CANVAS') {
            state.raycaster.setFromCamera({ x: x / state.size.width * 2 - 1, y: 1 - y / state.size.height * 2 }, state.camera)
            const hit = state.raycaster.intersectObjects(group.children, true)[0]
            if (!hit) continue
            let object = hit.object
            while (object.parent && object.parent !== group) object = object.parent
            return { x, y, name: object.name }
          }
        }
      }
      throw new Error('No visible trail point found for the hover demonstration.')
    }
    if (operation === 'validate') {
      state.gl.render(state.scene, state.camera)
      const gl = state.gl.getContext()
      const pixels = new Uint8Array(1440 * 900 * 4)
      gl.readPixels(0, 0, 1440, 900, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let landscapePixels = 0
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 1] > pixels[index] + 8 && pixels[index + 1] > 55) landscapePixels++
      }
      if (landscapePixels < 10000) throw new Error('The recorded landscape is blank.')
      return { landscapePixels, trails: state.scene.getObjectByName('park-trails').children.length }
    }
    if (operation === 'camera') return state.controls.target.toArray()
    if (operation === 'hovered') {
      const highlighted = []
      state.scene.getObjectByName('park-trails').traverse((object) => {
        if (object.material?.linewidth === 6) highlighted.push(object.name)
      })
      return highlighted.length > 0
    }
  }, { operation, value })
}

async function hold(seconds) {
  await page.evaluate((seconds) => new Promise((resolve) => {
    const end = performance.now() + seconds * 1000
    const frame = () => performance.now() >= end ? resolve() : requestAnimationFrame(frame)
    requestAnimationFrame(frame)
  }), seconds)
}

async function chapter(title, caption) {
  chapters.push({ seconds: Math.round((Date.now() - recordingStart) / 100) / 10, title })
  await page.evaluate(({ title, caption }) => {
    document.querySelector('#demo-title').textContent = title
    document.querySelector('#demo-caption').textContent = caption
  }, { title, caption })
}

async function encode(argumentsList) {
  await new Promise((resolve, reject) => {
    const process = spawn(ffmpeg, argumentsList, { stdio: ['ignore', 'ignore', 'pipe'] })
    let output = ''
    process.stderr.on('data', (data) => { output += data.toString() })
    process.on('error', reject)
    process.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(output)))
  })
}

try {
  await page.goto(url)
  await page.getByRole('combobox').waitFor()
  await page.waitForFunction(() => document.querySelector('select')?.disabled === false)
  await page.addStyleTag({ content: `
    #demo-caption-panel { position: fixed; bottom: 58px; left: 310px; z-index: 100;
      max-width: 490px; padding: 10px 16px; background: rgba(17, 23, 22, .94); border-left: 3px solid #edb84c;
      color: #eef4ef; font: 17px/1.35 'Trebuchet MS', sans-serif; pointer-events: none; }
    #demo-title { font-size: 23px; font-weight: 600; margin-bottom: 2px; }
    #demo-caption { color: #c6d7cc; }
    #demo-pointer { position: fixed; width: 22px; height: 22px; border: 2px solid #fff; border-radius: 50%;
      background: rgba(237, 184, 76, .45); transform: translate(-50%, -50%); z-index: 110; pointer-events: none; }
    #demo-pointer.pressed { width: 36px; height: 36px; border-color: #edb84c; background: rgba(237,184,76,.75); }
  ` })
  await page.evaluate(() => {
    const panel = document.createElement('div')
    panel.id = 'demo-caption-panel'
    const title = document.createElement('div')
    title.id = 'demo-title'
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    panel.append(title, caption)
    const pointer = document.createElement('div')
    pointer.id = 'demo-pointer'
    pointer.style.left = '-30px'
    document.body.append(panel, pointer)
    document.addEventListener('pointermove', (event) => {
      pointer.style.left = `${event.clientX}px`
      pointer.style.top = `${event.clientY}px`
    })
    document.addEventListener('pointerdown', () => pointer.classList.add('pressed'))
    document.addEventListener('pointerup', () => pointer.classList.remove('pressed'))
    document.addEventListener('click', () => {
      pointer.animate([{ outline: '0px solid rgba(237,184,76,1)' }, { outline: '18px solid rgba(237,184,76,0)' }], { duration: 350 })
    })
  })
  const validation = await sceneState('validate')
  recordingStart = Date.now()
  await chapter('01 / Move through the mountain', 'Drag to rotate. This is a live 3D landscape.')
  await page.mouse.move(880, 420)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(1030, 480, { steps: 16 })
  await page.mouse.up({ button: 'left' })
  await hold(0.7)

  await chapter('02 / Hover. Click. Follow.', 'The route reacts before you click.')
  const point = await sceneState('hoverPoint')
  await page.mouse.move(point.x, point.y, { steps: 10 })
  await page.waitForFunction(async () => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/@react-three_fiber.js?'))
    const { _roots } = await import(source)
    let highlighted = false
    _roots.get(document.querySelector('canvas')).store.getState().scene.getObjectByName('park-trails').traverse((object) => {
      if (object.material?.linewidth === 6) highlighted = true
    })
    return highlighted
  })
  await hold(0.6)
  await page.mouse.click(point.x, point.y)
  await page.waitForFunction(() => document.querySelector('select').value.startsWith('trail:'))
  const selectedTrail = (await page.getByRole('combobox').inputValue()).slice('trail:'.length)
  await page.evaluate((name) => { document.querySelector('#demo-caption').textContent = `${name} selected. The camera follows the route.` }, selectedTrail)
  await waitForView()
  await hold(0.6)
  await page.screenshot({ path: fileURLToPath(new URL('demo-trail-frame.png', directory)) })

  await chapter('03 / Pan and zoom', 'Right-drag to pan. Scroll into the terrain.')
  const beforePan = await sceneState('camera')
  await page.mouse.move(920, 410)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(1090, 470, { steps: 16 })
  await page.mouse.up({ button: 'right' })
  await hold(0.25)
  const afterPan = await sceneState('camera')
  if (Math.hypot(...afterPan.map((value, index) => value - beforePan[index])) < 0.1) throw new Error('The recorded pan did not move.')
  await page.mouse.wheel(0, -850)
  await hold(0.8)
  await page.mouse.wheel(0, -500)
  await hold(0.5)

  await chapter('04 / Pick a landmark', 'Click the visitor-center icon to move there.')
  await clickControl(page.getByRole('button', { name: 'Reset park view', exact: true }))
  await waitForView()
  const visitor = page.getByRole('button', { name: 'Visitor Center: Visitor Center', exact: true })
  await moveTo(visitor)
  await hold(0.4)
  await clickControl(visitor)
  await page.waitForFunction(() => document.querySelector('select').value === 'location:facility-3117')
  await waitForView()
  await hold(0.8)

  await chapter('05 / Change the landscape', 'Trees off. Trails off. Bring them back.')
  await clickControl(page.getByRole('button', { name: 'Reset park view', exact: true }))
  await waitForView()
  await clickControl(page.getByRole('checkbox', { name: 'Artistic trees', exact: true }))
  await hold(0.45)
  await clickControl(page.getByRole('checkbox', { name: 'Public trails', exact: true }))
  await hold(0.65)
  await clickControl(page.getByRole('checkbox', { name: 'Public trails', exact: true }))
  await clickControl(page.getByRole('checkbox', { name: 'Artistic trees', exact: true }))
  await hold(0.45)

  await chapter('06 / Share this exact view', 'Camera, layers, and selection travel with the link.')
  await clickControl(page.getByRole('button', { name: 'Share this view', exact: true }))
  await page.getByRole('textbox', { name: 'View link', exact: true }).waitFor()
  await hold(0.8)
  await clickControl(page.getByRole('button', { name: 'Close view link', exact: true }))

  await chapter('07 / Export the artwork', 'Create a park-wide PNG with its trail legend.')
  await page.evaluate(() => {
    const original = HTMLAnchorElement.prototype.click
    window.__restoreDemoDownload = () => { HTMLAnchorElement.prototype.click = original }
    HTMLAnchorElement.prototype.click = function () {
      if (this.download === 'cheyenne-mountain-landscape.png') {
        window.__demoExport = fetch(this.href).then((response) => response.blob()).then(createImageBitmap)
      } else original.call(this)
    }
  })
  await clickControl(page.getByRole('button', { name: 'Export artwork PNG', exact: true }))
  await hold(0.3)
  await clickControl(page.getByRole('button', { name: 'Park overview', exact: true }))
  await page.waitForFunction(() => Boolean(window.__demoExport))
  await page.evaluate(async () => {
    const bitmap = await window.__demoExport
    window.__restoreDemoDownload()
    const preview = document.createElement('canvas')
    preview.id = 'demo-export-preview'
    preview.width = bitmap.width
    preview.height = bitmap.height
    preview.getContext('2d').drawImage(bitmap, 0, 0)
    preview.style.cssText = 'position:fixed;right:200px;top:80px;width:680px;max-height:680px;object-fit:contain;z-index:90;border:2px solid #edb84c;background:#202426;'
    document.body.append(preview)
  })
  await page.screenshot({ path: fileURLToPath(new URL('demo-export-frame.png', directory)) })
  await hold(1.3)

  await chapter('08 / Just the mountain', 'Presentation mode. No panel. Keep exploring.')
  await page.evaluate(() => { document.querySelector('#demo-export-preview')?.remove() })
  await clickControl(page.getByRole('button', { name: 'Presentation mode', exact: true }))
  await page.mouse.move(870, 380)
  await page.mouse.down({ button: 'left' })
  await page.mouse.move(1060, 430, { steps: 16 })
  await page.mouse.up({ button: 'left' })
  await hold(1)
  await page.screenshot({ path: fileURLToPath(new URL('demo-preview.png', directory)) })
  const duration = (Date.now() - recordingStart) / 1000
  await context.close()
  const raw = new URL('cheyenne-mountain-demo.webm', directory)
  await rename(await video.path(), fileURLToPath(raw))
  const targetDuration = 36
  const paced = new URL('demo-paced.mp4', directory)
  await encode(['-y', '-ss', String((recordingStart - started) / 1000), '-i', fileURLToPath(raw),
    '-t', String(duration), '-vf', `setpts=${targetDuration / duration}*PTS`, '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    fileURLToPath(paced)])
  const prefixEnd = chapters[6].seconds * targetDuration / duration + 1.5
  const closingStart = chapters[7].seconds * targetDuration / duration + 0.6
  const filter = `[0:v]trim=end=${prefixEnd},setpts=PTS-STARTPTS[first];[1:v]fps=30,trim=duration=2.5,setpts=PTS-STARTPTS[export];[0:v]trim=start=${closingStart}:end=${closingStart + 3},setpts=PTS-STARTPTS[last];[first][export][last]concat=n=3:v=1:a=0[out]`
  await encode(['-y', '-i', fileURLToPath(paced), '-loop', '1', '-t', '2.5', '-i', fileURLToPath(new URL('demo-export-frame.png', directory)),
    '-filter_complex', filter, '-map', '[out]', '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    fileURLToPath(new URL('cheyenne-mountain-demo.mp4', directory))])
  await encode(['-v', 'error', '-i', fileURLToPath(new URL('cheyenne-mountain-demo.mp4', directory)), '-f', 'null', '-'])
  if (errors.length) throw new Error(`The recording contains page errors: ${errors.join('; ')}`)
  await writeFile(new URL('demo-chapters.json', directory), JSON.stringify({ recordingWallTimeSeconds: duration, targetPlaybackSeconds: prefixEnd + 5.5, timingNote: 'Chapter offsets are approximate playback offsets after jump cuts; export generation wait is replaced by the actual result frame.', resolution: [1440, 900], narration: 'Concise on-screen captions and pointer/click feedback; no audio', validation, chapters: chapters.map((chapter, index) => ({ ...chapter, seconds: Math.round((index === 7 ? prefixEnd + 2.5 : chapter.seconds * targetDuration / duration) * 10) / 10 })) }, null, 2) + '\n')
  console.log(JSON.stringify({ video: 'artifacts/cheyenne-mountain-demo.mp4', durationSeconds: duration, chapters: chapters.length, validation }, null, 2))
} finally {
  await browser.close()
}