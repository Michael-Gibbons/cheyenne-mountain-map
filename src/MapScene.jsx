import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Bvh, Html, Line, MapControls, useCursor } from '@react-three/drei'
import { useFrame, useLoader, useThree } from '@react-three/fiber'
import { Box3, Matrix4, MOUSE, TOUCH, Vector3 } from 'three'
import { Binoculars, Caravan, DoorOpen, Info, Landmark, MapPin, Signpost, Tent } from 'lucide-react'
import { applyContourShading, TerrainLoader } from './terrain'
import { declutterLandmarks, ParkLoader, preparePark } from './park'
import Forest from './Forest.jsx'

const locationIcons = {
  'Visitor Center': Info,
  'Entrance Station': DoorOpen,
  'Scenic Overlook': Binoculars,
  'Historic Site': Landmark,
  Campground: Tent,
  'RV Campground': Caravan,
  'Trailhead (2021 reference)': Signpost,
}

function queueView(controls, camera, target, distance, transition) {
  const direction = camera.position.clone().sub(controls.target).normalize()
  controls.enableDamping = false
  controls.update()
  transition.current = {
    elapsed: 0,
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.7,
    startTarget: controls.target.clone(),
    endTarget: target.clone(),
    startCamera: camera.position.clone(),
    endCamera: direction.multiplyScalar(distance).add(target),
  }
}

export default function MapScene({ layers, selected, onSelect, onParkReady, presentation, resetVersion, onViewReady, initialView, touchMode, zoomRequest }) {
  const terrain = useLoader(TerrainLoader, `${import.meta.env.BASE_URL}terrain/cheyenne-mountain.tif`)
  const collections = useLoader(ParkLoader, `${import.meta.env.BASE_URL}park/`)
  const park = useMemo(() => preparePark(terrain, collections), [terrain, collections])
  const labelElements = useRef(new Map())
  const markerElements = useRef(new Map())
  const terrainMesh = useRef(null)
  const controlsRef = useRef(null)
  const initializedPark = useRef(null)
  const cameraTransition = useRef(null)
  const trailGesture = useRef({ dragged: false })
  const restoredSelection = useRef(initialView?.selected ?? null)
  const handleControlStart = useCallback(() => {
    cameraTransition.current = null
    if (controlsRef.current) controlsRef.current.enableDamping = true
  }, [])
  const [hoveredLocation, setHoveredLocation] = useState(null)
  const [hoveredTrail, setHoveredTrail] = useState('')
  const [touchDevice, setTouchDevice] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  useCursor(Boolean(hoveredTrail) && layers.trails)
  const labelLayout = useRef({
    elapsed: 0,
    cameraMatrix: new Matrix4(),
    projectionMatrix: new Matrix4(),
    width: 0,
    height: 0,
    selected: null,
    hoveredLocation: null,
    presentation: null,
    locationsVisible: null,
    count: 0,
    projected: new Vector3(),
  })
  const orderedLocations = useMemo(() => [...park.locations].sort((first, second) => {
    const priority = (location) => selected === `location:${location.id}` ? 0 : location.kind === 'Visitor Center' ? 1 : 2
    return priority(first) - priority(second)
  }), [park.locations, selected])
  const get = useThree((state) => state.get)
  const fov = useThree((state) => state.camera.fov)
  const size = useThree((state) => state.size)
  const verticalFov = fov * Math.PI / 180
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * size.width / size.height)
  const radius = park.radius
  const fitDistance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.05

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)')
    const update = () => setTouchDevice(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!zoomRequest.sequence || !controlsRef.current) return
    const controls = controlsRef.current
    const { camera } = get()
    const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, controls.getDistance() * zoomRequest.factor))
    queueView(controls, camera, controls.target, distance, cameraTransition)
  }, [get, zoomRequest])

  useEffect(() => {
    const { raycaster } = get()
    const previous = raycaster.params.Line2
    raycaster.params.Line2 = { ...previous, threshold: 18 }
    return () => {
      if (previous) raycaster.params.Line2 = previous
      else delete raycaster.params.Line2
    }
  }, [get])

  useEffect(() => {
    const { gl, camera, raycaster, scene } = get()
    const canvas = gl.domElement
    const group = scene.getObjectByName('park-trails')
    let timer = null
    let pointer = null
    const clearHover = () => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pointer = null
      setHoveredTrail('')
    }
    const pick = () => {
      timer = null
      if (!pointer || !layers.trails || !group) return
      const bounds = canvas.getBoundingClientRect()
      raycaster.setFromCamera({
        x: (pointer.x - bounds.left) / bounds.width * 2 - 1,
        y: 1 - (pointer.y - bounds.top) / bounds.height * 2,
      }, camera)
      const hit = raycaster.intersectObjects(group.children, true)[0]
      let object = hit?.object
      while (object?.parent && object.parent !== group) object = object.parent
      setHoveredTrail(object?.name || '')
    }
    const start = (event) => {
      const alreadyDragging = trailGesture.current.active
      trailGesture.current = { x: event.clientX, y: event.clientY, dragged: false }
      trailGesture.current.active = true
      if (alreadyDragging) trailGesture.current.dragged = true
      clearHover()
    }
    const move = (event) => {
      if (event.pointerType === 'touch') {
        if (Math.hypot(event.clientX - trailGesture.current.x, event.clientY - trailGesture.current.y) > 4) trailGesture.current.dragged = true
        clearHover()
        return
      }
      if (event.buttons !== 0) {
        const gesture = trailGesture.current
        if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) gesture.dragged = true
        clearHover()
        return
      }
      pointer = { x: event.clientX, y: event.clientY }
      if (timer === null) timer = setTimeout(pick, 80)
    }
    const end = () => { trailGesture.current.active = false }
    canvas.addEventListener('pointerdown', start, true)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', clearHover)
    canvas.addEventListener('pointercancel', clearHover)
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
    return () => {
      if (timer !== null) clearTimeout(timer)
      canvas.removeEventListener('pointerdown', start, true)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', clearHover)
      canvas.removeEventListener('pointercancel', clearHover)
      canvas.removeEventListener('pointerup', end)
      canvas.removeEventListener('pointercancel', end)
    }
  }, [get, park, layers.trails])

  useLayoutEffect(() => {
    if (!controlsRef.current || (initializedPark.current?.park === park && initializedPark.current.resetVersion === resetVersion)) return
    const { camera } = get()
    if (initializedPark.current?.park === park) {
      queueView(controlsRef.current, camera, park.center, fitDistance, cameraTransition)
      initializedPark.current = { park, resetVersion }
      return
    }
    camera.position.set(1, 0.9, 1).normalize().multiplyScalar(fitDistance)
    camera.position.add(park.center)
    camera.lookAt(park.center)
    camera.updateProjectionMatrix()
    controlsRef.current.target.copy(park.center)
    if (initialView && resetVersion === 0) {
      camera.position.fromArray(initialView.camera)
      controlsRef.current.target.fromArray(initialView.target)
      camera.lookAt(controlsRef.current.target)
    }
    controlsRef.current.update()
    initializedPark.current = { park, resetVersion }
  }, [get, fitDistance, park, resetVersion, initialView])

  useEffect(() => {
    if (restoredSelection.current !== null && selected === restoredSelection.current) return
    restoredSelection.current = null
    const location = park.locations.find((point) => `location:${point.id}` === selected)
    const controls = controlsRef.current
    if (!controls || !selected) return
    const { camera, size: viewport } = get()
    if (location) {
      const target = location.position.clone()
      target.y += 0.5
      queueView(controls, camera, target, Math.max(controls.minDistance, 24), cameraTransition)
      return
    }
    const points = park.trails.filter((trail) => `trail:${trail.name}` === selected).flatMap((trail) => trail.points)
    if (!points.length) return
    const target = new Box3().setFromPoints(points).getCenter(new Vector3())
    target.y = terrain.sampleHeight(target.x, target.z) + 0.5
    const trailRadius = Math.max(...points.map((point) => point.distanceTo(target)))
    const vertical = camera.fov * Math.PI / 180
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * viewport.width / viewport.height)
    const distance = Math.max(24, trailRadius / Math.sin(Math.min(vertical, horizontal) / 2) * 1.15)
    queueView(controls, camera, target, Math.min(controls.maxDistance, distance), cameraTransition)
  }, [get, park, selected, terrain])

  useEffect(() => {
    onParkReady(park)
    onViewReady({ get, park })
  }, [get, onParkReady, onViewReady, park])

  useFrame(({ camera, size: viewport }, delta) => {
    const controls = controlsRef.current
    if (controls) {
      const transition = cameraTransition.current
      if (transition) {
        transition.elapsed += delta
        const fraction = transition.duration === 0 ? 1 : Math.min(1, transition.elapsed / transition.duration)
        const eased = fraction * fraction * (3 - 2 * fraction)
        controls.target.lerpVectors(transition.startTarget, transition.endTarget, eased)
        camera.position.lerpVectors(transition.startCamera, transition.endCamera, eased)
        controls.update()
        if (fraction === 1) {
          cameraTransition.current = null
          controls.enableDamping = true
        }
      }
      const targetHeight = terrain.sampleHeight(controls.target.x, controls.target.z)
      if (targetHeight !== null && controls.target.y < targetHeight + 0.5) {
        controls.target.y = targetHeight + 0.5
        controls.update()
      }
      const cameraHeight = terrain.sampleHeight(camera.position.x, camera.position.z)
      const minimumHeight = (cameraHeight ?? 0) + 0.75
      if (camera.position.y < minimumHeight) {
        camera.position.y = minimumHeight
        controls.update()
      }
    }
    const layout = labelLayout.current
    layout.elapsed += delta
    const contentChanged = layout.selected !== selected || layout.locationsVisible !== layers.locations
      || layout.count !== labelElements.current.size || layout.hoveredLocation !== hoveredLocation || layout.presentation !== presentation
    const viewportChanged = layout.width !== viewport.width || layout.height !== viewport.height
    if (!contentChanged && !viewportChanged) {
      if (layout.elapsed < 0.1) return
      if (layout.cameraMatrix.equals(camera.matrixWorld) && layout.projectionMatrix.equals(camera.projectionMatrix)) return
    }
    layout.elapsed = 0
    layout.cameraMatrix.copy(camera.matrixWorld)
    layout.projectionMatrix.copy(camera.projectionMatrix)
    layout.width = viewport.width
    layout.height = viewport.height
    layout.selected = selected
    layout.hoveredLocation = hoveredLocation
    layout.presentation = presentation
    layout.locationsVisible = layers.locations
    layout.count = labelElements.current.size
    if (!layers.locations) return
    const occupied = []
    const projected = layout.projected
    const projectedLocations = []
    for (const location of park.locations) {
      projected.copy(location.position).project(camera)
      const x = (projected.x + 1) * viewport.width / 2
      const y = (1 - projected.y) * viewport.height / 2
      const underPanel = !presentation && (viewport.width <= 600 ? y > viewport.height - 316 : x < 300 && y < 490)
      const active = selected === `location:${location.id}`
      if (projected.z < -1 || projected.z > 1 || x < 16 || x > viewport.width - 16 || y < 100 || y > viewport.height - 55 || (underPanel && !active)) continue
      const priority = active ? 0 : hoveredLocation === location.id ? 1 : location.kind === 'Visitor Center' ? 2
        : ['Scenic Overlook', 'Historic Site'].includes(location.kind) ? 3 : location.kind.startsWith('Trailhead') ? 4 : 5
      projectedLocations.push({ id: location.id, x, y, priority })
    }
    const visibleMarkers = declutterLandmarks(projectedLocations)
    for (const location of orderedLocations) {
      const marker = markerElements.current.get(location.id)
      const element = labelElements.current.get(location.id)
      const markerVisible = visibleMarkers.has(location.id)
      if (marker) {
        marker.style.visibility = markerVisible ? 'visible' : 'hidden'
        marker.dataset.decluttered = markerVisible ? 'false' : 'true'
      }
      if (!element) continue
      if (!markerVisible || (selected !== `location:${location.id}` && hoveredLocation !== location.id)) {
        element.style.visibility = 'hidden'
        continue
      }
      projected.copy(location.position)
      projected.project(camera)
      const width = element.offsetWidth
      const height = element.offsetHeight
      const left = (projected.x + 1) * viewport.width / 2 - width / 2
      const top = (1 - projected.y) * viewport.height / 2 - 34 - height
      const box = { left: left - 4, top: top - 4, right: left + width + 4, bottom: top + height + 4 }
      const mobile = viewport.width <= 600
      const underPanel = !presentation && (mobile ? box.bottom > viewport.height - 290 : box.left < 300 && box.top < 460)
      const outside = projected.z < -1 || projected.z > 1 || box.left < 8 || box.right > viewport.width - 8 || box.top < 75 || box.bottom > viewport.height - 60
      const collision = occupied.some((other) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)
      const visible = !outside && !underPanel && !collision
      const visibility = visible ? 'visible' : 'hidden'
      if (element.style.visibility !== visibility) element.style.visibility = visibility
      if (visible) occupied.push(box)
    }
  })

  return (
    <>
      <color attach="background" args={['#202426']} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[80, 120, 60]} intensity={2} />

      <Bvh firstHitOnly>
        <mesh ref={terrainMesh} geometry={terrain.geometry} dispose={null}>
          <meshStandardMaterial vertexColors roughness={0.95} onBeforeCompile={applyContourShading} />
        </mesh>
      </Bvh>

      <mesh name="terrain-base" geometry={terrain.baseGeometry} dispose={null}>
        <meshStandardMaterial color="#64736c" roughness={1} flatShading />
      </mesh>

      <Forest terrain={terrain} park={park} visible={layers.trees} />

      <group name="park-boundary" visible={layers.boundary}>
        {park.boundary.map((points, index) => (
          <Line
            key={index}
            points={points}
            color="#fff3ad"
            lineWidth={2.5}
            dashed
            dashSize={1.5}
            gapSize={0.7}
          />
        ))}
      </group>

      <group name="park-trails" visible={layers.trails}>
        {park.trails.map((trail) => (
          <Line
            key={trail.id}
            name={trail.name}
            points={trail.points}
            color={trail.color}
            transparent
            opacity={selected.startsWith('trail:') && selected !== `trail:${trail.name}` && hoveredTrail !== trail.name ? 0.22 : 1}
            lineWidth={selected === `trail:${trail.name}` ? 8 : hoveredTrail === trail.name ? 6 : 2.5}
            onClick={(event) => {
              if (event.button !== 0 || event.delta > 4 || trailGesture.current.dragged) return
              event.stopPropagation()
              onSelect(`trail:${trail.name}`)
            }}
          />
        ))}
      </group>

      {layers.locations && (
        <group name="park-locations">
          {park.locations.map((location) => {
            const active = selected === `location:${location.id}`
            const Icon = locationIcons[location.kind] || MapPin
            return (
              <group key={location.id} name={location.name} position={location.position}>
                <Html
                  occlude={[terrainMesh]}
                  zIndexRange={[10, 0]}
                  style={{ pointerEvents: 'none' }}
                >
                  <div className="poi-anchor">
                    <button
                      type="button"
                      className="poi-icon"
                      aria-label={`${location.name}: ${location.kind}`}
                      aria-pressed={active}
                      title={`${location.name} (${location.kind})`}
                      data-kind={location.kind}
                      data-location-id={location.id}
                      ref={(element) => {
                        if (element) markerElements.current.set(location.id, element)
                        else markerElements.current.delete(location.id)
                      }}
                      onPointerEnter={() => setHoveredLocation(location.id)}
                      onPointerLeave={() => setHoveredLocation(null)}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelect(`location:${location.id}`)
                      }}
                    >
                      <Icon size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span
                      className={`location-label${active ? ' selected' : ''}`}
                      ref={(element) => {
                        if (element) labelElements.current.set(location.id, element)
                        else labelElements.current.delete(location.id)
                      }}
                    >
                      {location.name}
                    </span>
                  </div>
                </Html>
              </group>
            )
          })}
        </group>
      )}

      <MapControls
        ref={controlsRef}
        makeDefault
        onStart={handleControlStart}
        enablePan
        zoomToCursor={!touchDevice}
        touches={{ ONE: touchMode === 'rotate' ? TOUCH.ROTATE : TOUCH.PAN, TWO: TOUCH.DOLLY_PAN }}
        panSpeed={touchDevice ? 0.8 : 1}
        rotateSpeed={touchDevice ? 0.65 : 1}
        enableDamping
        dampingFactor={0.08}
        screenSpacePanning={false}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI / 2 - 0.1}
        minDistance={4}
        maxDistance={Math.max(450, fitDistance * 1.4)}
        mouseButtons={{
          LEFT: MOUSE.ROTATE,
          MIDDLE: MOUSE.DOLLY,
          RIGHT: MOUSE.PAN,
        }}
      />
    </>
  )
}