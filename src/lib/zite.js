import ziteSites from '../data/zite-sites.json'

function agency(site) {
  return String(site.partner || '').trim().toUpperCase()
}

function isUnmanaged(site) {
  const name = agency(site)
  return !name || name === 'NO SMA'
}

export const ziteUnmanagedSites = ziteSites.filter(isUnmanaged)

export const zitePartnerSites = ziteSites
  .filter((site) => !isUnmanaged(site) && agency(site) !== 'ACTED')
  .map((site) => ({ ...site, key: site.id }))

export const ziteManagedSites = ziteSites
  .filter((site) => agency(site) === 'ACTED')
  .map((site) => ({ ...site, key: site.id, place: site.neighborhood || '' }))
