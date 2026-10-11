import { MathUtils, Vector3 } from 'three'

export const treeClearance = 0.65

export function createForest(terrain, park) {
  const bounds = terrain.geometry.boundingBox
  const paths = new Map()
  const occupied = new Set()
  const trees = []
  const cellSize = 0.75
  const cellKey = (column, row) => `${column},${row}`
  for (const trail of park.trails) {
    for (const point of trail.points) {
      const key = cellKey(Math.floor(point.x / cellSize), Math.floor(point.z / cellSize))
      if (!paths.has(key)) paths.set(key, [])
      paths.get(key).push(point)
    }
  }
  function nearTrail(sceneX, sceneZ) {
    const column = Math.floor(sceneX / cellSize)
    const row = Math.floor(sceneZ / cellSize)
    for (let horizontal = -1; horizontal <= 1; horizontal++) {
      for (let vertical = -1; vertical <= 1; vertical++) {
        const points = paths.get(cellKey(column + horizontal, row + vertical)) || []
        if (points.some((point) => (point.x - sceneX) ** 2 + (point.z - sceneZ) ** 2 < treeClearance ** 2)) return true
      }
    }
    return false
  }
  for (let index = 0; index < 12000 && trees.length < 1000; index++) {
    const sceneX = MathUtils.lerp(bounds.min.x + 1, bounds.max.x - 1, MathUtils.seededRandom(7411 + index * 4))
    const sceneZ = MathUtils.lerp(bounds.min.z + 1, bounds.max.z - 1, MathUtils.seededRandom(7412 + index * 4))
    const height = terrain.sampleHeight(sceneX, sceneZ)
    if (height === null || height < terrain.maxHeight * 0.08 || height > terrain.maxHeight * 0.9) continue
    const patch = Math.sin(sceneX * 0.16 + Math.cos(sceneZ * 0.12)) * Math.cos(sceneZ * 0.14 - sceneX * 0.04)
    if (patch < -0.15) continue
    const east = terrain.sampleHeight(sceneX + 0.3, sceneZ)
    const north = terrain.sampleHeight(sceneX, sceneZ - 0.3)
    if (east === null || north === null || Math.hypot(east - height, north - height) / 0.3 > 0.85) continue
    const key = cellKey(Math.floor(sceneX / 1.2), Math.floor(sceneZ / 1.2))
    if (occupied.has(key) || nearTrail(sceneX, sceneZ)) continue
    if (park.locations.some((point) => (point.position.x - sceneX) ** 2 + (point.position.z - sceneZ) ** 2 < 1.2 ** 2)) continue
    occupied.add(key)
    const variation = MathUtils.seededRandom(7413 + index * 4)
    trees.push({
      position: new Vector3(sceneX, height, sceneZ),
      height: 0.8 + variation * 0.7,
      radius: 0.23 + variation * 0.17,
      rotation: MathUtils.seededRandom(7414 + index * 4) * Math.PI * 2,
      shade: variation,
      kind: Math.sin(sceneX * 0.09 + sceneZ * 0.12) > 0.25 && variation > 0.35 ? 'broadleaf' : 'conifer',
    })
  }
  return trees
}