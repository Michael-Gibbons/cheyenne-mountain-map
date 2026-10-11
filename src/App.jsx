import { Component, Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { Download, Eye, EyeOff, RotateCcw, Share2, X } from 'lucide-react'
import MapScene from './MapScene'
import { exportArtwork } from './exportArtwork'
import { createViewLink, readViewLink } from './viewLink'
import './App.css'

function TerrainLoading() {
  const { active } = useProgress()
  return active ? <p className="terrain-status" role="status">Loading park data...</p> : null
}

class TerrainErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <p className="terrain-status" role="alert">Park data could not be loaded. Reload to try again.</p>
    }
    return this.props.children
  }
}

function App() {
  const [initialView] = useState(() => readViewLink(window.location.href))
  const [layers, setLayers] = useState(initialView?.layers || { boundary: true, trails: true, locations: true, trees: true })
  const [selected, setSelected] = useState(initialView?.selected || '')
  const [park, setPark] = useState(null)
  const [presentation, setPresentation] = useState(initialView?.presentation || false)
  const [resetVersion, setResetVersion] = useState(0)
  const [view, setView] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportMenu, setExportMenu] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const trailNames = park ? [...new Set(park.trails.map((trail) => trail.name))].sort() : []
  const selectedLocation = park?.locations.find((location) => `location:${location.id}` === selected)

  async function saveArtwork(preset) {
    setExportMenu(false)
    setExporting(true)
    setExportError('')
    try {
      const state = view.get()
      const url = createViewLink(window.location.href, state, selected, layers, presentation)
      await exportArtwork(state, view.park, layers, { preset, url })
    } catch (error) {
      setExportError(error.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <main className={`map-app${presentation ? ' presentation' : ''}`}>
      <header className="map-heading">
        <h1>Cheyenne Mountain<span>State Park</span></h1>
      </header>
      <nav className="map-tools" aria-label="Artwork controls">
        <button type="button" title={presentation ? 'Show controls' : 'Presentation mode'} aria-label={presentation ? 'Show controls' : 'Presentation mode'} aria-pressed={presentation} onClick={() => setPresentation(!presentation)}>
          {presentation ? <EyeOff size={19} /> : <Eye size={19} />}
        </button>
        <button type="button" title="Reset park view" aria-label="Reset park view" disabled={!park} onClick={() => { setSelected(''); setResetVersion(resetVersion + 1) }}>
          <RotateCcw size={19} />
        </button>
        <button
          type="button"
          title="Export artwork PNG"
          aria-label={exporting ? 'Exporting artwork' : 'Export artwork PNG'}
          disabled={!view || exporting}
          aria-expanded={exportMenu}
          onClick={() => setExportMenu(!exportMenu)}
        >
          <Download size={19} />
        </button>
        <button
          type="button"
          title="Share this view"
          aria-label="Share this view"
          disabled={!view}
          onClick={async () => {
            const url = createViewLink(window.location.href, view.get(), selected, layers, presentation)
            window.history.replaceState(null, '', url)
            setShareLink(url)
            try {
              await navigator.clipboard.writeText(url)
              setShareMessage('View link copied')
            } catch {
              setShareMessage('View link')
            }
          }}
        >
          <Share2 size={19} />
        </button>
        {exportMenu && (
          <div className="export-menu" aria-label="Export composition">
            <button type="button" onClick={() => saveArtwork('current')}>Current view</button>
            <button type="button" onClick={() => saveArtwork('overview')}>Park overview</button>
          </div>
        )}
      </nav>
      {shareLink && (
        <div className="share-result">
          <span role="status">{shareMessage}</span>
          <button type="button" className="share-close" aria-label="Close view link" title="Close view link" onClick={() => setShareLink('')}>
            <X size={16} />
          </button>
          <input aria-label="View link" value={shareLink} readOnly onFocus={(event) => event.target.select()} />
        </div>
      )}
      <TerrainErrorBoundary>
        <Canvas
          camera={{ position: [210, 190, 210], fov: 55, near: 0.1, far: 2000 }}
          dpr={[1, 2]}
          fallback={<p className="terrain-status">WebGL is required to display this map.</p>}
          onPointerMissed={(event) => {
            if (event.button === 0) setSelected('')
          }}
          aria-label="Interactive 3D terrain map of Cheyenne Mountain State Park"
        >
          <Suspense fallback={null}>
            <MapScene
              layers={layers}
              selected={selected}
              onSelect={setSelected}
              onParkReady={setPark}
              presentation={presentation}
              resetVersion={resetVersion}
              onViewReady={setView}
              initialView={initialView}
            />
          </Suspense>
        </Canvas>
      </TerrainErrorBoundary>
      {!presentation && <aside className="map-panel" aria-label="Park layers and locations">
        <fieldset className="layer-controls">
          <legend>Map Layers</legend>
          {[
            ['boundary', 'Park boundary'],
            ['trails', 'Public trails'],
            ['locations', 'Locations'],
            ['trees', 'Artistic trees'],
          ].map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={(event) => {
                  setLayers({ ...layers, [key]: event.target.checked })
                  if ((key === 'trails' && selected.startsWith('trail:'))
                    || (key === 'locations' && selected.startsWith('location:'))) setSelected('')
                }}
              />
              <span className={`layer-swatch ${key}`} aria-hidden="true" />
              {label}
            </label>
          ))}
        </fieldset>
        <label className="place-select">
          <span>Location or Trail</span>
          <select
            value={selected}
            disabled={!park}
            onChange={(event) => {
              const value = event.target.value
              setSelected(value)
              if (value.startsWith('trail:')) setLayers({ ...layers, trails: true })
              if (value.startsWith('location:')) setLayers({ ...layers, locations: true })
            }}
          >
            <option value="">All park features</option>
            <optgroup label="Locations">
              {park?.locations.map((location) => (
                <option key={location.id} value={`location:${location.id}`}>{location.name}</option>
              ))}
            </optgroup>
            <optgroup label="Trails">
              {trailNames.map((name) => <option key={name} value={`trail:${name}`}>{name}</option>)}
            </optgroup>
          </select>
        </label>
        {park && (
          <details className="trail-legend">
            <summary>Trail Colors ({trailNames.length})</summary>
            <ul>
              {trailNames.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    aria-pressed={selected === `trail:${name}`}
                    onClick={() => {
                      setSelected(`trail:${name}`)
                      setLayers({ ...layers, trails: true })
                    }}
                  >
                    <span className="trail-color" style={{ background: park.trails.find((trail) => trail.name === name).color }} aria-hidden="true" />
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
        {selected && (
          <div className="selection-details" role="status">
            <strong>{selectedLocation?.name || selected.slice('trail:'.length)}</strong>
            <span>{selectedLocation?.kind || 'Public trail'}</span>
            {selectedLocation && (
              <span>{selectedLocation.coordinates[1].toFixed(5)}, {selectedLocation.coordinates[0].toFixed(5)}</span>
            )}
          </div>
        )}
      </aside>}
      <footer className="map-attribution">
        <a href="https://cpw.state.co.us/state-parks/cheyenne-mountain-state-park" target="_blank" rel="noreferrer">Colorado Parks and Wildlife</a>
        <span>USGS 3DEP / Illustrative map, not for navigation</span>
      </footer>
      {exportError && <p className="export-error" role="alert">{exportError}</p>}
      <TerrainLoading />
    </main>
  )
}

export default App
