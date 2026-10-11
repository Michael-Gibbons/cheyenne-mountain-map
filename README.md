# Cheyenne Mountain Terrain

React, Vite, React Three Fiber, and Drei. Use 2 spaces for indentation.

An interactive landscape portrait of the park, intended as an art piece rather
than a navigation or live trail-status tool.

## Park Selector

Choose a park from the layer panel (expand the compact menu on mobile).
Cheyenne Mountain remains the default with its existing data and presentation.
The collection includes Roxborough, Mueller, Golden Gate Canyon, Eldorado Canyon,
and Staunton alongside Cheyenne Mountain. Garden of the Gods was removed.
Only the selected park's DEM and GeoJSON are fetched; switching clears the
previous park's selection and camera view. Shared URLs include a `park` parameter,
and PNG titles, filenames, legends, attribution, and QR links follow that park.

Roxborough files are saved under `public/parks/roxborough`: a park-centered USGS
3DEP DEM, one CPW boundary, 29 CPW-managed trail segments with 14 distinct names,
30 facility points, and two archived trailheads. The current raster is 257 by
257 samples, approximately 26 meters apart, with about 570 meters of relief.
The app displays a curated subset of facilities, not operational locations.
The route inventory includes managed approaches/connectors as well as visitor
trails; segments are not distinct hikes. CPW service timestamps are not individual
survey dates, and trailheads remain February 2021 references. Verify against the
park's official map before presenting the dataset as current trail information.

`sources.json` records the source queries, attribution, limitations, and DEM
extent. Refresh manually with `npm run roxborough:download`; it is not a deployment
step. All parks work from local static files if upstream providers disappear.
`npm run test:static` checks the full registry and lazy loading with external traffic blocked.

### Screened Additions

| Park | Trail Segments | Named Routes | DEM Relief | Export Sample Spacing |
| --- | ---: | ---: | ---: | ---: |
| Mueller | 97 | 39 | 425 m | 28.0 m |
| Golden Gate Canyon | 44 | 24 | 1,054 m | 52.9 m |
| Eldorado Canyon | 12 | 7 | 1,033 m | 34.5 m |
| Staunton | 80 | 27 | 914 m | 41.5 m |

All have populated CPW boundaries, named trails, and complete coverage of source
coordinates by a local DEM. Acceptance tests require at least five distinct route
names, at least 200 meters of relief, and no more than 60 meters between output
samples. This is resampling density, not native source resolution. Golden Gate is
best treated as an overview; Eldorado's vertical cliffs and overhangs are not
represented by a DEM. Managed approaches and climbing-access routes may appear.
These checks establish technical suitability, not an independent comparison to
each official park map or current closures. Trailheads are archived 2021 data;
service edit timestamps do not establish individual feature survey dates.

The WebGL canvas persists across switches; cached DEMs retain their BVH indexes,
and each terrain mesh uses accelerated raycasting explicitly. Idle scenes render
on demand; controls and camera transitions request frames while moving. With the
Vite server running, `npm run test:switching` checks repeated switching, canvas/BVH
identity, raycast cost, idle render work, and frame pacing.

### Adding More CPW Parks

Add an entry to `src/parks.js` with unique `id`, presentation/attribution fields,
local `data` and `terrain` paths, plus `cpwName` and `cpwManager` matching the CPW
property and trail fields. Then run:

```bash
node scripts/download-park-data.mjs <park-id>
node scripts/download-terrain.mjs <park-id>
```

Without an argument both commands retain Cheyenne Mountain's existing paths.
The terrain downloader fits all downloaded layer coordinates with padding, and
the static smoke test iterates the registry automatically. Add data-quality
checks for each new park's trail names and DEM coverage before including it.
No park-specific downloader is required; non-CPW sources can be normalized to
the same four GeoJSON FeatureCollections and an EPSG:32613 DEM in a separate
acquisition adapter. Keep runtime rendering separate from data acquisition.

## Run

```bash
npm install
npm run dev
npm run build
npm run lint
npm test
```

## Demo Video

`artifacts/cheyenne-mountain-demo.mp4` is a captioned walkthrough with no audio.
It shows rotation, trail hover/selection, panning, landmark focus, layer toggles,
export options, and presentation mode. The adjacent WebM is the recording source.

To regenerate, start the Vite development server, then run:

```bash
npx playwright install chromium
npm run demo:record
```

The recorder uses a separate browser and injects captions only into that browser;
it does not modify the app. Set `DEMO_URL` if Vite is on another local port.
The script writes the MP4, WebM source, preview PNG, and approximate chapter
timings under `artifacts`, then decode-checks the MP4. Files are overwritten on
subsequent recordings. Playwright and FFmpeg are development-only dependencies.

## Independent Static Hosting

All required map data is already downloaded and stored in `public/terrain`,
`public/park`, and `public/parks`. The application reads local snapshots, never the USGS or
ArcGIS source services at runtime. Icons, shaders, QR encoding, trees, and
JavaScript dependencies are bundled locally; there are no CDN or online-font
requirements. Source URLs in metadata and the CPW attribution link are references,
not loading dependencies.

Build with `npm ci` followed by `npm run build`, and deploy the entire `dist`
directory, including `assets`, `terrain`, `park`, and `parks`. Do not deploy only the HTML
or JavaScript bundle. Relative asset paths support a site root or a subfolder.
Serve through HTTP(S), not by double-clicking the HTML file. No backend, map API
key, or source-service availability is required. Avoid an HTML fallback for
missing TIFF or GeoJSON requests; those files must be served as real static files.

Keep the saved datasets and their adjacent provenance JSON in source control
and backups. `npm run build` does not download or refresh map data. The
`park:download` and `terrain:download` commands are optional manual maintenance
operations requiring the upstream services; do not include them in deployment
builds. Existing snapshots remain usable if the original services disappear.

Run `npm run test:static` to verify the built data matches the saved snapshots
and that the production landscape loads under `/map/` with external network
requests blocked. This check uses the development-only Playwright browser;
install it with `npx playwright install chromium` when needed.

This guarantees independence from external data providers, not availability
when your own static host is offline. Offline-after-first-visit caching is not
implemented. Public share links and QR codes still need your deployed site's URL.

## Elevation Data

The local `public/terrain/cheyenne-mountain.tif` is a raw Float32 DEM exported
from the [USGS National Map 3DEP service](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer).
The adjacent JSON records the request, actual extent, CRS, and download date.
The request is a projected square centered on the CPW park boundary, covering
all downloaded reference geometry with 400 meters of padding. Use the TIFF
bounds or recorded extent for alignment; the rectangle is not a park boundary.

- CRS: WGS 84 / UTM Zone 13N (EPSG:32613), horizontal units in meters.
- Raster: 257 by 257 samples, approximately 23.1 meters apart in the current export.
- Output spacing is resampling density, not a claim of native DEM resolution.
- Colors and antialiased contour ink are artistic elevation shading, not satellite imagery or land-cover data.

Refresh the data with internet access:

```bash
npm run terrain:download
```

The app reads the local TIFF, so USGS availability is not needed at runtime.
Vite includes files under `public` in the production output.

## Park Reference Data

Local WGS84 GeoJSON is available under `public/park`:

- `boundary.geojson`: CPW public-access property boundary (1 MultiPolygon).
- `trails.geojson`: 50 CPW trail segments, not 50 distinct trails or a personal hike.
- `facilities.geojson`: 40 CPW facility points with names and decoded facility types.
- `trailheads.geojson`: 3 trailheads from an archived February 2021 COTREX layer.
- `sources.json`: source URLs, query filters, attribution, timestamps, and counts.

Boundary, trails, and facilities come from the CPW-owned
[CPWAdminData service](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer).
Its data-edit timestamps were in August 2026 at download time. These are
service-wide timestamps, not individual feature survey dates. Trailheads are
an older reference snapshot. None of these layers is a live closure feed.
Retain attribution and consult source terms before redistribution. Facility
points include operational locations, not just visitor attractions; their
presence in the dataset does not imply public access.

Refresh with `npm run park:download`, then `npm run terrain:download` if bounds change.
The app renders the boundary, trails, and a curated set of visitor locations.
To place markers, pass GeoJSON `[longitude, latitude]` to
`terrain.geographicToScene(longitude, latitude)` and add a small height offset.
Use `FAC_NAME` / `d_FAC_TYPE` for facility labels and `name` for trail labels.
Handle both LineString and MultiLineString geometry when drawing trails.

The current DEM covers all reference geometry; tests verify this. Preserve
source coordinates and expand the DEM if refreshed layers extend outside it.
Do not clamp them to terrain edges or connect across omitted trail sections.
Your personal hiking history still requires your own GPX/GeoJSON export.

## Terrain Coordinates

`src/terrain.js` reads pixel centers (not raster edges), places east along +X,
up along +Y, and north along -Z. Every meter equals 0.025 scene units on all
axes: no vertical exaggeration. The minimum raster elevation is the Y origin.

The loaded terrain provides `geographicToScene(longitude, latitude)`,
`sampleElevation(easting, northing)`, and `sampleHeight(sceneX, sceneZ)`.
Positions outside the DEM return `null`. Elevation sampling matches the mesh
triangles. Trails are densified to at most 5 meters between samples and raised
slightly for rendering; fixed-size Lucide location icons are anchored just above
the surface, without changing geographic coordinates.

Do not equate GPX altitude with DEM altitude without checking their vertical
datums. The DEM is a service mosaic; the export does not establish a single
source acquisition date or vertical datum for this entire area.

The initial orbit target is at the park's surface center, but it is not locked
there. Left-drag rotates, right-drag pans, and scrolling zooms toward the cursor.
Selecting a location moves the target to that point and opens a closer view.
Layer changes and viewport resizing preserve manual navigation. Minimum orbit
distance is 4 scene units; camera height is checked against the local DEM surface.
Panning is not geographically bounded. BVH-accelerated terrain occlusion keeps
point labels responsive; collision layout is throttled during camera movement.

## Demo Video

`artifacts/cheyenne-mountain-demo.mp4` is a short, silent functionality reel
with action captions and visible pointer/click feedback. It demonstrates actual
trail hover/click selection, pan/zoom, landmark focus, layer toggles, sharing,
PNG generation, and presentation mode. Export processing time is cut from the
final edit and replaced with a brief view of the generated artwork.

With the Vite dev server running, regenerate it using `npm run demo:record`.
The recorder uses Playwright Chromium and `ffmpeg-static`; install the browser
with `npx playwright install chromium` on a new machine. Chapter offsets are
approximate, since browser video timestamps can differ from wall-clock timing.

## Artwork Controls

- Eye: presentation mode hides the layer panel while preserving map interaction.
- Reset arrow: return to a park-wide view.
- Download: choose Current view or Park overview. PNGs include a title, curated
	trail-color legend, and source footer. The scene's longest dimension is up to
	2400 pixels; the legend adds space below it. The control panel is excluded.
- Share: copy a URL containing the selected feature, camera position, orbit
	target, layer visibility, and presentation mode. A read-only link field also
	supports browsers without clipboard access. Localhost links work only locally.
- Selecting a trail frames its complete geometry and dims other routes.
- Landmark names appear on hover or selection; icons remain terrain-anchored.
- Camera transitions honor the browser's reduced-motion preference.
- Trail selection uses the existing static emphasis; there is no animated tracing overlay.

The terrain has side walls following its exact DEM rim and a closed underside
2 scene units below the minimum elevation, giving it a sculpted relief-model
appearance without altering geographic coordinates. Landmark icons use
priority-based screen spacing: selection comes first, and individual markers
are revealed as you zoom closer. Hidden icons are also excluded from PNG exports.

The charcoal backdrop emphasizes the relief. The optional Artistic trees layer
adds up to 1,000 mixed conifers and rounded broadleaf trees in three instanced draw calls. Their deterministic
placement follows DEM heights, avoids steep slopes, and keeps trails and visitor
locations clear. Tree positions, sizes, and forest patches are invented visual
decoration, not surveyed vegetation or habitat data. PNG exports include this
layer when enabled and retain the artificial-tree notice.

Subtle meadow color variation is part of the artistic terrain treatment, not
surveyed vegetation or land cover. No additional panel controls are introduced;
both tree types use the existing Artistic trees toggle. Water surfaces are not
included because the bundled park snapshots do not contain verified water polygons.
With the Vite server running, `npm run test:artwork` checks mixed-tree rendering,
trail selection without animated overlays, return to idle, reduced motion, and mobile overflow.

The PNG includes attribution and an illustrative-map notice. On public HTTP(S)
hosts it includes a QR code linking back to the view, or the park overview for
the overview preset. Localhost/private-network URLs are excluded. The app must
be deployed before that QR is useful to visitors. Official park logos,
typography, and branding require supplied assets and approval. The current
styling does not imply park endorsement. Hosting, park review, and update
ownership remain handoff decisions rather than implemented services.
