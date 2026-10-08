const MANAGED_LAYER_IDS = [
  'KYS0269', 'KYS0925', 'KYS1414', 'KYS1440', 'KYS1792', 'KYS2037', 'KYS4267', 'KYS4727',
  'KYS4873', 'KYS4874', 'KYS4875', 'KYS5065', 'KYS5184', 'KYS5188', 'KYS5369', 'KYS5460',
  'KYS5571', 'KYS5575', 'KYS5582', 'KYS5584', 'KYS5585', 'KYS5589', 'KYS5592', 'KYS5594', 'KYS5600',
  'GZA0388', 'GZA3491', 'GZA4050', 'GZA4157', 'GZA4345', 'GZA4580', 'GZA4818', 'GZA4829',
  'GZA4958', 'GZA4964', 'GZA4965', 'GZA4974', 'GZA4980', 'GZA4997', 'GZA4998', 'GZA5004',
  'GZA5014', 'GZA5026', 'GZA5028', 'GZA5038', 'GZA5041', 'GZA5206', 'GZA5255', 'GZA5404',
  'GZA5409', 'GZA5434', 'GZA5449', 'GZA5464', 'GZA5500', 'GZA5503', 'GZA5524', 'GZA5574',
  'GZA5601', 'GZA5605', 'GZA5607', 'GZA5617', 'GZA6017', 'GZA6021', 'GZA5522', 'GZA5636',
  'GZA5579', 'GZA5583', 'GZA5591', 'GZA5598', 'GZA5599',
]

const managedLayerIdSet = new Set(MANAGED_LAYER_IDS)
const managedLayerOrder = new Map(MANAGED_LAYER_IDS.map((id, index) => [id, index]))

export function listedAsManaged(ids) {
  return ids.some((id) => managedLayerIdSet.has(String(id ?? '').trim().toUpperCase()))
}

const correctedCoordinateIds = new Set([
  'KYS0269', 'KYS0925', 'KYS1414', 'KYS1440', 'KYS1792', 'KYS2037', 'KYS4267', 'KYS4727',
  'KYS4873', 'KYS4874', 'KYS4875', 'KYS5065', 'KYS5184', 'KYS5188', 'KYS5369', 'KYS5460',
  'KYS5571', 'KYS5575', 'KYS5582', 'KYS5584', 'KYS5585', 'KYS5589', 'KYS5592', 'KYS5594', 'KYS5600',
])

export function usesCorrectedCoordinate(type, id) {
  return type === 'managed' && correctedCoordinateIds.has(String(id ?? '').trim().toUpperCase())
}

export function managedLayerSites(sites) {
  return sites
    .filter((site) => managedLayerOrder.has(String(site.id || '').toUpperCase()))
    .sort((a, b) => managedLayerOrder.get(a.id.toUpperCase()) - managedLayerOrder.get(b.id.toUpperCase()))
}
