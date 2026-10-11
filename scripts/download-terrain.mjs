import { mkdir, readFile, writeFile } from 'node:fs/promises'
import proj4 from 'proj4'

const service = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer'
const projection = '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs'
const parkBounds = [Infinity, Infinity, -Infinity, -Infinity]
const allPoints = []
function includeCoordinates(coordinates, isBoundary) {
  if (typeof coordinates[0] === 'number') {
    const [easting, northing] = proj4('EPSG:4326', projection, coordinates.slice(0, 2))
    allPoints.push([easting, northing])
    if (isBoundary) {
      parkBounds[0] = Math.min(parkBounds[0], easting)
      parkBounds[1] = Math.min(parkBounds[1], northing)
      parkBounds[2] = Math.max(parkBounds[2], easting)
      parkBounds[3] = Math.max(parkBounds[3], northing)
    }
    return
  }
  coordinates.forEach((coordinate) => includeCoordinates(coordinate, isBoundary))
}
for (const name of ['boundary', 'trails', 'facilities', 'trailheads']) {
  const collection = JSON.parse(await readFile(new URL(`../public/park/${name}.geojson`, import.meta.url), 'utf8'))
  collection.features.forEach((feature) => includeCoordinates(feature.geometry.coordinates, name === 'boundary'))
}
const centerX = (parkBounds[0] + parkBounds[2]) / 2
const centerY = (parkBounds[1] + parkBounds[3]) / 2
const halfSize = Math.max(...allPoints.map(([easting, northing]) => Math.max(
  Math.abs(easting - centerX), Math.abs(northing - centerY),
))) + 400
const bounds = [centerX - halfSize, centerY - halfSize, centerX + halfSize, centerY + halfSize]
const parameters = new URLSearchParams({
  f: 'json',
  bbox: bounds.join(','),
  bboxSR: '32613',
  imageSR: '32613',
  size: '257,257',
  format: 'tiff',
  pixelType: 'F32',
  interpolation: 'RSP_BilinearInterpolation',
  renderingRule: JSON.stringify({ rasterFunction: 'None' }),
})

const exportUrl = `${service}/exportImage?${parameters}`
const response = await fetch(exportUrl, { signal: AbortSignal.timeout(120000) })
if (!response.ok) throw new Error(`USGS export failed: ${response.status}`)
const result = await response.json()
if (result.error || !result.href) {
  throw new Error(`USGS export failed: ${JSON.stringify(result.error ?? result)}`)
}

const imageResponse = await fetch(result.href, { signal: AbortSignal.timeout(120000) })
if (!imageResponse.ok) throw new Error(`DEM download failed: ${imageResponse.status}`)
const image = await imageResponse.arrayBuffer()
const directory = new URL('../public/terrain/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('cheyenne-mountain.tif', directory), Buffer.from(image))
await writeFile(new URL('cheyenne-mountain.json', directory), JSON.stringify({
  source: 'USGS National Map 3D Elevation Program (3DEP)',
  service,
  exportUrl,
  downloadedAt: new Date().toISOString(),
  requestedBoundsUtm13N: bounds,
  horizontalCrs: 'EPSG:32613',
  elevationUnits: 'meters',
  extent: result.extent,
  width: result.width,
  height: result.height,
  note: 'Square extent centered on the CPW park boundary, including all reference layers with 400 meters of padding. Resampled service mosaic; output spacing is not native source resolution. Preserve source vertical datum when comparing GPX elevations.',
}, null, 2) + '\n')
console.log(JSON.stringify({ bytes: image.byteLength, extent: result.extent, width: result.width, height: result.height }, null, 2))