import catalog from '../data/catalog.json'
import registers from '../data/registers.json'
import { verificationRows } from './areas'
import { nearest, pointInRing } from './geo'
import { actMapPoint, actRecord, extentCenter, verificationCandidates } from './sites'

const assessedSites = verificationCandidates(catalog)

function normalizeId(id) {
  if (id == null) return ''
  return String(id).trim().toUpperCase()
}

function servicePoint(id, placed) {
  const key = normalizeId(id)
  if (!key) return null
  const candidate = assessedSites.find((site) => normalizeId(site.id) === key)
  if (candidate) return placed('candidate', candidate.id, candidate.lat, candidate.lon)
  const managed = catalog.managed.find((site) => normalizeId(site.id) === key)
  if (managed) return placed('managed', managed.id, managed.lat, managed.lon)
  const act = actRecord([key])
  if (act) {
    const point = actMapPoint(act)
    if (point) return placed('act', act.id, point.lat, point.lon)
  }
  return extentCenter(key)
}

function average(sites, key) {
  const values = sites.map((site) => site[key]).filter((value) => value != null)
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function areaServices(ring, placed, dots) {
  const sheet = registers.verification
  const nameIndex = sheet.headers.indexOf('Site Name')
  const crcPoints = catalog.crcs.map((site) => ({ ...site, ...placed('crc', site.id, site.lat, site.lon) }))
  const aishaPoints = catalog.aisha.map((site) => ({ ...site, ...placed('aisha', site.id, site.lat, site.lon) }))
  const seen = new Set()
  const sites = []
  for (const row of verificationRows(ring, dots)) {
    const ids = [row[sheet.siteId], row[sheet.formSiteId]].map(normalizeId).filter(Boolean)
    const key = ids[0] || `row-${sites.length}`
    if (seen.has(key)) continue
    seen.add(key)
    const point = ids.flatMap((id) => dots?.get(id) || []).find((item) => pointInRing(item.lat, item.lon, ring))
      || ids.map((id) => servicePoint(id, placed)).find(Boolean)
      || null
    const crc = point ? nearest(point, crcPoints) : null
    const aisha = point ? nearest(point, aishaPoints) : null
    sites.push({
      id: ids[0] || '',
      name: String(row[nameIndex] || ids[0] || 'Assessment'),
      crcKm: crc?.km ?? null,
      crcName: crc?.point.name ?? '',
      aishaKm: aisha?.km ?? null,
      aishaName: aisha?.point.address ?? '',
    })
  }
  return {
    sites,
    crcKm: average(sites, 'crcKm'),
    aishaKm: average(sites, 'aishaKm'),
  }
}
