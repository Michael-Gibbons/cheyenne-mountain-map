import { Raycaster, Vector2 } from 'three'
import QRCode from 'qrcode'
import { declutterLandmarks } from './park'
import { isPublishedUrl } from './viewLink'
import { getPark } from './parks'

export async function exportArtwork(state, park, layers, options = {}) {
  const { gl, scene, size } = state
  const parkConfig = options.parkConfig || getPark('cheyenne-mountain')
  const camera = state.camera.clone()
  const overview = options.preset === 'overview'
  const aspect = overview ? 1.6 : size.width / size.height
  if (overview) {
    camera.aspect = aspect
    const vertical = camera.fov * Math.PI / 180
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect)
    const distance = park.radius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.1
    camera.position.set(1, 0.9, 1).normalize().multiplyScalar(distance).add(park.center)
    camera.lookAt(park.center)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
  }
  const width = Math.round(aspect >= 1 ? 2400 : 2400 * aspect)
  const height = Math.round(width / aspect)
  const pixelRatio = gl.getPixelRatio()
  const originalSize = gl.getSize(new Vector2())
  const output = document.createElement('canvas')
  output.width = width
  const trailLegend = layers.trails ? [...new Map(park.trails.map((trail) => [trail.name, trail])).values()].sort((first, second) => first.name.localeCompare(second.name)) : []
  const columns = width > 1400 ? 4 : 2
  const legendHeight = trailLegend.length ? 48 + Math.ceil(trailLegend.length / columns) * 34 : 0
  output.height = height + 200 + legendHeight
  const context = output.getContext('2d')
  if (!context) throw new Error('Image export is unavailable in this browser.')
  context.fillStyle = '#202426'
  context.fillRect(0, 0, output.width, output.height)
  const restoredMaterials = []
  scene.getObjectByName('park-trails')?.traverse((object) => {
    if (!object.material?.resolution) return
    const material = object.material
    restoredMaterials.push({ material, resolution: material.resolution.clone(), opacity: material.opacity, lineWidth: material.linewidth })
    material.resolution.set(width, height)
    if (overview) {
      material.opacity = 1
      material.linewidth = 2.5
    }
  })
  try {
    gl.setDrawingBufferSize(width, height, 1)
    gl.render(scene, camera)
    context.drawImage(gl.domElement, 0, 110, width, height)
  } finally {
    for (const snapshot of restoredMaterials) {
      snapshot.material.resolution.copy(snapshot.resolution)
      snapshot.material.opacity = snapshot.opacity
      snapshot.material.linewidth = snapshot.lineWidth
    }
    gl.setDrawingBufferSize(originalSize.x, originalSize.y, pixelRatio)
    gl.render(scene, state.camera)
    state.invalidate()
  }
  if (layers.locations) {
    const scale = overview ? 1.5 : width / size.width
    const projectedPoints = park.locations.map((location) => {
      const position = location.position.clone().project(camera)
      return { id: location.id, x: (position.x + 1) * width / 2, y: (1 - position.y) * height / 2, priority: location.kind === 'Visitor Center' ? 0 : 1, position }
    }).filter((point) => point.position.z >= -1 && point.position.z <= 1 && point.x > 20 && point.x < width - 20 && point.y > 34 && point.y < height - 10)
    const visible = declutterLandmarks(projectedPoints, 42 * scale)
    const occlusion = new Raycaster()
    let terrainMesh
    scene.traverse((object) => { if (object.isMesh && object.geometry?.attributes.position.count === 66049) terrainMesh = object })
    for (const location of park.locations) {
      const button = document.querySelector(`[data-location-id="${location.id}"]`)
      if (!button || !visible.has(location.id)) continue
      const distance = camera.position.distanceTo(location.position)
      occlusion.set(camera.position, location.position.clone().sub(camera.position).normalize())
      const obstruction = terrainMesh && occlusion.intersectObject(terrainMesh, false)[0]
      if (obstruction && obstruction.distance < distance - 0.02) continue
      const position = location.position.clone().project(camera)
      if (position.z < -1 || position.z > 1) continue
      const svg = button.querySelector('svg')?.cloneNode(true)
      if (!svg) continue
      svg.setAttribute('color', '#087fa3')
      const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
      const image = new Image()
      try {
        image.src = url
        await image.decode()
        const centerX = (position.x + 1) * width / 2
        const bottom = (1 - position.y) * height / 2 + 110
        context.fillStyle = '#ffffff'
        context.strokeStyle = '#087fa3'
        context.lineWidth = 2 * scale
        context.beginPath()
        context.arc(centerX, bottom - 14 * scale, 13 * scale, 0, Math.PI * 2)
        context.fill()
        context.stroke()
        context.drawImage(image, centerX - 8 * scale, bottom - 22 * scale, 16 * scale, 16 * scale)
        if (button.getAttribute('aria-pressed') === 'true') {
          context.font = `${Math.round(13 * scale)}px 'Trebuchet MS', sans-serif`
          context.textAlign = 'center'
          const labelWidth = context.measureText(location.name).width
          context.fillStyle = '#ffffff'
          context.fillRect(centerX - labelWidth / 2 - 5 * scale, bottom - 49 * scale, labelWidth + 10 * scale, 20 * scale)
          context.fillStyle = '#17382e'
          context.fillText(location.name, centerX, bottom - 34 * scale)
        }
      } finally {
        URL.revokeObjectURL(url)
      }
    }
  }
  context.textAlign = 'left'
  context.fillStyle = '#e5eee6'
  context.font = '32px Georgia, serif'
  const includeQr = options.url && isPublishedUrl(options.url)
  context.fillText(parkConfig.name, 36, 58, width - (includeQr ? 180 : 72))
  if (trailLegend.length) {
    context.font = "20px 'Trebuchet MS', sans-serif"
    context.fillText('Trails', 36, height + 150)
    const columnWidth = (width - 72) / columns
    const rows = Math.ceil(trailLegend.length / columns)
    trailLegend.forEach((trail, index) => {
      const column = Math.floor(index / rows)
      const row = index % rows
      const left = 36 + column * columnWidth
      const top = height + 170 + row * 34
      context.fillStyle = trail.color
      context.fillRect(left, top + 4, 24, 4)
      context.fillStyle = '#e5eee6'
      context.font = "17px 'Trebuchet MS', sans-serif"
      context.fillText(trail.name, left + 34, top + 12, columnWidth - 44)
    })
  }
  if (includeQr) {
    const qr = document.createElement('canvas')
    const { url, preset } = options
    const link = new URL(url)
    if (preset === 'overview') link.searchParams.delete('view')
    await QRCode.toCanvas(qr, link.href, { width: 88, margin: 1 })
    context.drawImage(qr, width - 124, 12, 88, 88)
  }
  context.font = "14px 'Trebuchet MS', sans-serif"
  context.fillText(`${parkConfig.attribution} / USGS 3DEP`, 36, output.height - 40, width - 72)
  context.fillText(`Not for navigation. Trees are artistic, not surveyed. ${parkConfig.footer}`, 36, output.height - 18, width - 72)
  const blob = await new Promise((resolve) => output.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The browser could not create the image.')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${parkConfig.id}-landscape.png`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { width: output.width, height: output.height }
}