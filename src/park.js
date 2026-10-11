import { Box3, Color, Loader, Vector3 } from 'three'

export const overlayOffset = 0.12
const sampleSpacingMeters = 5
const trailPalette = [
  '#b55745', '#387f83', '#ae842f', '#77678f', '#b35f7e', '#4f7d47',
  '#5077a2', '#bc7d45', '#7b873c', '#885e50', '#4f8496', '#a57858',
  '#cf8978', '#67a2a4', '#c7a35c', '#9a8bb0', '#c8889e', '#79a270',
  '#819fbe', '#d3a074', '#a4ae70', '#b38b7f', '#7da5b3', '#c6a68a',
]

export function declutterLandmarks(points, spacing = 42) {
  const visible = []
  const ordered = [...points].sort((first, second) => first.priority - second.priority || first.id.localeCompare(second.id))
  for (const point of ordered) {
    if (!visible.some((other) => Math.abs(point.x - other.x) < spacing && Math.abs(point.y - other.y) < spacing)) {
      visible.push(point)
    }
  }
  return new Set(visible.map((point) => point.id))
}
const visitorTypes = new Set([
  'Visitor Center',
  'Entrance Station',
  'Scenic Overlook',
  'Historic Site',
  'Campground',
  'RV Campground',
])

export function drapePath(terrain, coordinates) {
  const points = []
  for (let index = 0; index < coordinates.length; index++) {
    const current = coordinates[index]
    const end = terrain.geographicToScene(...current)
    if (!end) throw new Error('Park geometry extends outside the DEM. Run npm run terrain:download.')
    if (index > 0) {
      const previous = coordinates[index - 1]
      const start = terrain.geographicToScene(...previous)
      const distance = Math.hypot(end.x - start.x, end.z - start.z) / terrain.sceneUnitsPerMeter
      const steps = Math.ceil(distance / sampleSpacingMeters)
      for (let step = 1; step < steps; step++) {
        const fraction = step / steps
        const point = terrain.geographicToScene(
          previous[0] + (current[0] - previous[0]) * fraction,
          previous[1] + (current[1] - previous[1]) * fraction,
        )
        if (!point) throw new Error('Trail interpolation extends outside the DEM.')
        point.y += overlayOffset
        points.push(point)
      }
    }
    end.y += overlayOffset
    points.push(end)
  }
  return points
}

export function preparePark(terrain, collections) {
  const boundary = collections.boundary.features.flatMap((feature) => {
    const polygons = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates
    return polygons.flatMap((polygon) => polygon.map((ring) => drapePath(terrain, ring)))
  })
  const trails = collections.trails.features.flatMap((feature) => {
    const paths = feature.geometry.type === 'LineString'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates
    return paths.map((coordinates, index) => ({
      id: `trail-${feature.id}-${index}`,
      name: feature.properties.name?.trim() || 'Unnamed trail',
      kind: 'Trail',
      points: drapePath(terrain, coordinates),
    }))
  })
  const names = [...new Set(trails.map((trail) => trail.name))].sort()
  const trailColors = new Map(names.map((name, index) => [
    name,
    `#${new Color(trailPalette[index] || new Color().setHSL(index / names.length, 0.5, 0.4)).offsetHSL(0, 0.18, 0).getHexString()}`,
  ]))
  trails.forEach((trail) => { trail.color = trailColors.get(trail.name) })
  const locations = [
    ...collections.facilities.features
      .filter((feature) => visitorTypes.has(feature.properties.d_FAC_TYPE))
      .map((feature) => ({
        id: `facility-${feature.id}`,
        name: feature.properties.FAC_NAME?.trim() || feature.properties.d_FAC_TYPE,
        kind: feature.properties.d_FAC_TYPE,
        coordinates: feature.geometry.coordinates,
      })),
    ...collections.trailheads.features.map((feature) => ({
      id: `trailhead-${feature.id}`,
      name: feature.properties.name?.trim() || 'Trailhead',
      kind: 'Trailhead (2021 reference)',
      coordinates: feature.geometry.coordinates,
    })),
  ].map((location) => {
    const position = terrain.geographicToScene(...location.coordinates)
    if (!position) throw new Error('Park location extends outside the DEM.')
    position.y += 0.01
    return { ...location, position }
  })
  const boundaryPoints = boundary.flat()
  const bounds = new Box3().setFromPoints(boundaryPoints)
  const center = bounds.getCenter(new Vector3())
  center.y = terrain.sampleHeight(center.x, center.z) + 0.5
  const radius = Math.max(...boundaryPoints.map((point) => point.distanceTo(center)))
  return { boundary, trails, locations, center, radius }
}

export class ParkLoader extends Loader {
  load(url, onLoad, onProgress, onError) {
    const resolvedUrl = this.manager.resolveURL(url)
    this.manager.itemStart(resolvedUrl)
    Promise.all(['boundary', 'trails', 'facilities', 'trailheads'].map(async (name) => {
      const response = await fetch(`${resolvedUrl}${name}.geojson`)
      if (!response.ok) throw new Error(`Park ${name} request failed: ${response.status}`)
      const collection = await response.json()
      if (collection.type !== 'FeatureCollection' || !collection.features?.length) {
        throw new Error(`Park ${name} is not a populated GeoJSON FeatureCollection.`)
      }
      return [name, collection]
    }))
      .then((entries) => onLoad(Object.fromEntries(entries)))
      .catch((error) => {
        onError?.(error)
        this.manager.itemError(resolvedUrl)
      })
      .finally(() => this.manager.itemEnd(resolvedUrl))
  }
}