export function readViewLink(url) {
  try {
    const value = new URL(url).searchParams.get('view')
    if (!value) return null
    const view = JSON.parse(value)
    const vectorValid = (vector) => Array.isArray(vector) && vector.length === 3
      && vector.every((number) => Number.isFinite(number) && Math.abs(number) <= 2000)
    if (!vectorValid(view.camera) || !vectorValid(view.target)) return null
    const distance = Math.hypot(...view.camera.map((number, index) => number - view.target[index]))
    if (distance < 4 || distance > 1800 || view.camera[1] <= view.target[1]) return null
    if (typeof view.selected !== 'string' || view.selected.length > 150) return null
    if (!view.layers || ['boundary', 'trails', 'locations', 'trees'].some((key) => typeof view.layers[key] !== 'boolean')) return null
    return { camera: view.camera, target: view.target, selected: view.selected, layers: view.layers, presentation: view.presentation === true }
  } catch {
    return null
  }
}

export function createViewLink(url, state, selected, layers, presentation) {
  const link = new URL(url)
  const round = (vector) => vector.toArray().map((number) => Math.round(number * 1000) / 1000)
  link.searchParams.set('view', JSON.stringify({
    camera: round(state.camera.position),
    target: round(state.controls.target),
    selected,
    layers,
    presentation,
  }))
  return link.href
}

export function isPublishedUrl(url) {
  const link = new URL(url)
  return ['http:', 'https:'].includes(link.protocol)
    && !/^(localhost|127\.|0\.|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(link.hostname)
}