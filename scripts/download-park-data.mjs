import { mkdir, writeFile } from 'node:fs/promises'
import { parks } from '../src/parks.js'

const park = parks[process.argv[2] || 'cheyenne-mountain']
if (!park?.cpwName || !park.cpwManager) throw new Error('Provide a configured CPW park id.')
const escapeSql = (value) => value.replaceAll("'", "''")

const service = 'https://services1.arcgis.com/82YxYqy3f0s2D9c4/arcgis/rest/services'
const cpwService = 'https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer'
const layers = [
  { file: 'boundary', url: `${cpwService}/5`, where: `PropName LIKE '%${escapeSql(park.cpwName)}%'` },
  { file: 'trails', url: `${cpwService}/2`, where: `manager = '${escapeSql(park.cpwManager)}'` },
  { file: 'facilities', url: `${cpwService}/0`, where: `PROPNAME LIKE '%${escapeSql(park.cpwName)}%'` },
  {
    file: 'trailheads',
    url: `${service}/Trailheads_COTREX02172021/FeatureServer/0`,
    where: `manager = '${escapeSql(park.cpwManager)}'`,
    snapshot: 'February 17, 2021, according to the source layer name.',
  },
]
const directory = new URL(`../public/${park.data}`, import.meta.url)
const downloads = []

for (const layer of layers) {
  const parameters = new URLSearchParams({
    f: 'geojson',
    where: layer.where,
    outFields: '*',
    outSR: '4326',
    returnGeometry: 'true',
  })
  const queryUrl = `${layer.url}/query?${parameters}`
  const response = await fetch(queryUrl, { signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error(`${layer.file} download failed: ${response.status}`)
  const collection = await response.json()
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)
    || (['boundary', 'trails'].includes(layer.file) && !collection.features.length)) {
    throw new Error(`${layer.file} returned no GeoJSON features: ${JSON.stringify(collection.error)}`)
  }
  if (collection.exceededTransferLimit || collection.properties?.exceededTransferLimit) {
    throw new Error(`${layer.file} exceeded the service limit; pagination is required.`)
  }
  await mkdir(directory, { recursive: true })
  await writeFile(new URL(`${layer.file}.geojson`, directory), JSON.stringify(collection, null, 2) + '\n')
  const metadataResponse = await fetch(`${layer.url}?f=json`, { signal: AbortSignal.timeout(120000) })
  if (!metadataResponse.ok) throw new Error(`Source metadata failed: ${metadataResponse.status}`)
  const metadata = await metadataResponse.json()
  if (metadata.error) throw new Error(JSON.stringify(metadata.error))
  downloads.push({
    ...layer,
    queryUrl,
    features: collection.features.length,
    attribution: metadata.copyrightText,
    lastServiceDataEdit: metadata.editingInfo?.dataLastEditDate,
  })
}

await writeFile(new URL('sources.json', directory), JSON.stringify({
  park: park.name,
  downloadedAt: new Date().toISOString(),
  coordinateOrder: '[longitude, latitude], WGS84 (EPSG:4326)',
  attribution: 'Colorado Parks and Wildlife / Colorado State Trails Program. See per-layer attribution.',
  sourceSnapshot: 'CPWAdminData service snapshot at download time; trailheads use an archived 2021 COTREX layer. Service edit timestamps do not establish individual feature survey dates.',
  note: 'Public reference trails, not a personal recorded hike. Verify access and closures with CPW. Preserve source attributes and attribution when displaying or redistributing.',
  downloads,
}, null, 2) + '\n')
console.log(JSON.stringify(downloads, null, 2))