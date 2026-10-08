import * as XLSX from 'xlsx'
import catalog from '../data/catalog.json'
import neighborhoods from '../data/neighborhoods.json'
import registers from '../data/registers.json'
import { listedAsPartner } from './partners'
import { pointInRing } from './geo'
import { listedAsManaged } from './managed-layer'
import { extentCenter, verificationCandidates } from './sites'

function normalizeId(id) {
  if (id == null) return ''
  const text = String(id).trim().toUpperCase()
  return text
}

export function dotInside(ids, ring, dots) {
  if (!ring || !dots) return false
  for (const id of ids) {
    const points = dots.get(normalizeId(id))
    if (!points) continue
    if (points.some((point) => pointInRing(point.lat, point.lon, ring))) return true
  }
  return false
}

function dotCoordinate(ids, dots) {
  for (const id of ids) {
    const points = dots?.get(normalizeId(id))
    if (points?.length) return [points[0].lat, points[0].lon]
  }
  return ['', '']
}

function decodeName(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

function geometryContains(lat, lon, geometry) {
  if (!geometry) return false
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates || []
      : []
  return polygons.some((polygon) => {
    const [outer, ...holes] = polygon || []
    if (!outer || !pointInRing(lat, lon, outer)) return false
    return !holes.some((hole) => hole && pointInRing(lat, lon, hole))
  })
}

const neighborhoodPlaces = neighborhoods.features.map((feature) => ({
  name: decodeName(feature.properties?.name),
  geometry: feature.geometry,
}))

function mapNeighborhood(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ''
  const names = neighborhoodPlaces
    .filter((place) => place.name && geometryContains(lat, lon, place.geometry))
    .map((place) => place.name)
  return [...new Set(names)].join('; ')
}

function neighborhoodField(ids, dots) {
  const [lat, lon] = dotCoordinate(ids, dots)
  if (lat === '' || lon === '') return ''
  return mapNeighborhood(lat, lon)
}

function coordinate(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const householdColumn = registers.act.headers.indexOf('Households')
const individualColumn = registers.act.headers.indexOf('Individuals')

function amount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value.replace(/,/g, ''))
    return Number.isFinite(number) ? number : 0
  }
  return 0
}

const verificationHouseholdColumn = registers.verification.headers.findIndex((header) =>
  String(header).replace(/\s+/g, ' ').startsWith('Estimated number of households currently accommodated'),
)
const verificationIndividualColumn = registers.verification.headers.findIndex((header) =>
  String(header).replace(/\s+/g, ' ').startsWith('Estimated number of individuals currently accommodated'),
)
const typologyColumn = registers.verification.headers.findIndex((header) => String(header).includes('typology'))
const typologyById = new Map()
for (const row of registers.verification.rows) {
  const value = String(row[typologyColumn] ?? '').trim()
  if (!value) continue
  for (const index of [registers.verification.siteId, registers.verification.formSiteId]) {
    const id = normalizeId(row[index])
    if (id && !typologyById.has(id)) typologyById.set(id, value)
  }
}

export function siteTypology(...ids) {
  for (const id of ids) {
    const value = typologyById.get(normalizeId(id))
    if (value) return value
  }
  return ''
}

function rowIds(row, indexes) {
  return indexes.map((index) => normalizeId(row[index])).filter(Boolean)
}

export function actPopulation(rows) {
  let hhs = 0
  let individuals = 0
  for (const row of rows) {
    hhs += amount(row[householdColumn])
    individuals += amount(row[individualColumn])
  }
  return { hhs, individuals }
}

export function areaPopulation(verification, act, areaRing, dots) {
  const seen = new Set()
  const chosen = new Map()
  for (const row of verification) {
    const ids = rowIds(row, [registers.verification.siteId, registers.verification.formSiteId])
    const key = ids[0] || `verification-${chosen.size}`
    const hhs = amount(row[verificationHouseholdColumn])
    const individuals = amount(row[verificationIndividualColumn])
    if (!hhs && !individuals) continue
    const current = chosen.get(key)
    if (!current || individuals > current.individuals) chosen.set(key, { hhs, individuals, ids })
  }
  let hhs = 0
  let individuals = 0
  for (const item of chosen.values()) {
    hhs += item.hhs
    individuals += item.individuals
    item.ids.forEach((id) => seen.add(id))
  }
  for (const row of act) {
    const ids = rowIds(row, [registers.act.siteId, registers.act.newSiteId])
    if (ids.some((id) => seen.has(id))) continue
    const households = amount(row[householdColumn])
    const people = amount(row[individualColumn])
    if (!households && !people) continue
    hhs += households
    individuals += people
    ids.forEach((id) => seen.add(id))
  }
  if (areaRing && dots) {
    for (const site of catalog.candidates) {
      const key = normalizeId(site.id)
      if (!key || seen.has(key) || listedAsManaged([site.id]) || listedAsPartner([site.id])) continue
      if (!dotInside([site.id], areaRing, dots)) continue
      hhs += amount(site.hhs)
      individuals += amount(site.individuals)
      seen.add(key)
    }
  }
  return { hhs, individuals }
}

export function verificationRows(areaRing, dots) {
  const { rows, siteId, formSiteId } = registers.verification
  return rows.filter((row) => {
    const ids = [row[siteId], row[formSiteId]]
    if (listedAsManaged(ids) || listedAsPartner(ids)) return false
    return dotInside(ids, areaRing, dots)
  })
}

export function actRows(areaRing, dots) {
  const sheet = registers.act
  return sheet.rows.filter((row) => {
    const ids = [row[sheet.siteId], row[sheet.newSiteId]]
    if (listedAsManaged(ids) || listedAsPartner(ids)) return false
    return dotInside(ids, areaRing, dots)
  })
}

export function areaContents(areaRing, dots) {
  return {
    verification: verificationRows(areaRing, dots),
    act: actRows(areaRing, dots),
  }
}

export function downloadAreaWorkbook(name, areaRing, dots) {
  const contents = areaContents(areaRing, dots)
  const population = areaPopulation(contents.verification, contents.act, areaRing, dots)
  const verification = registers.verification
  const act = registers.act
  const verificationRows = contents.verification.map((row) => {
    const ids = [row[verification.siteId], row[verification.formSiteId]]
    return [neighborhoodField(ids, dots), ...dotCoordinate(ids, dots), ...row]
  })
  const actRows = contents.act.map((row) => {
    const ids = [row[act.siteId], row[act.newSiteId]]
    return [neighborhoodField(ids, dots), ...dotCoordinate(ids, dots), ...row]
  })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Area', name],
      ['Sites', contents.verification.length],
      ['ACT sites', contents.act.length],
      ['Households', population.hhs],
      ['Individuals', population.individuals],
    ]),
    'Area',
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['Map neighborhood', 'Dot latitude', 'Dot longitude', ...verification.headers], ...verificationRows]),
    'Site verification',
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['Map neighborhood', 'Dot latitude', 'Dot longitude', ...act.headers], ...actRows]),
    'ACT sites',
  )
  const safe = String(name || 'area').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'area'
  XLSX.writeFile(book, `${safe}.xlsx`)
  return { verification: contents.verification.length, act: contents.act.length }
}

function targetFromPlace(place) {
  const text = String(place || '').trim().toLowerCase()
  if (!text) return ''
  const area = catalog.areas.find((item) => item.neighborhood.toLowerCase() === text || item.name.toLowerCase() === text)
  return area?.name || ''
}

function nearestTarget(lat, lon) {
  let best = null
  let bestDistance = Infinity
  for (const area of catalog.areas) {
    const distance = (area.lat - lat) ** 2 + (area.lon - lon) ** 2
    if (distance < bestDistance) {
      best = area
      bestDistance = distance
    }
  }
  return best?.name || ''
}

function insideAreas(ids, definedAreas, dots) {
  return (definedAreas || []).filter((area) => area?.ring && dotInside(ids, area.ring, dots))
}

function areaFields(ids, definedAreas, point, assessedById, placeName, dots) {
  const keys = [...new Set(ids.map(normalizeId).filter(Boolean))]
  const inside = listedAsManaged(keys) || listedAsPartner(keys) ? [] : insideAreas(keys, definedAreas, dots)
  if (inside.length) {
    const targeted = [...new Set(inside.map((area) => area.parent).filter(Boolean))]
    const names = inside.map((area) => area.name).filter(Boolean)
    return [targeted.join('; '), names.join('; ')]
  }
  for (const id of keys) {
    const site = assessedById.get(id)
    if (site?.area) return [site.area, '']
  }
  const named = targetFromPlace(placeName)
  if (named) return [named, '']
  for (const id of keys) {
    const center = extentCenter(id)
    if (center) return [nearestTarget(center.lat, center.lon), '']
  }
  if (point) return [nearestTarget(point.lat, point.lon), '']
  return ['', '']
}

export function downloadAllSitesWorkbook(definedAreas = [], dots) {
  const assessedById = new Map(verificationCandidates(catalog).map((site) => [normalizeId(site.id), site]))
  const verification = registers.verification
  const act = registers.act
  const neighbourhoodIndex = act.headers.indexOf('Neighbourhood')
  const allocatedIndex = act.headers.indexOf('Neighbourhood allocated to')
  const verificationRows = verification.rows.map((row) => {
    const ids = [row[verification.siteId], row[verification.formSiteId]]
    const [targeted, area] = areaFields(ids, definedAreas, null, assessedById, '', dots)
    return [targeted, area, neighborhoodField(ids, dots), ...dotCoordinate(ids, dots), ...row]
  })
  const actRows = act.rows.map((row) => {
    const ids = [row[act.siteId], row[act.newSiteId]]
    const lat = coordinate(row[act.lat])
    const lon = coordinate(row[act.lon])
    const point = lat != null && lon != null ? { lat, lon } : null
    const placeName = row[neighbourhoodIndex] || row[allocatedIndex]
    const [targeted, area] = areaFields(ids, definedAreas, point, assessedById, placeName, dots)
    return [targeted, area, neighborhoodField(ids, dots), ...dotCoordinate(ids, dots), ...row]
  })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['Targeted area', 'Drawn area', 'Map neighborhood', 'Dot latitude', 'Dot longitude', ...verification.headers], ...verificationRows]),
    'Site verification',
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['Targeted area', 'Drawn area', 'Map neighborhood', 'Dot latitude', 'Dot longitude', ...act.headers], ...actRows]),
    'ACT sites',
  )
  XLSX.writeFile(book, 'site-verification-and-act-sites.xlsx')
  return { verification: verificationRows.length, act: actRows.length }
}
