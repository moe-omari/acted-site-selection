import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import catalog from './data/catalog.json'
import { listedAsPartner, partnerFor, partnerSearchParts, partnerSitesByOthers as partnerSites } from './lib/partners'
import { areaContents, areaPopulation, dotInside, downloadAllSitesWorkbook, downloadAreaWorkbook } from './lib/areas'
import { downloadCsv, haversineKm } from './lib/geo'
import { listActSites, actMapPoint, barePolygonDots, extentCenter, polygonSites, verificationCandidates } from './lib/sites'
import { listedAsManaged, managedLayerSites, usesCorrectedCoordinate } from './lib/managed-layer'

const extentDots = polygonSites(catalog)
const siteCatalog = {
  ...catalog,
  candidates: [...verificationCandidates(catalog), ...extentDots.candidates].filter((site) => !partnerFor(site.id)),
  managed: managedLayerSites(catalog.managed),
}

const AREAS_KEY = 'acted-cccm-areas-v1'
const POSITIONS_KEY = 'acted-site-positions-v1'
const CENTERED_KEY = 'acted-site-positions-centered-v1'
const AREA_COLORS = ['#c4554d', '#0f7b6c', '#d9730d', '#337ea9', '#9065b0', '#9c27b0', '#b3541e', '#2e7d32']
const AppState = createContext(null)

const areaOrder = new Map(catalog.areas.map((area, index) => [area.name, index]))
const actSites = listActSites()

function normalizeId(id) {
  return String(id ?? '').trim().toUpperCase()
}

const sitesAlreadyOnMap = new Set()
function rememberSite(id) {
  const key = normalizeId(id)
  if (key) sitesAlreadyOnMap.add(key)
}
for (const site of siteCatalog.candidates) rememberSite(site.id)
for (const site of siteCatalog.managed) rememberSite(site.id)
for (const site of actSites) {
  rememberSite(site.id)
  rememberSite(site['New Site ID'])
}

function partnerName(id) {
  return partnerFor(id)?.partner || ''
}

function addSiteDot(dots, id, point) {
  const key = String(id ?? '').trim().toUpperCase()
  if (!key || !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) return
  const list = dots.get(key)
  if (list) list.push(point)
  else dots.set(key, [point])
}

function countsFor(ring, dots) {
  const contents = areaContents(ring, dots)
  const population = areaPopulation(contents.verification, contents.act, ring, dots)
  return {
    verification: contents.verification.length,
    act: contents.act.length,
    hhs: population.hhs,
    individuals: population.individuals,
  }
}

function loadPositions() {
  try {
    const raw = JSON.parse(localStorage.getItem(POSITIONS_KEY) || 'null')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const next = {}
    for (const [key, value] of Object.entries(raw)) {
      if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lon))) continue
      next[key] = { lat: Number(value.lat), lon: Number(value.lon) }
    }
    return next
  } catch {
    return {}
  }
}

function nearestTarget(ring) {
  const lat = ring.reduce((sum, pair) => sum + pair[1], 0) / ring.length
  const lon = ring.reduce((sum, pair) => sum + pair[0], 0) / ring.length
  let best = catalog.areas[0]
  let bestDistance = Infinity
  for (const area of catalog.areas) {
    const distance = (area.lat - lat) ** 2 + (area.lon - lon) ** 2
    if (distance < bestDistance) {
      best = area
      bestDistance = distance
    }
  }
  return best.name
}

function normalizeDefinedAreas(raw) {
  if (!Array.isArray(raw)) return []
  const names = new Set(catalog.areas.map((area) => area.name))
  const featured = new Set()
  const areas = raw.filter((area) => (
    area
    && typeof area.id === 'string'
    && typeof area.name === 'string'
    && typeof area.color === 'string'
    && Array.isArray(area.ring)
    && area.ring.length >= 3
    && area.ring.every((pair) => Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
  )).map((area) => {
    const ring = area.ring.map((pair) => [pair[0], pair[1]])
    const parent = names.has(area.parent) ? area.parent : nearestTarget(ring)
    const showOnCard = area.featured === true && !featured.has(parent)
    if (showOnCard) featured.add(parent)
    return {
      id: area.id,
      name: area.name,
      color: area.color,
      ring,
      parent,
      featured: showOnCard,
      visible: area.visible !== false,
    }
  })
  const chosen = new Set(areas.filter((area) => area.featured).map((area) => area.parent))
  return areas.map((area) => {
    if (chosen.has(area.parent)) return area
    chosen.add(area.parent)
    return { ...area, featured: true }
  })
}

function defaultTargets() {
  const areas = {}
  for (const area of catalog.areas) {
    areas[area.name] = { individuals: area.targetIndividuals, hhs: area.targetHhs }
  }
  return {
    households: catalog.targets.households,
    individuals: catalog.targets.individuals,
    areas,
  }
}

function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function normalizeTargets(raw) {
  const base = defaultTargets()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const areas = { ...base.areas }
  for (const area of catalog.areas) {
    const saved = raw.areas?.[area.name]
    if (!saved || typeof saved !== 'object') continue
    areas[area.name] = {
      individuals: finiteNumber(saved.individuals, base.areas[area.name].individuals),
      hhs: finiteNumber(saved.hhs, base.areas[area.name].hhs),
    }
  }
  return {
    households: finiteNumber(raw.households, base.households),
    individuals: finiteNumber(raw.individuals, base.individuals),
    areas,
  }
}

function loadDefinedAreas() {
  try {
    return normalizeDefinedAreas(JSON.parse(localStorage.getItem(AREAS_KEY) || 'null'))
  } catch {
    return []
  }
}

function actAmount(site, key) {
  const value = Number(site[key])
  return Number.isFinite(value) ? value : 0
}

function actAreaName(site) {
  const place = String(site.Neighbourhood || '').trim().toLowerCase()
  if (!place) return ''
  const area = catalog.areas.find((item) => item.neighborhood.toLowerCase() === place || item.name.toLowerCase() === place)
  return area?.name || ''
}

function actMatches(site, needle, activeArea) {
  if (activeArea && actAreaName(site) !== activeArea.name) return false
  return matchesQuery(needle, [
    site['Site name'],
    site['Site name (Arabic)'],
    site['Alternative name'],
    site.id,
    site['New Site ID'],
    site.Neighbourhood,
    site.Governorate,
    ...partnerSearchParts(site.id),
    ...partnerSearchParts(site['New Site ID']),
  ])
}

function matchesQuery(query, parts) {
  if (!query) return true
  return parts.filter(Boolean).join(' ').toLowerCase().includes(query)
}

export function AppStateProvider({ children }) {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('plan')
  const [areaFilter, setAreaFilter] = useState('all')
  const [layers, setLayers] = useState({
    plan: true,
    other: true,
    coverage: true,
    blocks: false,
    neighborhoods: true,
    extents: true,
    unlinkedExtents: true,
    managedExtents: true,
    managed: true,
    partners: false,
    act: true,
    crcs: true,
    aisha: true,
  })
  const [focus, setFocus] = useState(null)
  const [hover, setHover] = useState(null)
  const [positions, setPositions] = useState(loadPositions)
  const [offsetsReady, setOffsetsReady] = useState(() => {
    try {
      return localStorage.getItem(CENTERED_KEY) === '1'
    } catch {
      return false
    }
  })
  const [definedAreas, setDefinedAreas] = useState([])
  const [areasReady, setAreasReady] = useState(false)
  const [targets, setTargets] = useState(defaultTargets)
  const [targetsReady, setTargetsReady] = useState(false)
  const [draft, setDraft] = useState(null)
  const [drawingParent, setDrawingParent] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editPoints, setEditPoints] = useState(null)
  const [compareTarget, setCompareTarget] = useState(null)
  const [detailAreaId, setDetailAreaId] = useState(null)
  const [measuring, setMeasuring] = useState(false)
  const [measurePoints, setMeasurePoints] = useState([])
  const [namingId, setNamingId] = useState(null)
  const draftRef = useRef(null)
  const editingRef = useRef(null)
  const editPointsRef = useRef(null)
  const areasTouched = useRef(false)

  useEffect(() => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions))
  }, [positions])

  useEffect(() => {
    if (offsetsReady) return undefined
    setPositions((current) => {
      const next = {}
      for (const [key, value] of Object.entries(current)) {
        const colon = key.indexOf(':')
        const type = key.slice(0, colon)
        const id = key.slice(colon + 1)
        if ((type === 'candidate' || type === 'managed' || type === 'act') && extentCenter(id)) continue
        next[key] = value
      }
      return next
    })
    try {
      localStorage.setItem(CENTERED_KEY, '1')
    } catch {
      // The map still centers for this visit when storage is unavailable.
    }
    setOffsetsReady(true)
    return undefined
  }, [offsetsReady])

  useEffect(() => {
    let cancel = false
    async function load() {
      let areas = null
      try {
        const response = await fetch('/defined-areas.json', { cache: 'no-store' })
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data)) areas = normalizeDefinedAreas(data)
        }
      } catch {
        areas = null
      }
      if (areas == null) areas = loadDefinedAreas()
      if (cancel || areasTouched.current) return
      setDefinedAreas(areas)
      setAreasReady(true)
    }
    load()
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    let cancel = false
    async function load() {
      try {
        const response = await fetch('/targets.json', { cache: 'no-store' })
        if (response.ok && !cancel) setTargets(normalizeTargets(await response.json()))
      } catch {
        /* workbook targets stay in place */
      }
      if (!cancel) setTargetsReady(true)
    }
    load()
    return () => { cancel = true }
  }, [])

  useEffect(() => {
    if (!targetsReady) return undefined
    const timer = setTimeout(() => {
      fetch('/api/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targets),
      }).catch(() => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [targets, targetsReady])

  const setPlanTarget = useCallback((patch) => {
    setTargets((current) => ({ ...current, ...patch }))
  }, [])

  const setAreaTarget = useCallback((name, patch) => {
    setTargets((current) => ({
      ...current,
      areas: {
        ...current.areas,
        [name]: { ...current.areas[name], ...patch },
      },
    }))
  }, [])

  const changeDefinedAreas = useCallback((updater) => {
    areasTouched.current = true
    setAreasReady(true)
    setDefinedAreas(updater)
  }, [])

  useEffect(() => {
    if (!areasReady || !areasTouched.current) return undefined
    const timer = setTimeout(() => {
      fetch('/api/defined-areas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definedAreas),
      }).catch(() => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [definedAreas, areasReady])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      if (draftRef.current) {
        draftRef.current = null
        setDraft(null)
        setDrawingParent(null)
        return
      }
      if (editingRef.current) {
        editingRef.current = null
        editPointsRef.current = null
        setEditPoints(null)
        setEditingId(null)
        return
      }
      if (measuring || measurePoints.length) {
        setMeasuring(false)
        setMeasurePoints([])
        return
      }
      if (compareTarget || detailAreaId) {
        setCompareTarget(null)
        setDetailAreaId(null)
        return
      }
      setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compareTarget, detailAreaId, measurePoints.length, measuring])

  const selectArea = useCallback((name) => {
    setAreaFilter((current) => (current === name ? 'all' : name))
  }, [])

  const toggleLayer = useCallback((key) => {
    setLayers((current) => ({ ...current, [key]: !current[key] }))
  }, [])

  const placed = useCallback((type, id, lat, lon) => {
    const center = (type === 'candidate' || type === 'managed' || type === 'act') && !usesCorrectedCoordinate(type, id)
      ? extentCenter(id)
      : null
    const saved = positions[`${type}:${id}`]
    if (center && !offsetsReady) return center
    if (saved) return saved
    if (center) return center
    return { lat, lon }
  }, [offsetsReady, positions])

  const moveSite = useCallback((type, id, lat, lon) => {
    setPositions((current) => ({
      ...current,
      [`${type}:${id}`]: { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) },
    }))
  }, [])

  const areaByName = useMemo(
    () => Object.fromEntries(catalog.areas.map((area) => [area.name, area])),
    [],
  )

  const siteDots = useMemo(() => {
    const dots = new Map()
    for (const site of siteCatalog.candidates) addSiteDot(dots, site.id, placed('candidate', site.id, site.lat, site.lon))
    for (const site of siteCatalog.managed) addSiteDot(dots, site.id, placed('managed', site.id, site.lat, site.lon))
    for (const site of actSites) {
      const point = actMapPoint(site)
      if (!point) continue
      const here = placed('act', site.id, point.lat, point.lon)
      addSiteDot(dots, site.id, here)
      addSiteDot(dots, site['New Site ID'], here)
    }
    for (const dot of barePolygonDots(siteCatalog)) {
      addSiteDot(dots, dot.id, placed(dot.type, dot.key, dot.lat, dot.lon))
    }
    return dots
  }, [placed])

  const plan = useMemo(() => {
    const ids = new Set()
    for (const area of definedAreas) {
      if (!area.featured) continue
      for (const site of siteCatalog.candidates) {
        if (listedAsManaged([site.id]) || listedAsPartner([site.id])) continue
        if (dotInside([site.id], area.ring, siteDots)) ids.add(site.id)
      }
      for (const site of actSites) {
        const keys = [site.id, site['New Site ID']].filter(Boolean)
        if (listedAsManaged(keys) || listedAsPartner(keys)) continue
        if (dotInside(keys, area.ring, siteDots)) ids.add(site.id)
      }
    }
    return ids
  }, [definedAreas, siteDots])

  const stats = useMemo(() => {
    const byArea = Object.fromEntries(
      catalog.areas.map((area) => [area.name, { sites: 0, hhs: 0, individuals: 0, radiusKm: 0 }]),
    )
    const seen = new Set()
    let sites = 0
    let hhs = 0
    let individuals = 0
    for (const area of definedAreas) {
      if (!area.featured) continue
      const bucket = byArea[area.parent]
      const anchor = areaByName[area.parent]
      for (const site of siteCatalog.candidates) {
        if (listedAsManaged([site.id]) || listedAsPartner([site.id])) continue
        const here = placed('candidate', site.id, site.lat, site.lon)
        if (!dotInside([site.id], area.ring, siteDots)) continue
        if (bucket) {
          bucket.sites += 1
          bucket.hhs += site.hhs
          bucket.individuals += site.individuals
          if (anchor) bucket.radiusKm = Math.max(bucket.radiusKm, haversineKm(here.lat, here.lon, anchor.lat, anchor.lon))
        }
        if (seen.has(`candidate:${site.id}`)) continue
        seen.add(`candidate:${site.id}`)
        sites += 1
        hhs += site.hhs
        individuals += site.individuals
      }
      for (const site of actSites) {
        const keys = [site.id, site['New Site ID']].filter(Boolean)
        if (listedAsManaged(keys) || listedAsPartner(keys)) continue
        if (!dotInside(keys, area.ring, siteDots)) continue
        const households = actAmount(site, 'Households')
        const people = actAmount(site, 'Individuals')
        if (bucket) {
          bucket.sites += 1
          bucket.hhs += households
          bucket.individuals += people
        }
        if (seen.has(`act:${site.id}`)) continue
        seen.add(`act:${site.id}`)
        sites += 1
        hhs += households
        individuals += people
      }
    }
    return { sites, hhs, individuals, byArea }
  }, [areaByName, definedAreas, placed, siteDots])

  const overlaps = useMemo(() => {
    const managedIds = new Set()
    const candidateIds = new Set()
    const managedById = new Set(catalog.managed.map((site) => site.id))
    for (const site of siteCatalog.candidates) {
      if (!managedById.has(site.id)) continue
      managedIds.add(site.id)
      candidateIds.add(site.id)
    }
    return { managedIds, candidateIds }
  }, [])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const searching = needle.length > 0
    const activeArea = searching || areaFilter === 'all' ? null : areaByName[areaFilter]

    const candidates = siteCatalog.candidates
      .filter((site) => {
        if (!searching && scope === 'plan' && !plan.has(site.id)) return false
        if (activeArea && site.area !== activeArea.name) return false
        return matchesQuery(needle, [site.name, site.id, site.neighborhood, site.area, ...partnerSearchParts(site.id)])
      })
      .sort((a, b) => areaOrder.get(a.area) - areaOrder.get(b.area) || a.rank - b.rank)
      .map((site) => ({
        type: 'candidate',
        id: site.id,
        title: site.name,
        subtitle: [searching ? 'Candidate' : '', site.id, site.neighborhood, partnerName(site.id)].filter(Boolean).join(' · '),
        meta: `${site.hhs.toLocaleString('en-US')} HH`,
        color: areaByName[site.area]?.color ?? '#337ea9',
        inPlan: plan.has(site.id),
      }))

    const actRows = actSites
      .filter((site) => {
        if (!searching && scope === 'plan' && !plan.has(site.id)) return false
        return actMatches(site, needle, activeArea)
      })
      .map((site) => ({
        type: 'act',
        id: site.id,
        title: site['Site name'] || site.id,
        subtitle: [searching ? 'ACT' : '', site.id, site.Neighbourhood, partnerName(site.id) || partnerName(site['New Site ID'])].filter(Boolean).join(' · '),
        meta: actAmount(site, 'Households') ? `${actAmount(site, 'Households').toLocaleString('en-US')} HH` : '',
        color: '#3949ab',
      }))

    const managed = siteCatalog.managed
      .filter((site) => {
        if (activeArea) {
          const named = site.place && site.place.toLowerCase() === activeArea.neighborhood.toLowerCase()
          const here = placed('managed', site.id, site.lat, site.lon)
          const near = haversineKm(here.lat, here.lon, activeArea.lat, activeArea.lon) <= 3
          if (!named && !near) return false
        }
        return matchesQuery(needle, [site.name, site.nameAr, site.id, site.place, site.governorate, ...partnerSearchParts(site.id)])
      })
      .sort((a, b) => a.governorate.localeCompare(b.governorate) || a.name.localeCompare(b.name))
      .map((site) => ({
        type: 'managed',
        id: site.id,
        title: site.name,
        subtitle: [searching ? 'Managed' : '', site.id, site.place, partnerName(site.id)].filter(Boolean).join(' · '),
        meta: site.governorate,
        color: '#0f7b6c',
      }))

    const aisha = catalog.aisha
      .filter((site) => {
        if (activeArea && haversineKm(site.lat, site.lon, activeArea.lat, activeArea.lon) > 6) return false
        return matchesQuery(needle, [site.address, site.governorate, site.donor, site.id, site.focalPoint])
      })
      .map((site) => ({
        type: 'aisha',
        id: site.id,
        title: site.address,
        subtitle: [searching ? 'Aisha' : '', site.governorate, site.status].filter(Boolean).join(' · '),
        meta: site.donor,
        color: '#9065b0',
      }))

    const crcs = catalog.crcs
      .filter((site) => {
        if (activeArea && site.region !== activeArea.crc) return false
        return matchesQuery(needle, [site.name, site.region])
      })
      .map((site) => ({
        type: 'crc',
        id: site.id,
        title: site.name,
        subtitle: searching ? 'CRC · Community resource centre' : 'Community resource centre',
        meta: site.region,
        color: '#d9730d',
      }))

    const partners = searching ? partnerSites
      .filter((site) => !sitesAlreadyOnMap.has(normalizeId(site.key)))
      .filter((site) => matchesQuery(needle, [site.name, site.nameAr, site.id, site.partner, site.governorate, site.neighborhood]))
      .map((site) => ({
        type: 'partner',
        id: site.key,
        title: site.name || site.id,
        subtitle: [searching ? 'Managed by partners' : '', site.id, site.partner].filter(Boolean).join(' · '),
        meta: site.partner,
        color: '#0e7490',
      })) : []

    if (searching) return [...candidates, ...actRows, ...managed, ...partners, ...aisha, ...crcs]
    if (scope === 'managed') return managed
    if (scope === 'aisha') return aisha
    if (scope === 'crcs') return crcs
    if (scope === 'act') return actRows
    if (scope === 'plan') return [...candidates, ...actRows]
    return candidates
  }, [areaByName, areaFilter, placed, plan, query, scope])

  const counts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const searching = needle.length > 0
    const activeArea = searching || areaFilter === 'all' ? null : areaByName[areaFilter]
    return {
      plan: siteCatalog.candidates.filter((site) => plan.has(site.id) && (!activeArea || site.area === activeArea.name) && matchesQuery(needle, [site.name, site.id, site.neighborhood, site.area, ...partnerSearchParts(site.id)])).length
        + actSites.filter((site) => plan.has(site.id) && actMatches(site, needle, activeArea)).length,
      candidates: siteCatalog.candidates.filter((site) => (!activeArea || site.area === activeArea.name) && matchesQuery(needle, [site.name, site.id, site.neighborhood, site.area, ...partnerSearchParts(site.id)])).length,
      act: actSites.filter((site) => actMatches(site, needle, activeArea)).length,
      managed: siteCatalog.managed.filter((site) => {
        if (activeArea) {
          const named = site.place && site.place.toLowerCase() === activeArea.neighborhood.toLowerCase()
          const here = placed('managed', site.id, site.lat, site.lon)
          const near = haversineKm(here.lat, here.lon, activeArea.lat, activeArea.lon) <= 3
          if (!named && !near) return false
        }
        return matchesQuery(needle, [site.name, site.nameAr, site.id, site.place, site.governorate, ...partnerSearchParts(site.id)])
      }).length,
      aisha: catalog.aisha.filter((site) => {
        if (activeArea && haversineKm(site.lat, site.lon, activeArea.lat, activeArea.lon) > 6) return false
        return matchesQuery(needle, [site.address, site.governorate, site.donor, site.id, site.focalPoint])
      }).length,
      crcs: catalog.crcs.filter((site) => (!activeArea || site.region === activeArea.crc) && matchesQuery(needle, [site.name, site.region])).length,
    }
  }, [areaByName, areaFilter, placed, plan, query])

  const draftCounts = useMemo(() => {
    if (!draft || draft.length < 3) return null
    return countsFor(draft.map(([lat, lon]) => [lon, lat]), siteDots)
  }, [draft, siteDots])

  const editCounts = useMemo(() => {
    if (!editPoints || editPoints.length < 3) return null
    return countsFor(editPoints.map(([lat, lon]) => [lon, lat]), siteDots)
  }, [editPoints, siteDots])

  const areaCounts = useMemo(() => {
    const counts = {}
    for (const area of definedAreas) counts[area.id] = countsFor(area.ring, siteDots)
    return counts
  }, [definedAreas, siteDots])

  const startDraw = useCallback((parent) => {
    editingRef.current = null
    editPointsRef.current = null
    setEditingId(null)
    setEditPoints(null)
    draftRef.current = []
    setDraft([])
    setDrawingParent(parent)
    setNamingId(null)
    setMeasuring(false)
  }, [])

  const startEdit = useCallback((id) => {
    if (draftRef.current) return
    const area = definedAreas.find((item) => item.id === id)
    if (!area) return
    const points = area.ring.map(([lon, lat]) => [lat, lon])
    editingRef.current = id
    editPointsRef.current = points
    setEditingId(id)
    setEditPoints(points)
    setMeasuring(false)
    setMeasurePoints([])
    setNamingId(null)
  }, [definedAreas])

  const updateEditPoints = useCallback((points) => {
    const next = points.map(([lat, lon]) => [lat, lon])
    editPointsRef.current = next
    setEditPoints(next)
  }, [])

  const cancelEdit = useCallback(() => {
    editingRef.current = null
    editPointsRef.current = null
    setEditingId(null)
    setEditPoints(null)
  }, [])

  const finishEdit = useCallback(() => {
    const id = editingRef.current
    const points = editPointsRef.current
    if (!id || !points || points.length < 3) return
    const ring = points.map(([lat, lon]) => [lon, lat])
    changeDefinedAreas((current) => current.map((area) => (area.id === id ? { ...area, ring } : area)))
    editingRef.current = null
    editPointsRef.current = null
    setEditingId(null)
    setEditPoints(null)
  }, [])

  const openArea = useCallback((id) => {
    setCompareTarget(null)
    setDetailAreaId(id)
  }, [])

  const openCompare = useCallback((name) => {
    setDetailAreaId(null)
    setCompareTarget(name)
  }, [])

  const addMeasurePoint = useCallback((latlng) => {
    setMeasurePoints((current) => [...current, [latlng.lat, latlng.lng]])
  }, [])

  const clearMeasure = useCallback(() => {
    setMeasuring(false)
    setMeasurePoints([])
  }, [])

  const addDraftPoint = useCallback((latlng) => {
    setDraft((current) => {
      if (!current) return current
      const next = [...current, [latlng.lat, latlng.lng]]
      draftRef.current = next
      return next
    })
  }, [])

  const cancelDraw = useCallback(() => {
    draftRef.current = null
    setDraft(null)
    setDrawingParent(null)
  }, [])

  const finishDraw = useCallback(() => {
    const points = draftRef.current
    if (!points || points.length < 3 || !drawingParent) return
    const id = `area-${Date.now()}`
    changeDefinedAreas((current) => {
      const siblings = current.filter((area) => area.parent === drawingParent)
      return [
        ...current,
        {
          id,
          name: `Area ${siblings.length + 1}`,
          color: AREA_COLORS[current.length % AREA_COLORS.length],
          parent: drawingParent,
          ring: points.map(([lat, lon]) => [lon, lat]),
          visible: true,
          featured: !siblings.some((area) => area.featured),
        },
      ]
    })
    setNamingId(id)
    draftRef.current = null
    setDraft(null)
    setDrawingParent(null)
  }, [drawingParent])

  const renameArea = useCallback((id, name) => {
    changeDefinedAreas((current) => current.map((area) => (area.id === id ? { ...area, name } : area)))
  }, [])

  const setAreaColor = useCallback((id, color) => {
    changeDefinedAreas((current) => current.map((area) => (area.id === id ? { ...area, color } : area)))
  }, [])

  const toggleDefinedArea = useCallback((id) => {
    changeDefinedAreas((current) => current.map((area) => (area.id === id ? { ...area, visible: !area.visible } : area)))
  }, [])

  const deleteArea = useCallback((id) => {
    if (editingRef.current === id) {
      editingRef.current = null
      editPointsRef.current = null
      setEditingId(null)
      setEditPoints(null)
    }
    changeDefinedAreas((current) => {
      const removed = current.find((area) => area.id === id)
      const next = current.filter((area) => area.id !== id)
      if (!removed?.featured) return next
      const replacement = next.find((area) => area.parent === removed.parent)
      if (!replacement) return next
      return next.map((area) => (area.id === replacement.id ? { ...area, featured: true } : area))
    })
    setNamingId((current) => (current === id ? null : current))
  }, [])

  const featureArea = useCallback((id) => {
    changeDefinedAreas((current) => {
      const area = current.find((item) => item.id === id)
      if (!area || area.featured) return current
      return current.map((item) => {
        if (item.parent !== area.parent) return item
        return { ...item, featured: item.id === id }
      })
    })
  }, [])

  const exportApproved = useCallback(() => {
    downloadAllSitesWorkbook(definedAreas, siteDots)
  }, [definedAreas, siteDots])

  const exportDefinedArea = useCallback((id) => {
    const area = definedAreas.find((item) => item.id === id)
    if (!area) return
    downloadAreaWorkbook(area.name.trim() || 'Area', area.ring, siteDots)
  }, [definedAreas, siteDots])

  const exportPlan = useCallback(() => {
    const header = ['Area', 'Site ID', 'Site name', 'Neighborhood', 'Households', 'Individuals', 'Latitude', 'Longitude', 'Distance to CRC (km)', 'Rank', 'Workbook selection']
    const body = siteCatalog.candidates
      .filter((site) => plan.has(site.id))
      .sort((a, b) => areaOrder.get(a.area) - areaOrder.get(b.area) || a.rank - b.rank)
      .map((site) => [
        site.area,
        site.id,
        site.name,
        site.neighborhood,
        site.hhs,
        site.individuals,
        placed('candidate', site.id, site.lat, site.lon).lat,
        placed('candidate', site.id, site.lat, site.lon).lon,
        site.distanceCrcKm,
        site.rank,
        site.workbookSelected ? 'Yes' : 'No',
      ])
    const actBody = actSites
      .filter((site) => plan.has(site.id))
      .map((site) => {
        const point = actMapPoint(site)
        const here = point ? placed('act', site.id, point.lat, point.lon) : null
        return [
          actAreaName(site) || 'ACT',
          site.id,
          site['Site name'] || '',
          site.Neighbourhood || '',
          actAmount(site, 'Households'),
          actAmount(site, 'Individuals'),
          here?.lat ?? '',
          here?.lon ?? '',
          '',
          '',
          'ACT site',
        ]
      })
    downloadCsv('acted-site-selection.csv', [header, ...body, ...actBody])
  }, [placed, plan])

  const value = {
    catalog: siteCatalog,
    query,
    setQuery,
    scope,
    setScope,
    areaFilter,
    selectArea,
    layers,
    toggleLayer,
    focus,
    setFocus,
    hover,
    setHover,
    plan,
    placed,
    moveSite,
    stats,
    rows,
    counts,
    overlaps,
    areaByName,
    exportPlan,
    definedAreas,
    siteDots,
    targets,
    setPlanTarget,
    setAreaTarget,
    draft,
    drawingParent,
    draftCounts,
    editingId,
    editPoints,
    editCounts,
    startEdit,
    updateEditPoints,
    cancelEdit,
    finishEdit,
    namingId,
    setNamingId,
    areaCounts,
    compareTarget,
    setCompareTarget,
    detailAreaId,
    setDetailAreaId,
    openArea,
    openCompare,
    measuring,
    setMeasuring,
    measurePoints,
    addMeasurePoint,
    clearMeasure,
    startDraw,
    addDraftPoint,
    cancelDraw,
    finishDraw,
    renameArea,
    setAreaColor,
    areaColors: AREA_COLORS,
    toggleDefinedArea,
    deleteArea,
    featureArea,
    exportDefinedArea,
    exportApproved,
  }

  return <AppState.Provider value={value}>{children}</AppState.Provider>
}

export function useAppState() {
  const value = useContext(AppState)
  if (!value) throw new Error('useAppState must be used within AppStateProvider')
  return value
}
