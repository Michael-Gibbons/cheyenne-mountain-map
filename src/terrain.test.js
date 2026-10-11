import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import proj4 from 'proj4'
import { applyContourShading, createTerrain } from './terrain.js'
import { declutterLandmarks, drapePath, overlayOffset, preparePark } from './park.js'
import { createForest, treeClearance } from './forest.js'
import { createViewLink, isPublishedUrl, readViewLink } from './viewLink.js'
import { Vector3 } from 'three'

const bytes = await readFile(new URL('../public/terrain/cheyenne-mountain.tif', import.meta.url))
const terrain = await createTerrain(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
after(() => {
  terrain.geometry.dispose()
  terrain.baseGeometry.dispose()
})

test('sculpted base follows the terrain rim and closes at a shallow flat underside', () => {
  const base = terrain.baseGeometry.getAttribute('position')
  const perimeterCount = 2 * terrain.width + 2 * terrain.height - 4
  assert.equal(base.count, perimeterCount * 6 + 6)
  assert.equal(terrain.baseGeometry.boundingBox.min.y, -2)
  assert.equal(terrain.baseGeometry.boundingBox.min.x, terrain.geometry.boundingBox.min.x)
  assert.equal(terrain.baseGeometry.boundingBox.max.z, terrain.geometry.boundingBox.max.z)
  const surface = terrain.geometry.getAttribute('position')
  for (let column = 0; column < terrain.width - 1; column++) {
    assert.equal(base.getY(column * 6), surface.getY(column))
    assert.equal(base.getY(column * 6 + 2), -2)
  }
})

test('contour artwork uses an antialiased material without additional terrain geometry', () => {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <color_fragment>',
  }
  applyContourShading(shader)
  assert.equal(shader.uniforms.contourSpacing.value, 20 * terrain.sceneUnitsPerMeter)
  assert.ok(shader.vertexShader.includes('reliefHeight = position.y'))
  assert.ok(shader.fragmentShader.includes('fwidth(contourLevel)'))
  assert.equal(terrain.geometry.attributes.position.count, 66049)
})

test('DEM creates a non-flat mesh with a consistent meter scale', () => {
  assert.equal(terrain.width, 257)
  assert.equal(terrain.height, 257)
  assert.equal(terrain.geometry.attributes.position.count, 66049)
  assert.ok(terrain.minElevation > 1700)
  assert.ok(terrain.maxElevation - terrain.minElevation > 500)
  assert.ok(Math.abs(terrain.geometry.boundingBox.max.y - terrain.maxHeight) < 0.00001)
  assert.equal(terrain.geometry.boundingBox.min.y, 0)
})

test('pixel-center projection aligns with mesh vertices and north is negative Z', () => {
  const [west, south, east, north] = terrain.bounds
  const column = 40
  const row = 30
  const easting = west + (column + 0.5) * (east - west) / terrain.width
  const northing = north - (row + 0.5) * (north - south) / terrain.height
  const [longitude, latitude] = proj4(
    '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs',
    'EPSG:4326',
    [easting, northing],
  )
  const point = terrain.geographicToScene(longitude, latitude)
  assert.ok(Math.abs(terrain.sampleHeight(point.x, point.z) - point.y) < 0.00001)
  const positions = terrain.geometry.attributes.position
  const index = row * terrain.width + column
  assert.ok(Math.abs(point.x - positions.getX(index)) < 0.00001)
  assert.ok(Math.abs(point.y - positions.getY(index)) < 0.00001)
  assert.ok(Math.abs(point.z - positions.getZ(index)) < 0.00001)
  assert.ok(point.x < 0 && point.z < 0)
})

test('park coordinates are covered and points outside the DEM are rejected', () => {
  const park = terrain.geographicToScene(-104.853, 38.738)
  assert.ok(park && park.y >= 0 && park.y <= terrain.maxHeight)
  assert.equal(terrain.geographicToScene(0, 0), null)
  assert.equal(terrain.sampleElevation(0, 0), null)
  assert.equal(terrain.sampleHeight(100000, 100000), null)
})

test('public park layers contain valid local WGS84 geometry and source records', async () => {
  const directory = new URL('../public/park/', import.meta.url)
  const sources = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8'))
  const layers = {
    boundary: ['Polygon', 'MultiPolygon'],
    trails: ['LineString', 'MultiLineString'],
    facilities: ['Point'],
    trailheads: ['Point'],
  }
  function checkCoordinates(coordinates) {
    assert.ok(Array.isArray(coordinates) && coordinates.length > 0)
    if (typeof coordinates[0] === 'number') {
      const [longitude, latitude] = coordinates
      assert.ok(Number.isFinite(longitude) && longitude > -105 && longitude < -104)
      assert.ok(Number.isFinite(latitude) && latitude > 38 && latitude < 39)
      assert.ok(terrain.geographicToScene(longitude, latitude), 'Park geometry must fit inside the DEM')
      return
    }
    coordinates.forEach(checkCoordinates)
  }
  for (const [name, types] of Object.entries(layers)) {
    const collection = JSON.parse(await readFile(new URL(`${name}.geojson`, directory), 'utf8'))
    assert.equal(collection.type, 'FeatureCollection')
    assert.ok(collection.features.length > 0)
    const source = sources.downloads.find(download => download.file === name)
    assert.equal(source.features, collection.features.length)
    assert.ok(source.attribution && source.queryUrl.startsWith('https://'))
    for (const feature of collection.features) {
      assert.equal(feature.type, 'Feature')
      assert.ok(types.includes(feature.geometry.type))
      checkCoordinates(feature.geometry.coordinates)
    }
  }
})

test('park overlays follow mesh triangles and preserve multipart trails and boundary rings', async () => {
  const entries = await Promise.all(['boundary', 'trails', 'facilities', 'trailheads'].map(async (name) => [
    name,
    JSON.parse(await readFile(new URL(`../public/park/${name}.geojson`, import.meta.url), 'utf8')),
  ]))
  const collections = Object.fromEntries(entries)
  const park = preparePark(terrain, collections)
  const colors = new Map()
  for (const trail of park.trails) {
    if (colors.has(trail.name)) assert.equal(trail.color, colors.get(trail.name))
    colors.set(trail.name, trail.color)
  }
  assert.equal(new Set(colors.values()).size, colors.size)
  assert.ok(Math.abs(park.center.x) < 0.001 && Math.abs(park.center.z) < 0.001, 'The park boundary must be centered in the DEM')
  const pathCount = collections.trails.features.reduce((count, feature) => count
    + (feature.geometry.type === 'LineString' ? 1 : feature.geometry.coordinates.length), 0)
  assert.equal(park.trails.length, pathCount)
  assert.ok(park.boundary.length > 0)
  assert.ok(park.locations.some((location) => location.name === 'Visitor Center'))
  assert.ok(!park.locations.some((location) => location.name === 'Maintenance Shop'))
  const trees = createForest(terrain, park)
  assert.ok(trees.length > 200 && trees.length <= 1000)
  assert.deepEqual(createForest(terrain, park), trees)
  const trailPoints = park.trails.flatMap((trail) => trail.points)
  for (const tree of trees) {
    assert.ok(Math.abs(tree.position.y - terrain.sampleHeight(tree.position.x, tree.position.z)) < 0.00001)
    assert.ok(tree.radius < treeClearance)
    assert.ok(trailPoints.every((point) => (point.x - tree.position.x) ** 2 + (point.z - tree.position.z) ** 2 >= treeClearance ** 2))
    assert.ok(park.locations.every((point) => (point.position.x - tree.position.x) ** 2 + (point.position.z - tree.position.z) ** 2 >= 1.2 ** 2))
  }
  for (const location of park.locations) {
    const surface = terrain.geographicToScene(...location.coordinates)
    assert.equal(location.position.x, surface.x)
    assert.equal(location.position.z, surface.z)
    assert.ok(Math.abs(location.position.y - surface.y - 0.01) < 0.00001, 'POI anchors must sit on the surface, not at the trail overlay height')
  }
  const coordinates = collections.trails.features.find((feature) => feature.geometry.type === 'LineString').geometry.coordinates
  const points = drapePath(terrain, coordinates)
  assert.ok(points.length >= coordinates.length)
  assert.ok(Math.abs(points[0].y - terrain.geographicToScene(...coordinates[0]).y - overlayOffset) < 0.00001)
  for (const trail of park.trails) {
    for (let index = 1; index < trail.points.length; index++) {
      const previous = trail.points[index - 1]
      const current = trail.points[index]
      assert.ok(Math.hypot(current.x - previous.x, current.z - previous.z) <= 5.01 * terrain.sceneUnitsPerMeter)
    }
  }
  assert.throws(() => drapePath(terrain, [[0, 0], [1, 1]]), /outside the DEM/)
})

test('landmark decluttering favors selection and reveals separated markers', () => {
  const points = [
    { id: 'camp', x: 100, y: 100, priority: 5 },
    { id: 'selected', x: 110, y: 105, priority: 0 },
    { id: 'overlook', x: 250, y: 100, priority: 3 },
  ]
  assert.deepEqual([...declutterLandmarks(points)], ['selected', 'overlook'])
  points[0].x = 20
  assert.equal(declutterLandmarks(points).size, 3)
})

test('view links round-trip camera and layers and reject invalid camera data', () => {
  const state = { camera: { position: new Vector3(40, 30, 20) }, controls: { target: new Vector3(10, 5, 2) } }
  const layers = { boundary: true, trails: true, locations: false, trees: true }
  const url = createViewLink('https://example.org/map', state, 'trail:Talon Trail', layers, true)
  const view = readViewLink(url)
  assert.deepEqual(view.camera, [40, 30, 20])
  assert.deepEqual(view.layers, layers)
  assert.equal(view.selected, 'trail:Talon Trail')
  assert.equal(readViewLink('https://example.org/?view=broken'), null)
  const invalid = new URL(url)
  invalid.searchParams.set('view', JSON.stringify({ ...view, camera: [0, -100, 0] }))
  assert.equal(readViewLink(invalid.href), null)
  assert.equal(isPublishedUrl('http://127.0.0.1:5173'), false)
  assert.equal(isPublishedUrl('http://192.168.1.2'), false)
  assert.equal(isPublishedUrl('https://example.org/map'), true)
})