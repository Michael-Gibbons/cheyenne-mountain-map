import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, Object3D } from 'three'
import { createForest } from './forest.js'

const ignoreRaycast = () => {}

export default function Forest({ terrain, park, visible }) {
  const trees = useMemo(() => createForest(terrain, park), [terrain, park])
  const trunks = useRef(null)
  const crowns = useRef(null)
  const broadleafCrowns = useRef(null)
  const conifers = useMemo(() => trees.filter((tree) => tree.kind === 'conifer'), [trees])
  const broadleaf = useMemo(() => trees.filter((tree) => tree.kind === 'broadleaf'), [trees])

  useLayoutEffect(() => {
    const transform = new Object3D()
    const color = new Color()
    const low = new Color('#234c3b')
    const high = new Color('#718868')
    const broadleafLow = new Color('#a4b66c')
    const broadleafHigh = new Color('#d5c47c')
    trees.forEach((tree, index) => {
      transform.rotation.set(0, tree.rotation, 0)
      transform.position.copy(tree.position)
      transform.position.y += tree.height * 0.175
      transform.scale.set(1, tree.height * 0.35, 1)
      transform.updateMatrix()
      trunks.current.setMatrixAt(index, transform.matrix)
      trunks.current.setColorAt(index, color.set(tree.kind === 'broadleaf' ? '#c5cab4' : '#605c4c'))
    })
    for (const [mesh, instances] of [[crowns.current, conifers], [broadleafCrowns.current, broadleaf]]) {
      instances.forEach((tree, index) => {
        transform.rotation.set(0, tree.rotation, 0)
        transform.position.copy(tree.position)
        transform.position.y += tree.height * 0.6
        if (tree.kind === 'broadleaf') transform.scale.set(tree.radius * 1.2, tree.height * 0.4, tree.radius)
        else transform.scale.set(tree.radius, tree.height * 0.8, tree.radius)
        transform.updateMatrix()
        if (tree.kind === 'broadleaf') color.copy(broadleafLow).lerp(broadleafHigh, tree.shade * 0.55)
        else color.copy(low).lerp(high, tree.shade)
        mesh.setMatrixAt(index, transform.matrix)
        mesh.setColorAt(index, color)
      })
    }
    for (const mesh of [trunks.current, crowns.current, broadleafCrowns.current]) {
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }, [trees, conifers, broadleaf])

  return (
    <group name="artistic-forest" visible={visible}>
      <instancedMesh ref={trunks} args={[null, null, trees.length]} raycast={ignoreRaycast}>
        <cylinderGeometry args={[0.045, 0.065, 1, 5]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
      <instancedMesh ref={crowns} args={[null, null, conifers.length]} raycast={ignoreRaycast}>
        <coneGeometry args={[1, 1, 6]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
      <instancedMesh ref={broadleafCrowns} args={[null, null, broadleaf.length]} raycast={ignoreRaycast}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial roughness={1} flatShading />
      </instancedMesh>
    </group>
  )
}