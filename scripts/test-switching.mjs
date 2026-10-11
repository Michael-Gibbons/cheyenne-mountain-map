import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/')
  async function measure() {
    await page.waitForFunction(() => document.querySelector('select[aria-label="Location or Trail"]')?.disabled === false)
    return page.evaluate(async () => {
      const source = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('/@react-three_fiber.js?'))
      const { _roots } = await import(source)
      const canvas = document.querySelector('canvas')
      const state = _roots.get(canvas).store.getState()
      let mesh
      state.scene.traverse((object) => {
        if (object.isMesh && object.geometry?.attributes.position.count === 66049) mesh = object
      })
      const park = document.querySelector('select[aria-label="Park"]').value
      window.__switchCanvas ||= canvas
      window.__switchTrees ||= {}
      window.__switchTrees[park] ||= mesh.geometry.boundsTree
      const raycaster = state.raycaster
      raycaster.ray.origin.set(state.controls.target.x, 1000, state.controls.target.z)
      raycaster.ray.direction.set(0, -1, 0)
      const start = performance.now()
      for (let index = 0; index < 40; index++) raycaster.intersectObject(mesh, false)
      const raycastMs = performance.now() - start
      const samples = []
      const startFrame = state.gl.info.render.frame
      let previous
      await new Promise((resolve) => {
        const frame = (time) => {
          if (previous !== undefined) samples.push(time - previous)
          previous = time
          if (samples.length < 45) requestAnimationFrame(frame)
          else resolve()
        }
        requestAnimationFrame(frame)
      })
      return {
        park,
        sameCanvas: canvas === window.__switchCanvas,
        sameBvh: mesh.geometry.boundsTree === window.__switchTrees[park],
        accelerated: mesh.raycast.name === 'acceleratedRaycast',
        firstHitOnly: raycaster.firstHitOnly,
        raycastMs,
        averageFrameMs: samples.reduce((total, value) => total + value, 0) / samples.length,
        idleRenderFrames: state.gl.info.render.frame - startFrame,
        drawCalls: state.gl.info.render.calls,
        geometries: state.gl.info.memory.geometries,
      }
    })
  }
  const measurements = [await measure()]
  for (let cycle = 0; cycle < 3; cycle++) {
    for (const park of ['roxborough', 'cheyenne-mountain']) {
      await page.getByRole('combobox', { name: 'Park', exact: true }).selectOption(park)
      measurements.push(await measure())
    }
  }
  for (const result of measurements) {
    assert.ok(result.sameCanvas, 'Switching must preserve the WebGL canvas')
    assert.ok(result.sameBvh, 'Switching must reuse the cached terrain BVH')
    assert.ok(result.accelerated && result.firstHitOnly, 'Every returned terrain mesh must use accelerated raycasts')
    assert.ok(result.raycastMs < 50, 'Forty terrain raycasts unexpectedly exceed 50 ms')
    assert.ok(result.idleRenderFrames <= 6, 'Idle park must stop requesting continuous render work')
  }
  const initial = measurements[0]
  const returned = measurements.at(-1)
  console.log(JSON.stringify({ cycles: 3, measurements }, null, 2))
  assert.ok(returned.drawCalls <= initial.drawCalls + 2, 'Returned park has extra rendering work')
  assert.ok(returned.averageFrameMs <= initial.averageFrameMs * 1.5 + 5, 'Frame pacing degraded after repeated switches')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ cycles: 3, measurements, result: 'pass' }, null, 2))
} finally {
  await browser.close()
}