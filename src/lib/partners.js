import partnerSites from '../data/partner-sites.json'

const partnerSitesByOthers = partnerSites.filter((site) => String(site.partner || '').trim().toUpperCase() !== 'ACTED')

function normalizeId(id) {
  return String(id ?? '').trim().toUpperCase()
}

const partnerIdSet = new Set()
const partnerById = new Map()
for (const site of partnerSitesByOthers) {
  partnerIdSet.add(normalizeId(site.id))
  partnerIdSet.add(normalizeId(site.key))
  const id = normalizeId(site.id)
  if (id && !partnerById.has(id)) partnerById.set(id, site)
}

export { partnerSitesByOthers }

export function listedAsPartner(ids) {
  return ids.some((id) => partnerIdSet.has(normalizeId(id)))
}

export function partnerFor(id) {
  return partnerById.get(normalizeId(id)) || null
}

export function partnerSearchParts(id) {
  const site = partnerFor(id)
  if (!site) return []
  return [site.name, site.nameAr, site.partner, site.neighborhood, site.governorate]
}
