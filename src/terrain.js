import { fromArrayBuffer } from 'geotiff'
import proj4 from 'proj4'
import { BufferGeometry, Color, Float32BufferAttribute, Loader, PlaneGeometry, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'

const projection = '+proj=utm +zone=13 +datum=WGS84 +units=m +no_defs'
const sceneUnitsPerMeter = 0.025

export function createTerrainBase(geometry, width, height, depth = 2) {
  const positions = geometry.getAttribute('position')
  const perimeter = []
  for (let column = 0; column < width; column++) perimeter.push(column)
  for (let row = 1; row < height; row++) perimeter.push(row * width + width - 1)
  for (let column = width - 2; column >= 0; column--) perimeter.push((height - 1) * width + column)
  for (let row = height - 2; row > 0; row--) perimeter.push(row * width)
  const vertices = []
  function vertex(index, bottom = false) {
    vertices.push(positions.getX(index), bottom ? -depth : positions.getY(index), positions.getZ(index))
  }
  for (let index = 0; index < perimeter.length; index++) {
    const first = perimeter[index]
    const next = perimeter[(index + 1) % perimeter.length]
    vertex(first)
    vertex(next)
    vertex(next, true)
    vertex(first)
    vertex(next, true)
    vertex(first, true)
  }
  const corners = [0, width - 1, width * height - 1, width * (height - 1)]
  for (const index of [0, 1, 2, 0, 2, 3]) vertex(corners[index], true)
  const base = new BufferGeometry()
  base.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  base.computeVertexNormals()
  base.computeBoundingBox()
  base.computeBoundingSphere()
  return base
}

export function applyContourShading(shader) {
  shader.uniforms.contourSpacing = { value: 20 * sceneUnitsPerMeter }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float reliefHeight;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nreliefHeight = position.y;')
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float reliefHeight;\nuniform float contourSpacing;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float contourLevel = reliefHeight / contourSpacing;
      float contourDistance = abs(fract(contourLevel + 0.5) - 0.5);
      float contourWidth = max(fwidth(contourLevel), 0.012);
      float contourInk = 1.0 - smoothstep(0.0, contourWidth, contourDistance);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.24, 0.20), contourInk * 0.25);
    `)
}

export async function createTerrain(buffer) {
  const tiff = await fromArrayBuffer(buffer)
  const image = await tiff.getImage()
  if (image.getGeoKeys().ProjectedCSTypeGeoKey !== 32613) {
    throw new Error('Expected a UTM Zone 13N elevation raster (EPSG:32613).')
  }
  const width = image.getWidth()
  const height = image.getHeight()
  const [elevations] = await image.readRasters({ samples: [0] })
  const noData = image.getGDALNoData()
  let minElevation = Infinity
  let maxElevation = -Infinity
  for (const elevation of elevations) {
    if (!Number.isFinite(elevation) || elevation === noData) {
      throw new Error('The DEM contains missing elevations. Download a complete raster.')
    }
    minElevation = Math.min(minElevation, elevation)
    maxElevation = Math.max(maxElevation, elevation)
  }

  const bounds = image.getBoundingBox()
  const [west, south, east, north] = bounds
  const spacingX = (east - west) / width
  const spacingY = (north - south) / height
  const centerX = (west + east) / 2
  const centerY = (south + north) / 2
  const geometry = new PlaneGeometry(
    spacingX * (width - 1) * sceneUnitsPerMeter,
    spacingY * (height - 1) * sceneUnitsPerMeter,
    width - 1,
    height - 1,
  )
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.getAttribute('position')
  const colors = new Float32Array(width * height * 3)
  const lowColor = new Color('#668e78')
  const middleColor = new Color('#9cad95')
  const highColor = new Color('#e0e6df')
  const meadowColor = new Color('#afbc87')
  const color = new Color()
  for (let index = 0; index < elevations.length; index++) {
    const elevation = elevations[index]
    positions.setY(index, (elevation - minElevation) * sceneUnitsPerMeter)
    const fraction = (elevation - minElevation) / (maxElevation - minElevation || 1)
    if (fraction < 0.5) {
      color.copy(lowColor).lerp(middleColor, fraction * 2)
    } else {
      color.copy(middleColor).lerp(highColor, (fraction - 0.5) * 2)
    }
    const sceneX = positions.getX(index)
    const sceneZ = positions.getZ(index)
    const meadow = Math.max(0, Math.sin(sceneX * 0.12 + Math.cos(sceneZ * 0.1)) * Math.cos(sceneZ * 0.09))
    color.lerp(meadowColor, meadow * Math.max(0, 1 - fraction * 1.6) * 0.22)
    color.toArray(colors, index * 3)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.boundsTree = new MeshBVH(geometry, { indirect: true })

  function sampleElevation(easting, northing) {
    if (easting < west || easting > east || northing < south || northing > north) {
      return null
    }
    const column = Math.max(0, Math.min(width - 1, (easting - west) / spacingX - 0.5))
    const row = Math.max(0, Math.min(height - 1, (north - northing) / spacingY - 0.5))
    const column0 = Math.floor(column)
    const row0 = Math.floor(row)
    const column1 = Math.min(column0 + 1, width - 1)
    const row1 = Math.min(row0 + 1, height - 1)
    const horizontal = column - column0
    const vertical = row - row0
    const topLeft = elevations[row0 * width + column0]
    const topRight = elevations[row0 * width + column1]
    const bottomLeft = elevations[row1 * width + column0]
    const bottomRight = elevations[row1 * width + column1]
    if (horizontal + vertical <= 1) {
      return topLeft + horizontal * (topRight - topLeft) + vertical * (bottomLeft - topLeft)
    }
    return bottomRight + (1 - horizontal) * (bottomLeft - bottomRight) + (1 - vertical) * (topRight - bottomRight)
  }

  function geographicToScene(longitude, latitude) {
    const [easting, northing] = proj4('EPSG:4326', projection, [longitude, latitude])
    const elevation = sampleElevation(easting, northing)
    if (elevation === null) return null
    return new Vector3(
      (easting - centerX) * sceneUnitsPerMeter,
      (elevation - minElevation) * sceneUnitsPerMeter,
      (centerY - northing) * sceneUnitsPerMeter,
    )
  }

  function sampleHeight(sceneX, sceneZ) {
    const elevation = sampleElevation(centerX + sceneX / sceneUnitsPerMeter, centerY - sceneZ / sceneUnitsPerMeter)
    return elevation === null ? null : (elevation - minElevation) * sceneUnitsPerMeter
  }

  return {
    geometry,
    baseGeometry: createTerrainBase(geometry, width, height),
    bounds,
    width,
    height,
    minElevation,
    maxElevation,
    sceneUnitsPerMeter,
    sampleElevation,
    sampleHeight,
    geographicToScene,
    maxHeight: (maxElevation - minElevation) * sceneUnitsPerMeter,
  }
}

export class TerrainLoader extends Loader {
  load(url, onLoad, onProgress, onError) {
    const resolvedUrl = this.manager.resolveURL(url)
    this.manager.itemStart(resolvedUrl)
    fetch(resolvedUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`DEM request failed: ${response.status}`)
        return response.arrayBuffer()
      })
      .then(createTerrain)
      .then(onLoad)
      .catch((error) => {
        onError?.(error)
        this.manager.itemError(resolvedUrl)
      })
      .finally(() => this.manager.itemEnd(resolvedUrl))
  }
}