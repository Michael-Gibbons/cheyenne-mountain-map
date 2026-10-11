import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/')
  await page.waitForFunction(() => document.querySelector('select[aria-label="Location or Trail"]')?.disabled === false)
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true })
  const stateInfo = () => page.evaluate(async () => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/@react-three_fiber.js?'))
    const { _roots } = await import(source)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    const forest = state.scene.getObjectByName('artistic-forest')
    const trace = state.scene.getObjectByName('selected-trail-trace')
    return { trees: forest.children.map((mesh) => mesh.count), frame: state.gl.info.render.frame, tracePresent: Boolean(trace), camera: state.camera.position.toArray(), target: state.controls.target.toArray(), damping: state.controls.enableDamping }
  })
  const forest = await stateInfo()
  assert.equal(forest.trees.length, 3)
  assert.equal(forest.trees[0], forest.trees[1] + forest.trees[2])
  assert.ok(forest.trees[1] > 0 && forest.trees[2] > 0)
  await page.screenshot({ path: fileURLToPath(new URL('../artifacts/mixed-landscape-desktop.png', import.meta.url)) })
  await page.getByRole('combobox', { name: 'Location or Trail', exact: true }).selectOption('trail:Talon Trail')
  await page.waitForFunction(async () => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/@react-three_fiber.js?'))
    const { _roots } = await import(source)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    return state.controls.enableDamping && Math.abs(state.controls.target.x - 9.91755) < 0.01
  }, undefined, { timeout: 30000 })
  const settled = await stateInfo()
  assert.equal(settled.tracePresent, false, 'Trail selection must not create an animated overlay')
  await page.evaluate(() => new Promise((resolve) => {
    let count = 0
    const frame = () => ++count >= 30 ? resolve() : requestAnimationFrame(frame)
    requestAnimationFrame(frame)
  }))
  const idle = await stateInfo()
  assert.ok(idle.frame - settled.frame <= 2, `Camera framing must return to idle rendering: ${JSON.stringify({ settled, idle })}`)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('combobox', { name: 'Location or Trail', exact: true }).selectOption('trail:Dixon Trail')
  await page.waitForFunction(async () => {
    const source = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/@react-three_fiber.js?'))
    const { _roots } = await import(source)
    return !_roots.get(document.querySelector('canvas')).store.getState().scene.getObjectByName('selected-trail-trace')
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Reset park view', exact: true }).click()
  await page.getByRole('button', { name: 'Presentation mode', exact: true }).click()
  await page.screenshot({ path: fileURLToPath(new URL('../artifacts/mixed-landscape-mobile.png', import.meta.url)) })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ mixedTrees: forest.trees, animatedOverlayRemoved: true, idleRenderFrames: idle.frame - settled.frame, reducedMotion: true, mobileOverflow: false }, null, 2))
} finally {
  await browser.close()
}