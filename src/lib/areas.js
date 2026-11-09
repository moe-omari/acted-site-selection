import * as XLSX from 'xlsx'
import catalog from '../data/catalog.json'
import neighborhoods from '../data/neighborhoods.json'
import registers from '../data/registers.json'
import { listedAsPartner } from './partners'
import { downloadJson, pointInRing, ringCentroid } from './geo'
import { listedAsManaged } from './managed-layer'
import { extentCenter, isOfficialSiteId, promotedActSites, verificationCandidates, verificationPopulation } from './sites'
import { ziteManagedSites } from './zite'

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

const neighborhoodNames = new Set(neighborhoodPlaces.map((place) => place.name).filter(Boolean))

const catalogParentByName = new Map()
for (const area of catalog.areas) {
  catalogParentByName.set(area.name.trim().toLowerCase(), area.name)
  catalogParentByName.set(area.neighborhood.trim().toLowerCase(), area.name)
}
catalogParentByName.set('an naser', 'Al-Naser')

const extraGroupColors = ['#c4554d', '#0f7b6c', '#9c27b0', '#b3541e', '#2e7d32', '#5c5b57']

export function isKnownAreaParent(name) {
  const text = String(name || '').trim()
  if (!text) return false
  if (catalog.areas.some((area) => area.name === text)) return true
  return neighborhoodNames.has(text)
}

function catalogParent(name) {
  return catalogParentByName.get(String(name || '').trim().toLowerCase()) || ''
}

function scoreNeighborhood(counts, lat, lon, weight) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
  for (const place of neighborhoodPlaces) {
    if (!place.name || !geometryContains(lat, lon, place.geometry)) continue
    counts.set(place.name, (counts.get(place.name) || 0) + weight)
  }
}

export function parentForRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return ''
  const counts = new Map()
  for (const pair of ring) scoreNeighborhood(counts, Number(pair[1]), Number(pair[0]), 1)
  const center = ringCentroid(ring)
  if (center) scoreNeighborhood(counts, center.lat, center.lon, ring.length)
  let best = ''
  let bestCount = 0
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  if (!best) return ''
  return catalogParent(best) || best
}

export function pointInNeighborhood(lat, lon, name) {
  const wanted = String(name || '').trim()
  if (!wanted || !Number.isFinite(lat) || !Number.isFinite(lon)) return false
  return neighborhoodPlaces.some((place) => place.name === wanted && geometryContains(lat, lon, place.geometry))
}

export function neighborhoodFrame(name) {
  const wanted = String(name || '').trim()
  const place = neighborhoodPlaces.find((item) => item.name === wanted)
  if (!place?.geometry) return null
  const polygons = place.geometry.type === 'Polygon'
    ? [place.geometry.coordinates]
    : place.geometry.type === 'MultiPolygon'
      ? place.geometry.coordinates || []
      : []
  let minLat = Infinity
  let maxLat = -Infinity
  let minLon = Infinity
  let maxLon = -Infinity
  for (const polygon of polygons) {
    for (const pair of polygon?.[0] || []) {
      const lon = Number(pair[0])
      const lat = Number(pair[1])
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
    }
  }
  if (!Number.isFinite(minLat)) return null
  return {
    name: wanted,
    lat: (minLat + maxLat) / 2,
    lon: (minLon + maxLon) / 2,
    points: [
      { lat: minLat, lon: minLon },
      { lat: minLat, lon: maxLon },
      { lat: maxLat, lon: minLon },
      { lat: maxLat, lon: maxLon },
    ],
  }
}

export function colorForAreaGroup(name) {
  const match = catalog.areas.find((area) => area.name === name)
  if (match) return match.color
  let hash = 0
  const text = String(name || '')
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  return extraGroupColors[hash % extraGroupColors.length]
}

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

export function areaPopulation(verification, act, areaRing, dots, rings) {
  const seen = new Set()
  const chosen = new Map()
  for (const row of verification) {
    const ids = rowIds(row, [registers.verification.siteId, registers.verification.formSiteId])
    const key = ids[0] || `verification-${chosen.size}`
    const { hhs, individuals } = verificationPopulation(row)
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
  const shapes = Array.isArray(rings) && rings.length ? rings : (areaRing ? [areaRing] : [])
  if (shapes.length && dots) {
    for (const site of catalog.candidates) {
      const key = normalizeId(site.id)
      if (!key || seen.has(key) || listedAsManaged([site.id]) || listedAsPartner([site.id])) continue
      if (!shapes.some((ring) => dotInside([site.id], ring, dots))) continue
      hhs += amount(site.hhs)
      individuals += amount(site.individuals)
      seen.add(key)
    }
  }
  for (const site of promotedActSites(catalog.areas)) {
    const key = normalizeId(site.id)
    const former = normalizeId(site.formerActId)
    if (!key || seen.has(key) || (former && seen.has(former))) continue
    if (!shapes.some((ring) => dotInside([site.id, site.formerActId], ring, dots))) continue
    hhs += amount(site.hhs)
    individuals += amount(site.individuals)
    seen.add(key)
    if (former) seen.add(former)
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
    if (isOfficialSiteId(row[sheet.newSiteId])) return false
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

function rowsInside(rows, idIndexes, rings, dots) {
  return rows.filter((row) => {
    const ids = idIndexes.map((index) => row[index])
    if (listedAsManaged(ids) || listedAsPartner(ids)) return false
    return rings.some((ring) => dotInside(ids, ring, dots))
  })
}

export const areaExceptionIds = new Set(['KYS5817'])

function exceptionPoint(site, dots) {
  const points = dots?.get(normalizeId(site.id))
  if (points?.length) return points[0]
  const lat = Number(site.lat)
  const lon = Number(site.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon }
}

export function areaExceptionsInside(rings, dots) {
  const shapes = (rings || []).filter((ring) => Array.isArray(ring) && ring.length >= 3)
  if (!shapes.length) return []
  return ziteManagedSites.flatMap((site) => {
    if (!areaExceptionIds.has(normalizeId(site.id))) return []
    const point = exceptionPoint(site, dots)
    if (!point || !shapes.some((ring) => pointInRing(point.lat, point.lon, ring))) return []
    return [{ ...site, lat: point.lat, lon: point.lon }]
  })
}

export function noSmaInside(rings, sites) {
  const shapes = (rings || []).filter((ring) => Array.isArray(ring) && ring.length >= 3)
  if (!shapes.length || !sites) return []
  const seen = new Set()
  const inside = []
  for (const site of sites) {
    const id = normalizeId(site.id)
    if (!id || seen.has(id)) continue
    const lat = Number(site.lat)
    const lon = Number(site.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    if (!shapes.some((ring) => pointInRing(lat, lon, ring))) continue
    seen.add(id)
    inside.push(site)
  }
  return inside
}

export function combinedAreaCounts(rings, dots, noSmaSites) {
  const shapes = (rings || []).filter((ring) => Array.isArray(ring) && ring.length >= 3)
  if (!shapes.length) return { verification: 0, act: 0, noSma: 0, hhs: 0, individuals: 0 }
  const verification = rowsInside(
    registers.verification.rows,
    [registers.verification.siteId, registers.verification.formSiteId],
    shapes,
    dots,
  )
  const act = rowsInside(
    registers.act.rows.filter((row) => !isOfficialSiteId(row[registers.act.newSiteId])),
    [registers.act.siteId, registers.act.newSiteId],
    shapes,
    dots,
  )
  const population = areaPopulation(verification, act, null, dots, shapes)
  const counted = new Set()
  for (const row of verification) {
    for (const id of rowIds(row, [registers.verification.siteId, registers.verification.formSiteId])) counted.add(id)
  }
  const promoted = promotedActSites(catalog.areas).filter((site) => {
    const key = normalizeId(site.id)
    const former = normalizeId(site.formerActId)
    if (!key || counted.has(key) || (former && counted.has(former))) return false
    return shapes.some((ring) => dotInside([site.id, site.formerActId], ring, dots))
  })
  const noSma = noSmaInside(shapes, noSmaSites)
  const alreadyCounted = new Set()
  for (const row of verification) {
    for (const id of rowIds(row, [registers.verification.siteId, registers.verification.formSiteId])) alreadyCounted.add(id)
  }
  for (const row of act) {
    for (const id of rowIds(row, [registers.act.siteId, registers.act.newSiteId])) alreadyCounted.add(id)
  }
  let noSmaHouseholds = 0
  let noSmaIndividuals = 0
  for (const site of noSma) {
    if (alreadyCounted.has(normalizeId(site.id))) continue
    noSmaHouseholds += amount(site.households)
    noSmaIndividuals += amount(site.individuals)
  }
  const exceptions = areaExceptionsInside(shapes, dots).filter((site) => !alreadyCounted.has(normalizeId(site.id)))
  let exceptionHouseholds = 0
  let exceptionIndividuals = 0
  for (const site of exceptions) {
    exceptionHouseholds += amount(site.households)
    exceptionIndividuals += amount(site.individuals)
  }
  return {
    verification: verification.length + promoted.length + exceptions.length,
    act: act.length,
    noSma: noSma.length,
    hhs: population.hhs + noSmaHouseholds + exceptionHouseholds,
    individuals: population.individuals + noSmaIndividuals + exceptionIndividuals,
  }
}

export function downloadAreaBoundaries(areas) {
  const features = (areas || [])
    .filter((area) => Array.isArray(area?.ring) && area.ring.length >= 3)
    .map((area) => ({
      type: 'Feature',
      properties: {
        id: area.id,
        name: area.name,
        neighborhood: area.parent,
        color: area.color,
        selected: area.featured === true,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [closedRing(area.ring)],
      },
    }))
  downloadJson('area-boundaries.geojson', { type: 'FeatureCollection', features })
}

function closedRing(ring) {
  const points = ring.map((pair) => [pair[0], pair[1]])
  const first = points[0]
  const last = points[points.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) points.push(first)
  return points
}

function populationCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value.replace(/,/g, ''))
    return Number.isFinite(number) ? number : ''
  }
  return ''
}

function drawnAreaFields(lat, lon, definedAreas) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return ['', '']
  const inside = (definedAreas || []).filter((area) => area?.ring && pointInRing(lat, lon, area.ring))
  const targeted = [...new Set(inside.map((area) => area.parent).filter(Boolean))]
  const names = inside.map((area) => area.name).filter(Boolean)
  return [targeted.join('; '), names.join('; ')]
}

const noSmaHeaders = [
  'Targeted area',
  'Drawn area',
  'Map neighborhood',
  'Dot latitude',
  'Dot longitude',
  'Site ID',
  'Site name',
  'Site name (Arabic)',
  'Neighborhood',
  'Governorate',
  'Status',
  'Partner',
  'Households',
  'Individuals',
]

function noSmaSheetRows(sites, definedAreas) {
  return [...(sites || [])]
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')))
    .map((site) => {
      const lat = Number(site.lat)
      const lon = Number(site.lon)
      const [targeted, drawn] = drawnAreaFields(lat, lon, definedAreas)
      return [
        targeted,
        drawn,
        mapNeighborhood(lat, lon),
        Number.isFinite(lat) ? lat : '',
        Number.isFinite(lon) ? lon : '',
        site.id || '',
        site.name || '',
        site.nameAr || '',
        site.neighborhood || '',
        site.governorate || '',
        site.status || '',
        site.partner || 'No SMA',
        populationCell(site.households),
        populationCell(site.individuals),
      ]
    })
}

export function downloadAreaWorkbook(name, areaRing, dots, noSmaSites, definedAreas) {
  const contents = areaContents(areaRing, dots)
  const counts = combinedAreaCounts([areaRing], dots, noSmaSites)
  const exceptions = areaExceptionsInside([areaRing], dots)
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
  const noSmaRows = noSmaSheetRows(noSmaInside([areaRing], noSmaSites), definedAreas)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['Area', name],
      ['Sites', counts.verification],
      ['ACT sites', counts.act],
      ['No SMA', counts.noSma],
      ['Households', counts.hhs],
      ['Individuals', counts.individuals],
      ...(exceptions.length ? [
        [],
        ['Included managed site', 'Site name', 'Site name (Arabic)', 'Partner', 'Households', 'Individuals', 'Latitude', 'Longitude'],
        ...exceptions.map((site) => [
          site.id,
          site.name || '',
          site.nameAr || '',
          site.partner || '',
          populationCell(site.households),
          populationCell(site.individuals),
          site.lat,
          site.lon,
        ]),
      ] : []),
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
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([noSmaHeaders, ...noSmaRows]),
    'No SMA',
  )
  const safe = String(name || 'area').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'area'
  XLSX.writeFile(book, `${safe}.xlsx`)
  return { verification: counts.verification, act: counts.act, noSma: counts.noSma }
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

export function downloadAllSitesWorkbook(definedAreas = [], dots, noSmaSites) {
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
  const noSmaRows = noSmaSheetRows(noSmaSites, definedAreas)
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([['Targeted area', 'Drawn area', 'Map neighborhood', 'Dot latitude', 'Dot longitude', ...act.headers], ...actRows]),
    'ACT sites',
  )
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([noSmaHeaders, ...noSmaRows]),
    'No SMA',
  )
  XLSX.writeFile(book, 'site-verification-and-act-sites.xlsx')
  return { verification: verificationRows.length, act: actRows.length, noSma: noSmaRows.length }
}
