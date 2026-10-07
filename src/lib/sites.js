import extents from '../data/extents.json'
import managedExtents from '../data/managed-extents.json'
import registers from '../data/registers.json'
import { haversineKm, pointInRing, ringCentroid } from './geo'

const actSheet = registers.act
const actColumn = Object.fromEntries(actSheet.headers.map((name, index) => [name, index]))

function normalizeId(id) {
  if (id == null) return ''
  return String(id).trim().toUpperCase()
}

export function siteForExtent(catalog, code) {
  const key = normalizeId(code)
  if (!key) return null
  const candidate = catalog.candidates.find((site) => site.id.toUpperCase() === key)
  if (candidate) return { type: 'candidate', id: candidate.id }
  const managed = catalog.managed.find((site) => site.id.toUpperCase() === key)
  if (managed) return { type: 'managed', id: managed.id }
  return null
}

export function actRecord(codes) {
  const wanted = new Set(codes.map(normalizeId).filter(Boolean))
  if (!wanted.size) return null
  const row = actSheet.rows.find((item) => {
    const siteId = normalizeId(item[actColumn['Site ID']])
    const newId = normalizeId(item[actColumn['New Site ID']])
    return wanted.has(siteId) || (newId && wanted.has(newId))
  })
  if (!row) return null
  const record = { id: String(row[actColumn['Site ID']]).trim() }
  for (const [name, index] of Object.entries(actColumn)) {
    const value = row[index]
    if (value == null || String(value).trim() === '') continue
    record[name] = value
  }
  return record
}

function outerRing(feature) {
  const geometry = feature.geometry
  if (!geometry) return null
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] ?? null
  if (geometry.type === 'MultiPolygon') return geometry.coordinates?.[0]?.[0] ?? null
  return null
}

const extentRings = new Map()
const extentCenters = new Map()

function rememberCenter(id, center) {
  const key = normalizeId(id)
  if (!key || !center || extentCenters.has(key)) return
  extentCenters.set(key, center)
}

function rememberRing(id, ring) {
  const key = normalizeId(id)
  if (!key || !ring?.length || extentRings.has(key)) return
  extentRings.set(key, ring)
  rememberCenter(id, ringCentroid(ring))
}

function lineCenter(feature) {
  const geometry = feature.geometry
  if (geometry?.type !== 'LineString' || !geometry.coordinates?.length) return null
  const mid = geometry.coordinates[Math.floor((geometry.coordinates.length - 1) / 2)]
  if (!mid || mid.length < 2) return null
  return { lon: mid[0], lat: mid[1] }
}

for (const feature of [...extents.features, ...managedExtents.features]) {
  const ring = outerRing(feature)
  if (ring) {
    rememberRing(feature.properties.code, ring)
    rememberRing(feature.properties.actCode, ring)
    rememberRing(feature.properties.id, ring)
    continue
  }
  const center = lineCenter(feature)
  if (!center) continue
  rememberCenter(feature.properties.code, center)
  rememberCenter(feature.properties.actCode, center)
  rememberCenter(feature.properties.id, center)
}

export function extentCenter(...ids) {
  for (const id of ids) {
    const center = extentCenters.get(normalizeId(id))
    if (center) return center
  }
  return null
}

export function actMapPoint(site) {
  const center = extentCenter(site.id, site['New Site ID'])
  if (center) return center
  const lat = Number(site.Latitude)
  const lon = Number(site.Longitude)
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon }
  return null
}

export function listActSites() {
  return actSheet.rows.flatMap((row) => {
    const id = String(row[actColumn['Site ID']] ?? '').trim()
    if (!id) return []
    const record = { id }
    for (const [name, index] of Object.entries(actColumn)) {
      const value = row[index]
      if (value == null || String(value).trim() === '') continue
      record[name] = value
    }
    return [record]
  })
}

export function actMapSites() {
  return listActSites().flatMap((site) => {
    const point = actMapPoint(site)
    if (!point) return []
    return [{
      id: site.id,
      name: site['Site name'] || site.id,
      neighbourhood: site.Neighbourhood || '',
      lat: point.lat,
      lon: point.lon,
    }]
  })
}

function populationAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value.replace(/,/g, ''))
    if (Number.isFinite(number)) return number
  }
  return 0
}

function headerIndex(headers, prefix) {
  return headers.findIndex((header) => String(header).replace(/\s+/g, ' ').startsWith(prefix))
}

function nearestArea(areas, lat, lon) {
  let best = areas[0]
  let bestKm = Infinity
  for (const area of areas) {
    const km = haversineKm(lat, lon, area.lat, area.lon)
    if (km < bestKm) {
      best = area
      bestKm = km
    }
  }
  return best
}

const verificationSheet = registers.verification
const verificationHouseholdColumn = headerIndex(
  verificationSheet.headers,
  'Estimated number of households currently accommodated',
)
const verificationIndividualColumn = headerIndex(
  verificationSheet.headers,
  'Estimated number of individuals currently accommodated',
)
const verificationNameColumn = verificationSheet.headers.indexOf('Site Name')
const verificationStatusColumn = verificationSheet.headers.indexOf('Site Status')
const verificationDateColumn = verificationSheet.headers.indexOf('Date of interview:')

function laterAssessment(current, next) {
  const currentDate = String(current[verificationDateColumn] ?? '')
  const nextDate = String(next[verificationDateColumn] ?? '')
  if (nextDate !== currentDate) return nextDate > currentDate ? next : current
  return populationAmount(next[verificationIndividualColumn]) > populationAmount(current[verificationIndividualColumn]) ? next : current
}

export function verificationCandidates(catalog) {
  const rowsById = new Map()
  for (const row of verificationSheet.rows) {
    const id = normalizeId(row[verificationSheet.siteId] || row[verificationSheet.formSiteId])
    if (!id) continue
    const current = rowsById.get(id)
    rowsById.set(id, current ? laterAssessment(current, row) : row)
  }

  const managedById = new Map(catalog.managed.map((site) => [normalizeId(site.id), site]))
  const sites = []
  for (const candidate of catalog.candidates) {
    const row = rowsById.get(normalizeId(candidate.id))
    sites.push(row ? { ...candidate, status: String(row[verificationStatusColumn] ?? '').trim() } : candidate)
  }

  const known = new Set(sites.map((site) => normalizeId(site.id)))
  for (const [id, row] of rowsById) {
    if (known.has(id) || managedById.has(id)) continue
    const point = extentCenter(id)
    if (!point) continue
    const area = nearestArea(catalog.areas, point.lat, point.lon)
    const sheetId = String(row[verificationSheet.siteId] || row[verificationSheet.formSiteId] || id).trim()
    sites.push({
      id: sheetId,
      name: String(row[verificationNameColumn] || sheetId).trim() || sheetId,
      area: area?.name ?? '',
      neighborhood: area?.neighborhood ?? '',
      hhs: populationAmount(row[verificationHouseholdColumn]),
      individuals: populationAmount(row[verificationIndividualColumn]),
      lat: point.lat,
      lon: point.lon,
      distanceCrcKm: null,
      distanceAnchorKm: null,
      rank: 10000,
      workbookSelected: false,
      fromVerification: true,
      status: String(row[verificationStatusColumn] ?? '').trim(),
    })
  }
  return sites
}

function extentCodes(feature) {
  return [feature.properties?.code, feature.properties?.actCode, feature.properties?.id].map(normalizeId).filter(Boolean)
}

function linkedExtentCodes(catalog) {
  const linked = new Set()
  for (const site of verificationCandidates(catalog)) linked.add(normalizeId(site.id))
  for (const site of catalog.managed) linked.add(normalizeId(site.id))
  for (const site of listActSites()) {
    if (!actMapPoint(site)) continue
    linked.add(normalizeId(site.id))
    linked.add(normalizeId(site['New Site ID']))
  }
  for (const feature of [...extents.features, ...managedExtents.features]) {
    const codes = [feature.properties?.code, feature.properties?.actCode].map(normalizeId).filter(Boolean)
    if (!codes.some((code) => linked.has(code))) continue
    codes.forEach((code) => linked.add(code))
  }
  return linked
}

function claimUnlinked(feature, linked, areas) {
  const props = feature.properties || {}
  const codes = extentCodes(feature)
  if (codes.some((code) => linked.has(code))) return null
  const center = extentCenter(props.code, props.actCode, props.id)
  if (!center) return null
  const id = String(props.code || props.id || '').trim()
  if (!id || linked.has(normalizeId(id))) return null
  codes.forEach((code) => linked.add(code))
  linked.add(normalizeId(id))
  const name = String(props.name || props.label || id).trim() || id
  if (!areas) {
    return {
      id,
      name,
      nameAr: '',
      place: '',
      governorate: '',
      lat: center.lat,
      lon: center.lon,
      fromExtent: true,
    }
  }
  const area = nearestArea(areas, center.lat, center.lon)
  return {
    id,
    name,
    area: area?.name ?? '',
    neighborhood: area?.neighborhood ?? '',
    hhs: 0,
    individuals: 0,
    lat: center.lat,
    lon: center.lon,
    distanceCrcKm: null,
    distanceAnchorKm: null,
    rank: 10000,
    workbookSelected: false,
    fromExtent: true,
    status: '',
  }
}

export function polygonSites(catalog) {
  const linked = linkedExtentCodes(catalog)
  const candidates = []
  const managed = []
  for (const feature of extents.features) {
    const site = claimUnlinked(feature, linked, catalog.areas)
    if (site) candidates.push(site)
  }
  for (const feature of managedExtents.features) {
    const site = claimUnlinked(feature, linked, null)
    if (site) managed.push(site)
  }
  return { candidates, managed }
}

export function unlinkedExtents(catalog) {
  const dots = polygonSites(catalog)
  const linked = linkedExtentCodes(catalog)
  for (const site of dots.candidates) linked.add(normalizeId(site.id))
  for (const site of dots.managed) linked.add(normalizeId(site.id))
  const features = []
  for (const feature of extents.features) {
    if (extentCodes(feature).some((code) => linked.has(code))) continue
    features.push({ ...feature, properties: { ...feature.properties, unlinkedKind: 'extent' } })
  }
  for (const feature of managedExtents.features) {
    if (extentCodes(feature).some((code) => linked.has(code))) continue
    features.push({ ...feature, properties: { ...feature.properties, unlinkedKind: 'managed' } })
  }
  return { type: 'FeatureCollection', features }
}

function featureRings(feature) {
  const geometry = feature.geometry
  if (!geometry) return []
  if (geometry.type === 'Polygon') return geometry.coordinates?.[0] ? [geometry.coordinates[0]] : []
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((part) => part?.[0]).filter((ring) => ring?.length)
  return []
}

function ownerPoint(catalog, owner) {
  const center = extentCenter(owner.id)
  if (center) return center
  if (owner.type === 'act') {
    const act = actRecord([owner.id])
    return act ? actMapPoint(act) : null
  }
  const list = owner.type === 'managed' ? catalog.managed : catalog.candidates
  const site = list.find((item) => item.id === owner.id)
  if (!site || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) return null
  return { lat: site.lat, lon: site.lon }
}

function ownerFor(catalog, feature) {
  const props = feature.properties || {}
  const codes = [props.code, props.actCode, props.id]
  const site = codes.map((code) => siteForExtent(catalog, code)).find(Boolean)
  if (site) return site
  const act = actRecord(codes)
  if (act && actMapPoint(act)) return { type: 'act', id: act.id }
  return null
}

export function barePolygonDots(catalog) {
  const dots = []
  const seen = new Set()
  for (const feature of [...extents.features, ...managedExtents.features]) {
    const owner = ownerFor(catalog, feature)
    if (!owner) continue
    const home = ownerPoint(catalog, owner)
    featureRings(feature).forEach((ring, index) => {
      if (home && pointInRing(home.lat, home.lon, ring)) return
      const center = ringCentroid(ring)
      if (!center) return
      const key = `${normalizeId(feature.properties?.id) || 'extent'}:${index}`
      const place = `${owner.type}:${normalizeId(owner.id)}:${center.lat.toFixed(5)}:${center.lon.toFixed(5)}`
      if (seen.has(place)) return
      seen.add(place)
      dots.push({
        key,
        type: owner.type,
        id: owner.id,
        lat: center.lat,
        lon: center.lon,
        name: feature.properties?.name || owner.id,
      })
    })
  }
  return dots
}

export function focusForExtent(focus, catalog) {
  if (!focus || focus.type === 'act') return focus
  if (focus.type !== 'extent') return focus
  const feature = extents.features.find((item) => item.properties.id === focus.id)
  if (!feature) return focus
  const codes = [feature.properties.code, feature.properties.actCode]
  const site = codes.map((code) => siteForExtent(catalog, code)).find(Boolean)
  if (site) return { ...focus, type: site.type, id: site.id }
  const act = actRecord(codes)
  if (act) return { ...focus, type: 'act', id: act.id, extentId: feature.properties.id }
  return focus
}
