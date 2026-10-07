import partnerSites from '../data/partner-sites.json'

export const partnerSitesByOthers = partnerSites.filter((site) => String(site.partner || '').trim().toUpperCase() !== 'ACTED')
