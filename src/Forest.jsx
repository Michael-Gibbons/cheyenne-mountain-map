import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Object3D } from 'three'
import { createForest } from './forest.js'

const ignoreRaycast = () => {}

export default function Forest({ terrain, park, visible }) {
  const trees = useMemo(() => createForest(terrain, park), [terrain, park])
  const trunks = useRef(null)
  const crowns = useRef(null)

  useLayoutEffect(() => {
    const transform = new Object3D()
    const color = new Color()
    const low = new Color('#234c3b')
    const high = new Color('#718868')
    trees.forEach((tree, index) => {
      transform.rotation.set(0, tree.rotation, 0)
      transform.position.copy(tree.position)
      transform.position.y += tree.height * 0.175
      transform.scale.set(1, tree.height * 0.35, 1)
      transform.updateMatrix()
      trunks.current.setMatrixAt(index, transform.matrix)
      transform.position.copy(tree.position)
      transform.position.y += tree.height * 0.6
      transform.scale.set(tree.radius, tree.height * 0.8, tree.radius)
      transform.updateMatrix()
      crowns.current.setMatrixAt(index, transform.matrix)
      color.copy(low).lerp(high, tree.shade)
      crowns.current.setColorAt(index, color)
    })
    for (const mesh of [trunks.current, crowns.current]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    crowns.current.instanceColor.needsUpdate = true
  }, [trees])

  return (
    <group name="artistic-forest" visible={visible}>
      <instancedMesh ref={trunks} args={[null, null, trees.length]} raycast={ignoreRaycast}>
        <cylinderGeometry args={[0.045, 0.065, 1, 5]} />
        <meshStandardMaterial color="#605c4c" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[null, null, trees.length]} raycast={ignoreRaycast}>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}