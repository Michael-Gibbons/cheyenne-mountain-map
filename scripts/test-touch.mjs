import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  const page = await context.newPage()
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/')
  await page.waitForFunction(() => document.querySelector('select')?.disabled === false)
  const session = await context.newCDPSession(page)
  const sample = () => page.evaluate(async () => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/@react-three_fiber.js?'))
    const { _roots } = await import(source)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    return { target: state.controls.target.toArray(), distance: state.controls.getDistance(), azimuth: state.controls.getAzimuthalAngle(), cursorZoom: state.controls.zoomToCursor }
  })
  const settle = () => page.evaluate(() => new Promise((resolve) => {
    let frames = 0
    const next = () => ++frames >= 30 ? resolve() : requestAnimationFrame(next)
    requestAnimationFrame(next)
  }))
  const touch = (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints })
  async function drag() {
    const point = await page.evaluate(() => {
      const canvas = document.querySelector('canvas')
      for (let vertical = 200; vertical < 450; vertical += 40) {
        for (let horizontal = 50; horizontal < 250; horizontal += 40) {
          if (Array.from({ length: 11 }, (_, index) => document.elementFromPoint(horizontal + index * 7, vertical)).every((element) => element === canvas)) {
            return { x: horizontal, y: vertical }
          }
        }
      }
      throw new Error('No unobstructed canvas gesture path')
    })
    await touch('touchStart', [{ x: point.x, y: point.y, id: 1 }])
    for (let step = 1; step <= 10; step++) await touch('touchMove', [{ x: point.x + step * 7, y: point.y, id: 1 }])
    await touch('touchEnd', [])
    await settle()
  }
  const before = await sample()
  await drag()
  const panned = await sample()
  assert.ok(Math.hypot(...panned.target.map((value, index) => value - before.target[index])) > 0.1, `One finger must pan: ${JSON.stringify({ before, panned })}`)
  await touch('touchStart', [{ x: 130, y: 340, id: 1 }, { x: 230, y: 340, id: 2 }])
  for (let step = 1; step <= 10; step++) {
    await touch('touchMove', [{ x: 130 - step * 3, y: 340, id: 1 }, { x: 230 + step * 3, y: 340, id: 2 }])
  }
  await touch('touchEnd', [])
  await settle()
  const pinched = await sample()
  assert.ok(pinched.distance < panned.distance, 'Pinch must zoom')
  assert.ok(Math.abs(pinched.azimuth - panned.azimuth) < 0.01, 'Pinch must not rotate')
  await page.getByRole('button', { name: 'Rotate map', exact: true }).tap()
  await drag()
  const rotated = await sample()
  assert.ok(Math.abs(rotated.azimuth - pinched.azimuth) > 0.1, 'Rotate mode must orbit')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).tap()
  await settle()
  await settle()
  const zoomed = await sample()
  assert.ok(zoomed.distance < rotated.distance, 'Zoom button must reduce distance')
  assert.equal(await page.getByRole('combobox').inputValue(), '', 'Gestures must not select trails')
  assert.equal(before.cursorZoom, false)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.getByRole('button', { name: 'Move map', exact: true }).tap()
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
  await page.screenshot({ path: new URL('../artifacts/mobile-navigation.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') })
  console.log(JSON.stringify({ oneFingerPan: true, pinchZoomWithoutRotation: true, rotateMode: true, zoomButton: true, noAccidentalSelection: true }, null, 2))
} finally {
  await browser.close()
}