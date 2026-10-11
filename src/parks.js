function cpwPark(id, title) {
  return {
    id,
    title,
    subtitle: 'State Park',
    name: `${title} State Park`,
    terrain: `parks/${id}/terrain.tif`,
    data: `parks/${id}/`,
    attribution: 'Colorado Parks and Wildlife',
    url: `https://cpw.state.co.us/state-parks/${id}-state-park`,
    footer: 'CPW trails; trailheads: 2021 reference.',
    cpwName: title,
    cpwManager: `${title} State Park`,
  }
}

export const parks = {
  'cheyenne-mountain': {
    id: 'cheyenne-mountain',
    title: 'Cheyenne Mountain',
    subtitle: 'State Park',
    name: 'Cheyenne Mountain State Park',
    terrain: 'terrain/cheyenne-mountain.tif',
    data: 'park/',
    attribution: 'Colorado Parks and Wildlife',
    url: 'https://cpw.state.co.us/state-parks/cheyenne-mountain-state-park',
    footer: 'Trailheads: 2021 reference.',
    cpwName: 'Cheyenne Mountain',
    cpwManager: 'Cheyenne Mountain State Park',
  },
  roxborough: {
    id: 'roxborough',
    title: 'Roxborough',
    subtitle: 'State Park',
    name: 'Roxborough State Park',
    terrain: 'parks/roxborough/terrain.tif',
    data: 'parks/roxborough/',
    attribution: 'Colorado Parks and Wildlife',
    url: 'https://cpw.state.co.us/state-parks/roxborough-state-park',
    footer: 'CPW trails; trailheads: 2021 reference.',
    cpwName: 'Roxborough',
    cpwManager: 'Roxborough State Park',
  },
  mueller: cpwPark('mueller', 'Mueller'),
  'golden-gate-canyon': cpwPark('golden-gate-canyon', 'Golden Gate Canyon'),
  'eldorado-canyon': cpwPark('eldorado-canyon', 'Eldorado Canyon'),
  staunton: cpwPark('staunton', 'Staunton'),
}

export function getPark(id) {
  return parks[id] || parks['cheyenne-mountain']
}