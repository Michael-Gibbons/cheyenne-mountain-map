import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const assets = [
  'terrain/cheyenne-mountain.tif',
  'terrain/cheyenne-mountain.json',
  'park/boundary.geojson',
  'park/trails.geojson',
  'park/facilities.geojson',
  'park/trailheads.geojson',
  'park/sources.json',
]
for (const asset of assets) {
  const source = await readFile(new URL(`../public/${asset}`, import.meta.url))
  const built = await readFile(new URL(`../dist/${asset}`, import.meta.url))
  assert.ok(source.equals(built), `Production snapshot differs: ${asset}`)
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.geojson': 'application/geo+json', '.json': 'application/json', '.tif': 'image/tiff' }
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    if (!pathname.startsWith('/map/')) {
      response.writeHead(404).end()
      return
    }
    const file = pathname.slice('/map/'.length) || 'index.html'
    if (file.includes('..')) throw new Error('Invalid path')
    const content = await readFile(new URL(`../dist/${file}`, import.meta.url))
    const extension = file.slice(file.lastIndexOf('.'))
    response.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream' }).end(content)
  } catch {
    response.writeHead(404).end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const external = []
  const failed = []
  const errors = []
  const loaded = new Set()
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) {
      external.push(url.href)
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(response.url())
    if (response.ok()) loaded.add(new URL(response.url()).pathname.slice('/map/'.length))
  })
  await page.goto(`${origin}/map/`)
  await page.waitForFunction(() => document.querySelector('select')?.disabled === false)
  for (const asset of assets.filter((asset) => asset.endsWith('.tif') || asset.endsWith('.geojson'))) {
    assert.ok(loaded.has(asset), `Runtime did not load local data: ${asset}`)
  }
  const screenshot = await page.locator('canvas').screenshot()
  const landscapePixels = await page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 1] > pixels[index] + 8 && pixels[index + 1] > 55) count++
    }
    return count
  }, screenshot.toString('base64'))
  assert.ok(landscapePixels > 10000, 'Production landscape is blank')
  assert.deepEqual(external, [], 'Runtime attempted external requests')
  assert.deepEqual(failed, [], 'Static asset requests failed')
  assert.deepEqual(errors, [], 'Production browser errors')
  console.log(JSON.stringify({ localSnapshots: assets.length, externalRequests: external.length, landscapePixels, subfolder: '/map/', result: 'pass' }, null, 2))
} finally {
  await browser?.close()
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}