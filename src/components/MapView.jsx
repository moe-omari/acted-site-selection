import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  ScaleControl,
  TileLayer,
  Tooltip,
  ZoomControl,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
import blocks from '../data/blocks.json'
import extents from '../data/extents.json'
import managedSiteExtents from '../data/managed-extents.json'
import neighborhoods from '../data/neighborhoods.json'
import { partnerFor, partnerSitesByOthers as partnerSites } from '../lib/partners'
import { siteForExtent, actRecord, actMapSites, barePolygonDots, unlinkedExtents } from '../lib/sites'
import { useAppState } from '../state'
import { haversineKm } from '../lib/geo'
import { formatCount, formatKm, formatNumber } from '../lib/format'

const iconCache = new Map()

function circleIcon(color, filled, active, shape = 'circle') {
  const key = `${color}-${filled ? 'fill' : 'hole'}-${active ? 'on' : 'off'}-${shape}`
  if (!iconCache.has(key)) {
    const size = active ? 16 : 12
    const weight = active ? 2.5 : 1.6
    const radius = shape === 'square' ? '2px' : '99px'
    iconCache.set(
      key,
      L.divIcon({
        className: 'pin',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<span class="dot-shape${active ? ' is-active' : ''}" style="width:${size}px;height:${size}px;border-radius:${radius};background:${filled ? color : '#fff'};border:${weight}px solid ${filled ? '#fff' : color}"></span>`,
      }),
    )
  }
  return iconCache.get(key)
}

function markerIcon(kind, active) {
  const key = `${kind}-${active ? 'on' : 'off'}`
  if (!iconCache.has(key)) {
    const size = active ? 16 : 12
    iconCache.set(
      key,
      L.divIcon({
        className: 'pin',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<span class="pin-shape ${kind}${active ? ' is-active' : ''}" style="width:${size}px;height:${size}px"></span>`,
      }),
    )
  }
  return iconCache.get(key)
}

function candidateVisible(site, layers, plan, areaFilter) {
  if (areaFilter !== 'all' && site.area !== areaFilter) return false
  return plan.has(site.id) ? layers.plan : layers.other
}

function FitView({ points, watch }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lon]))
    map.fitBounds(bounds, {
      paddingTopLeft: [28, 28],
      paddingBottomRight: [28, 36],
      maxZoom: 15,
      animate: true,
    })
  }, [watch, map])
  return null
}

function FlyTo({ lat, lon, token }) {
  const map = useMap()
  useEffect(() => {
    if (!token || lat == null || lon == null) return
    map.flyTo([lat, lon], Math.max(map.getZoom(), 16), { duration: 0.45 })
  }, [token, lat, lon, map])
  return null
}

function EnsurePanes() {
  const map = useMap()
  if (!map.getPane('neighborhoods')) {
    const pane = map.createPane('neighborhoods')
    pane.style.zIndex = '340'
  }
  if (!map.getPane('blocks')) {
    const pane = map.createPane('blocks')
    pane.style.zIndex = '355'
  }
  if (!map.getPane('extents')) {
    const pane = map.createPane('extents')
    pane.style.zIndex = '365'
  }
  if (!map.getPane('managedExtents')) {
    const pane = map.createPane('managedExtents')
    pane.style.zIndex = '368'
  }
  if (!map.getPane('unlinkedExtents')) {
    const pane = map.createPane('unlinkedExtents')
    pane.style.zIndex = '372'
  }
  if (!map.getPane('coverage')) {
    const pane = map.createPane('coverage')
    pane.style.zIndex = '375'
    pane.style.pointerEvents = 'none'
  }
  if (!map.getPane('areas')) {
    const pane = map.createPane('areas')
    pane.style.zIndex = '380'
    pane.style.pointerEvents = 'none'
  }
  if (!map.getPane('sites')) {
    const pane = map.createPane('sites')
    pane.style.zIndex = '450'
  }
  return null
}

function vertexIcon(color, mid) {
  const size = mid ? 9 : 14
  return L.divIcon({
    className: mid ? 'area-handle is-mid' : 'area-handle',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span class="area-handle-shape${mid ? ' is-mid' : ''}" style="width:${size}px;height:${size}px;background:${mid ? '#fff' : color};border-color:${color}"></span>`,
  })
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

function AreaEditor({ area, points, summary, onChange }) {
  const map = useMap()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const current = points.map((point) => [point[0], point[1]])
    const polygon = L.polygon(current, {
      pane: 'areas',
      interactive: false,
      color: area.color,
      weight: 2.5,
      fillColor: area.color,
      fillOpacity: 0.18,
      areaEdit: true,
    }).addTo(map)
    polygon.bindTooltip(
      `<strong>${area.featured ? '<span class="area-check" aria-label="Selected">✓</span>' : ''}${escapeHtml(area.name)}</strong><span>${escapeHtml(summary)}</span>`,
      {
      permanent: true,
      direction: 'center',
      className: 'area-label',
      opacity: 1,
    })
    const handles = []
    const wasDoubleClick = map.doubleClickZoom.enabled()
    map.doubleClickZoom.disable()

    const placeMids = () => {
      for (let index = 0; index < current.length; index += 1) {
        const next = current[(index + 1) % current.length]
        handles[current.length + index].setLatLng([
          (current[index][0] + next[0]) / 2,
          (current[index][1] + next[1]) / 2,
        ])
      }
    }

    current.forEach((point, index) => {
      const marker = L.marker(point, {
        draggable: true,
        icon: vertexIcon(area.color, false),
        zIndexOffset: 900,
        keyboard: false,
      })
      marker.on('drag', () => {
        const next = marker.getLatLng()
        current[index] = [next.lat, next.lng]
        polygon.setLatLngs(current)
        placeMids()
      })
      marker.on('dragend', () => {
        onChangeRef.current(current.map((pair) => [pair[0], pair[1]]))
      })
      marker.on('dblclick', (event) => {
        L.DomEvent.stop(event)
        if (current.length <= 3) return
        onChangeRef.current(current.filter((_, item) => item !== index))
      })
      marker.addTo(map)
      handles.push(marker)
    })

    current.forEach((point, index) => {
      const next = current[(index + 1) % current.length]
      const marker = L.marker([(point[0] + next[0]) / 2, (point[1] + next[1]) / 2], {
        icon: vertexIcon(area.color, true),
        zIndexOffset: 800,
        keyboard: false,
      })
      marker.on('click', (event) => {
        L.DomEvent.stop(event)
        const spot = marker.getLatLng()
        const nextPoints = current.map((pair) => [pair[0], pair[1]])
        nextPoints.splice(index + 1, 0, [spot.lat, spot.lng])
        onChangeRef.current(nextPoints)
      })
      marker.addTo(map)
      handles.push(marker)
    })

    return () => {
      polygon.remove()
      handles.forEach((marker) => marker.remove())
      if (wasDoubleClick) map.doubleClickZoom.enable()
    }
  }, [map, area.id, area.name, area.color, points, summary])

  return null
}

function DrawSurface({ active, onPoint, onFinish }) {
  const map = useMap()
  const pointRef = useRef(onPoint)
  const finishRef = useRef(onFinish)
  pointRef.current = onPoint
  finishRef.current = onFinish

  useEffect(() => {
    if (!active) return undefined
    const surface = document.createElement('div')
    surface.className = 'draw-surface'
    map.getContainer().appendChild(surface)
    map.doubleClickZoom.disable()
    let origin = null
    let moved = false

    const down = (event) => {
      moved = false
      origin = { x: event.clientX, y: event.clientY }
      surface.setPointerCapture(event.pointerId)
    }
    const move = (event) => {
      if (!origin || event.buttons !== 1) return
      const dx = event.clientX - origin.x
      const dy = event.clientY - origin.y
      if (Math.hypot(dx, dy) > 4) moved = true
      if (!moved) return
      map.panBy([origin.x - event.clientX, origin.y - event.clientY], { animate: false })
      origin = { x: event.clientX, y: event.clientY }
    }
    const up = () => {
      origin = null
    }
    const click = (event) => {
      if (moved) {
        moved = false
        return
      }
      if (event.detail > 1) return
      const rect = map.getContainer().getBoundingClientRect()
      pointRef.current(map.containerPointToLatLng([event.clientX - rect.left, event.clientY - rect.top]))
    }
    const finish = (event) => {
      event.preventDefault()
      event.stopPropagation()
      finishRef.current()
    }
    surface.addEventListener('pointerdown', down)
    surface.addEventListener('pointermove', move)
    surface.addEventListener('pointerup', up)
    surface.addEventListener('click', click)
    surface.addEventListener('dblclick', finish)
    return () => {
      surface.remove()
      map.doubleClickZoom.enable()
    }
  }, [active, map])
  return null
}

function Invalidate({ open }) {
  const map = useMap()
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 180)
    return () => clearTimeout(timer)
  }, [open, map])
  return null
}

export default function MapView() {
  const {
    catalog,
    layers,
    plan,
    areaFilter,
    focus,
    setFocus,
    hover,
    overlaps,
    areaByName,
    definedAreas,
    draft,
    drawingParent,
    draftCounts,
    editingId,
    editPoints,
    editCounts,
    updateEditPoints,
    areaCounts,
    addDraftPoint,
    finishDraw,
    placed,
    moveSite,
    openArea,
    measuring,
    setMeasuring,
    measurePoints,
    addMeasurePoint,
    clearMeasure,
  } = useAppState()

  const activeArea = areaFilter === 'all' ? null : areaByName[areaFilter]
  const focusKey = focus ? `${focus.type}:${focus.id}` : ''
  const unlinkedExtentData = useMemo(() => unlinkedExtents(catalog), [catalog])
  const bareDots = useMemo(() => barePolygonDots(catalog), [catalog])
  const hoverKey = hover ? `${hover.type}:${hover.id}` : ''

  const visibleCandidates = catalog.candidates.filter((site) => candidateVisible(site, layers, plan, areaFilter))
  const renderedCandidateIds = new Set(visibleCandidates.map((site) => site.id))

  const managedHidden = new Set()
  if (layers.plan || layers.other) {
    for (const site of catalog.candidates) {
      if (renderedCandidateIds.has(site.id) && overlaps.managedIds.has(site.id)) managedHidden.add(site.id)
    }
  }

  const sitesAlreadyOnMap = new Set()
  for (const site of catalog.candidates) sitesAlreadyOnMap.add(String(site.id).toUpperCase())
  for (const site of catalog.managed) sitesAlreadyOnMap.add(String(site.id).toUpperCase())
  for (const site of actMapSites()) sitesAlreadyOnMap.add(String(site.id).toUpperCase())

  const fitPoints = []
  if (activeArea) {
    catalog.candidates.filter((site) => site.area === activeArea.name).forEach((site) => fitPoints.push(site))
    fitPoints.push(activeArea)
  } else {
    catalog.areas.forEach((area) => fitPoints.push(area))
    catalog.candidates.forEach((site) => fitPoints.push(site))
    if (layers.managed) catalog.managed.forEach((site) => fitPoints.push(site))
  }

  const focused = resolveFocus(catalog, focus, placed)
  const focusedCrc = focused?.type === 'candidate'
    ? catalog.crcs.find((crc) => crc.region === areaByName[focused.area]?.crc)
    : null

  const onBlock = useCallback((feature, layer) => {
    const { id, name, governorate } = feature.properties
    layer.bindTooltip(governorate ? `${name} · ${governorate}` : String(name), {
      className: 'site-tip',
      sticky: true,
      opacity: 1,
    })
    layer.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      layer._path?.blur()
      setFocus({ type: 'block', id, source: 'map' })
    })
  }, [setFocus])

  const blockStyle = useCallback((feature) => {
    const selected = focus?.type === 'block' && focus.id === feature.properties.id
    return {
      color: selected ? '#6a1b9a' : '#9C27B0',
      weight: selected ? 2 : 1,
      fillColor: '#9C27B0',
      fillOpacity: selected ? 0.32 : 0.16,
    }
  }, [focus])

  const onNeighborhood = useCallback((feature, layer) => {
    const { name, governorate } = feature.properties
    layer.bindTooltip(governorate ? `${name} · ${governorate}` : String(name), {
      className: 'site-tip',
      sticky: true,
      opacity: 1,
    })
    layer.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      layer._path?.blur()
    })
  }, [])

  const extentLayers = useRef(new Map())
  const managedExtentLayers = useRef(new Map())

  const onExtent = useCallback((feature, layer) => {
    const { id, code, name } = feature.properties
    extentLayers.current.set(id, layer)
    layer.bindTooltip(name && name !== code ? `${code} · ${name}` : String(code || name), {
      className: 'site-tip',
      sticky: true,
      opacity: 1,
    })
    layer.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      layer._path?.blur()
      const codes = [code, feature.properties.actCode]
      const site = codes.map((item) => siteForExtent(catalog, item)).find(Boolean)
      if (site) {
        setFocus({ ...site, source: 'map' })
        return
      }
      const act = actRecord(codes)
      setFocus(act ? { type: 'act', id: act.id, extentId: id, source: 'map' } : { type: 'extent', id, source: 'map' })
    })
  }, [catalog, setFocus])

  const onManagedExtent = useCallback((feature, layer) => {
    const { id, code, name, households } = feature.properties
    managedExtentLayers.current.set(id, layer)
    const title = name && name !== code ? (code ? `${code} · ${name}` : name) : String(code || name || 'Managed extent')
    layer.bindTooltip(households != null ? `${title} · ${formatCount(households)} HH` : title, {
      className: 'site-tip',
      sticky: true,
      opacity: 1,
    })
    layer.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      layer._path?.blur()
      const site = siteForExtent(catalog, code)
      setFocus(site ? { ...site, source: 'map' } : { type: 'managedExtent', id, source: 'map' })
    })
  }, [catalog, setFocus])

  const neighborhoodStyle = useCallback((feature) => polygonStyle(feature, focus, 'neighborhood'), [focus])
  const extentStyle = useCallback((feature) => {
    const selected = extentSelected(feature, focus)
    const styled = polygonStyle(feature, selected ? { type: 'extent', id: feature.properties.id } : focus, 'extent')
    const inPlan = plan.has(feature.properties.code) || (feature.properties.actCode && plan.has(feature.properties.actCode))
    if (!inPlan || selected) return styled
    return { ...styled, weight: 2.25, fillOpacity: Math.min((styled.fillOpacity ?? 0.2) + 0.18, 0.45) }
  }, [focus, plan])
  const onUnlinkedExtent = useCallback((feature, layer) => {
    const { id, code, name, unlinkedKind } = feature.properties
    const title = name && name !== code ? `${code || ''} · ${name}`.replace(/^ · /, '') : String(code || name || 'Unlinked extent')
    layer.bindTooltip(title, { className: 'site-tip', sticky: true, opacity: 1 })
    layer.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      layer._path?.blur()
      if (unlinkedKind === 'managed') {
        setFocus({ type: 'managedExtent', id, source: 'map' })
        return
      }
      setFocus({ type: 'extent', id, source: 'map' })
    })
  }, [setFocus])

  const unlinkedExtentStyle = useCallback((feature) => {
    const selected = feature.properties.unlinkedKind === 'managed'
      ? managedExtentSelected(feature, focus)
      : extentSelected(feature, focus)
    return {
      color: selected ? '#9b2c24' : '#c4554d',
      weight: selected ? 2.5 : 1.5,
      dashArray: selected ? null : '4 3',
      fillColor: '#c4554d',
      fillOpacity: selected ? 0.28 : 0.12,
    }
  }, [focus])

  const managedExtentStyle = useCallback((feature) => {
    const selected = managedExtentSelected(feature, focus)
    return polygonStyle(
      feature,
      selected ? { type: 'managedExtent', id: feature.properties.id } : focus,
      'managedExtent',
    )
  }, [focus])

  useEffect(() => {
    for (const layer of extentLayers.current.values()) {
      if (extentSelected(layer.feature, focus)) layer.bringToFront()
    }
    for (const layer of managedExtentLayers.current.values()) {
      if (managedExtentSelected(layer.feature, focus)) layer.bringToFront()
    }
  }, [focus])

  return (
    <div className="map-wrap">
      <MapContainer
        center={[31.45, 34.35]}
        zoom={11}
        zoomControl={false}
        attributionControl={false}
        className="map"
      >
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri"
          maxZoom={18}
          maxNativeZoom={16}
        />
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
          attribution="Labels &copy; Esri"
          maxZoom={18}
          maxNativeZoom={16}
        />
        <EnsurePanes />
        <ZoomControl position="bottomright" />
        <ScaleControl position="bottomleft" imperial={false} />
        <FitView points={fitPoints} watch={areaFilter} />
        <FlyTo lat={focused?.lat} lon={focused?.lon} token={focus?.source === 'search' ? focusKey : ''} />
        <Invalidate open={Boolean(focus)} />
        <DrawSurface
          active={Boolean(draft) || measuring}
          onPoint={draft ? addDraftPoint : addMeasurePoint}
          onFinish={draft ? finishDraw : () => setMeasuring(false)}
        />

        {definedAreas.filter((area) => area.visible && area.id !== editingId).map((area) => (
          <Polygon
            key={area.id}
            pane="areas"
            interactive={false}
            positions={area.ring.map(([lon, lat]) => [lat, lon])}
            pathOptions={{ color: area.color, weight: 2, fillColor: area.color, fillOpacity: 0.14 }}
          >
            <Tooltip
              className="area-label"
              permanent
              interactive
              direction="center"
              opacity={1}
              eventHandlers={{
                click: (event) => {
                  L.DomEvent.stopPropagation(event)
                  openArea(area.id)
                },
              }}
            >
              <strong>
                {area.featured ? <span className="area-check" aria-label="Selected">✓</span> : null}
                {area.name}
              </strong>
              <span>{formatCount(areaCounts[area.id]?.hhs ?? 0)} HH · {formatNumber(areaCounts[area.id]?.individuals ?? 0)}</span>
            </Tooltip>
          </Polygon>
        ))}

        {measurePoints.length >= 2 ? (
          <Polyline
            pane="coverage"
            interactive={false}
            positions={measurePoints}
            pathOptions={{ color: '#37352f', weight: 2.5, dashArray: '6 4' }}
          />
        ) : null}
        {measurePoints.map((point, index) => (
          <CircleMarker
            key={`measure-${index}`}
            pane="coverage"
            interactive={false}
            center={point}
            radius={4}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#37352f', fillOpacity: 1 }}
          />
        ))}

        {(() => {
          const editingArea = definedAreas.find((area) => area.id === editingId)
          return editingArea && editPoints ? (
            <AreaEditor
              area={editingArea}
              points={editPoints}
              summary={`${formatCount(editCounts?.hhs ?? 0)} HH · ${formatNumber(editCounts?.individuals ?? 0)}`}
              onChange={updateEditPoints}
            />
          ) : null
        })()}

        {draft && draft.length >= 2 ? (
          <Polygon
            pane="areas"
            interactive={false}
            positions={draft}
            pathOptions={{ color: '#c4554d', weight: 2, dashArray: '4 4', fillColor: '#c4554d', fillOpacity: 0.1 }}
          />
        ) : null}
        {draft?.map((point, index) => (
          <CircleMarker
            key={`draft-${index}`}
            pane="areas"
            interactive={false}
            center={point}
            radius={4}
            pathOptions={{ color: '#ffffff', weight: 2, fillColor: '#c4554d', fillOpacity: 1 }}
          />
        ))}

        {layers.neighborhoods ? (
          <GeoJSON data={neighborhoods} pane="neighborhoods" style={neighborhoodStyle} onEachFeature={onNeighborhood} />
        ) : null}

        {layers.blocks ? (
          <GeoJSON data={blocks} pane="blocks" style={blockStyle} onEachFeature={onBlock} />
        ) : null}

        {layers.extents ? (
          <GeoJSON key="extents" data={extents} pane="extents" style={extentStyle} onEachFeature={onExtent} />
        ) : null}

        {layers.managedExtents ? (
          <GeoJSON key="managed-extents" data={managedSiteExtents} pane="managedExtents" style={managedExtentStyle} onEachFeature={onManagedExtent} />
        ) : null}

        {layers.unlinkedExtents ? (
          <GeoJSON key="unlinked-extents" data={unlinkedExtentData} pane="unlinkedExtents" style={unlinkedExtentStyle} onEachFeature={onUnlinkedExtent} />
        ) : null}

        {focusedCrc && focused ? (
          <Polyline
            pane="coverage"
            interactive={false}
            positions={[[focused.lat, focused.lon], [focusedCrc.lat, focusedCrc.lon]]}
            pathOptions={{ color: '#d9730d', weight: 1.5, dashArray: '3 6', opacity: 0.85 }}
          />
        ) : null}

        {layers.partners && partnerSites.filter((site) => !sitesAlreadyOnMap.has(String(site.key).toUpperCase())).map((site) => {
          const here = placed('partner', site.key, site.lat, site.lon)
          return (
            <SiteDot
              key={`partner-${site.key}`}
              type="partner"
              id={site.key}
              lat={here.lat}
              lon={here.lon}
              color="#0e7490"
              filled
              shape="square"
              active={isActive('partner', site.key, focusKey, hoverKey)}
              title={site.partner ? `${site.name} · ${site.partner}` : site.name}
              setFocus={setFocus}
              moveSite={moveSite}
            />
          )
        })}

        {layers.managed && catalog.managed
          .filter((site) => !managedHidden.has(site.id))
          .filter((site) => {
            if (!activeArea) return true
            const here = placed('managed', site.id, site.lat, site.lon)
            const named = site.place && site.place.toLowerCase() === activeArea.neighborhood.toLowerCase()
            return named || haversineKm(here.lat, here.lon, activeArea.lat, activeArea.lon) <= 3
          })
          .map((site) => {
            const here = placed('managed', site.id, site.lat, site.lon)
            const partner = partnerFor(site.id)?.partner
            return (
              <SiteDot
                key={site.id}
                type="managed"
                id={site.id}
                lat={here.lat}
                lon={here.lon}
                color="#0f7b6c"
                filled
                active={isActive('managed', site.id, focusKey, hoverKey)}
                title={partner ? `${site.name} · ${partner}` : site.name}
                setFocus={setFocus}
                moveSite={moveSite}
              />
            )
          })}

        {[...visibleCandidates].sort((a, b) => Number(isActive('candidate', a.id, focusKey, hoverKey)) - Number(isActive('candidate', b.id, focusKey, hoverKey))).map((site) => {
          const here = placed('candidate', site.id, site.lat, site.lon)
          const color = areaByName[site.area]?.color ?? '#337ea9'
          const partner = partnerFor(site.id)?.partner
          return (
            <SiteDot
              key={site.id}
              type="candidate"
              id={site.id}
              lat={here.lat}
              lon={here.lon}
              color={color}
              filled={plan.has(site.id)}
              active={isActive('candidate', site.id, focusKey, hoverKey)}
              title={partner ? `${site.name} · ${partner}` : site.name}
              setFocus={setFocus}
              moveSite={moveSite}
            />
          )
        })}

        {layers.act && actMapSites()
          .filter((site) => {
            if (!activeArea) return true
            const place = site.neighbourhood.trim().toLowerCase()
            return place === activeArea.neighborhood.toLowerCase() || place === activeArea.name.toLowerCase()
          })
          .map((site) => {
            const here = placed('act', site.id, site.lat, site.lon)
            const partner = partnerFor(site.id)?.partner
            return (
              <SiteDot
                key={`act-${site.id}`}
                type="act"
                id={site.id}
                lat={here.lat}
                lon={here.lon}
                color="#3949ab"
                filled={plan.has(site.id)}
                active={isActive('act', site.id, focusKey, hoverKey)}
                title={partner ? `${site.name} · ${partner}` : site.name}
                setFocus={setFocus}
                moveSite={moveSite}
              />
            )
          })}

        {bareDots.filter((dot) => {
          if (dot.type === 'candidate') {
            const site = catalog.candidates.find((item) => item.id === dot.id)
            return Boolean(site && candidateVisible(site, layers, plan, areaFilter))
          }
          if (dot.type === 'managed') {
            if (!layers.managed || managedHidden.has(dot.id)) return false
            if (!activeArea) return true
            const site = catalog.managed.find((item) => item.id === dot.id)
            const named = site?.place && site.place.toLowerCase() === activeArea.neighborhood.toLowerCase()
            return named || haversineKm(dot.lat, dot.lon, activeArea.lat, activeArea.lon) <= 3
          }
          if (!layers.act) return false
          if (!activeArea) return true
          const site = actMapSites().find((item) => item.id === dot.id)
          const place = site?.neighbourhood.trim().toLowerCase() || ''
          return place === activeArea.neighborhood.toLowerCase() || place === activeArea.name.toLowerCase()
        }).map((dot) => {
          const here = placed(dot.type, dot.key, dot.lat, dot.lon)
          const candidate = dot.type === 'candidate' ? catalog.candidates.find((item) => item.id === dot.id) : null
          const color = dot.type === 'managed' ? '#0f7b6c' : dot.type === 'act' ? '#3949ab' : (areaByName[candidate?.area]?.color ?? '#337ea9')
          return (
            <SiteDot
              key={`bare-${dot.key}`}
              type={dot.type}
              id={dot.id}
              positionId={dot.key}
              lat={here.lat}
              lon={here.lon}
              color={color}
              filled={dot.type === 'managed' || plan.has(dot.id)}
              active={isActive(dot.type, dot.id, focusKey, hoverKey)}
              title={candidate?.name || dot.name}
              setFocus={setFocus}
              moveSite={moveSite}
            />
          )
        })}

        {layers.aisha && catalog.aisha
          .filter((site) => {
            if (!activeArea) return true
            const here = placed('aisha', site.id, site.lat, site.lon)
            return haversineKm(here.lat, here.lon, activeArea.lat, activeArea.lon) <= 6
          })
          .map((site) => {
            const here = placed('aisha', site.id, site.lat, site.lon)
            return (
              <Marker
                key={site.id}
                draggable
                position={[here.lat, here.lon]}
                icon={markerIcon('aisha', isActive('aisha', site.id, focusKey, hoverKey))}
                eventHandlers={dragHandlers('aisha', site.id, setFocus, moveSite)}
              >
                <Tooltip className="site-tip" direction="top" offset={[0, -8]} opacity={1}>
                  {site.address}
                </Tooltip>
              </Marker>
            )
          })}

        {layers.crcs && catalog.crcs
          .filter((site) => !activeArea || site.region === activeArea.crc)
          .map((site) => {
            const here = placed('crc', site.id, site.lat, site.lon)
            return (
              <Marker
                key={site.id}
                draggable
                position={[here.lat, here.lon]}
                icon={markerIcon('crc', isActive('crc', site.id, focusKey, hoverKey))}
                zIndexOffset={400}
                eventHandlers={dragHandlers('crc', site.id, setFocus, moveSite)}
              >
                <Tooltip className="site-tip" direction="top" offset={[0, -8]} opacity={1}>
                  {site.name}
                </Tooltip>
              </Marker>
            )
          })}
      </MapContainer>
      {draft ? (
        <p className="draw-banner">
          Click the map to add corners{drawingParent ? ` for ${drawingParent}` : ''}. Double-click to finish.
          {draftCounts ? ` ${draftCounts.verification} assessments · ${draftCounts.act} ACT sites · ${formatCount(draftCounts.hhs)} HH · ${formatNumber(draftCounts.individuals)} individuals inside.` : ''}
        </p>
      ) : null}
      {editingId ? (
        <p className="draw-banner">
          Drag a corner to move the boundary. Click a midpoint to add a corner. Double-click a corner to remove it.
          {editCounts ? ` ${editCounts.verification} ${editCounts.verification === 1 ? 'site' : 'sites'} · ${editCounts.act} ACT sites · ${formatCount(editCounts.hhs)} HH · ${formatNumber(editCounts.individuals)} individuals inside.` : ''}
        </p>
      ) : null}
      {measuring && !draft ? (
        <p className="draw-banner">Click the map to measure. Double-click to finish.</p>
      ) : null}

      <div className="map-tools">
        <button
          type="button"
          className={measuring ? 'is-on' : ''}
          onClick={() => setMeasuring((on) => !on)}
          disabled={Boolean(draft) || Boolean(editingId)}
        >
          Measure
        </button>
        {measurePoints.length ? (
          <button type="button" onClick={clearMeasure}>Clear</button>
        ) : null}
        {measurePoints.length >= 2 ? <span>{formatKm(measureLength(measurePoints))}</span> : null}
      </div>

      <div className="legend">
        <span><i className="legend-fill" style={{ background: activeArea?.color ?? '#337ea9', boxShadow: `0 0 0 1.5px #fff, 0 0 0 2.5px ${activeArea?.color ?? '#337ea9'}` }} /> In plan</span>
        <span><i className="legend-hollow" style={{ borderColor: activeArea?.color ?? '#9b9a97' }} /> Outside plan</span>
        <span><i className="legend-managed" /> Managed</span>
        <span><i className="legend-partner" /> Managed by partners</span>
        <span><i className="legend-act" /> ACT</span>
        <span><i className="legend-crc" /> CRC</span>
        <span><i className="legend-aisha" /> Aisha</span>
        <span><i className="legend-neighborhood" /> Neighborhoods</span>
        <span><i className="legend-block" /> Blocks</span>
        <span><i className="legend-extent" /> Extents</span>
        <span><i className="legend-managed-extent" /> Managed extents</span>
        <span><i className="legend-unlinked-extent" /> Unlinked extents</span>
      </div>
      <p className="map-credit">© Esri, DeLorme, NAVTEQ</p>
    </div>
  )
}

function managedExtentSelected(feature, focus) {
  if (!focus || !feature) return false
  if (focus.type === 'managedExtent' && focus.id === feature.properties.id) return true
  if (focus.type !== 'candidate' && focus.type !== 'managed') return false
  return String(focus.id || '').toUpperCase() === String(feature.properties.code || '').toUpperCase()
}

function extentSelected(feature, focus) {
  if (!focus || !feature) return false
  if (focus.type === 'extent' && focus.id === feature.properties.id) return true
  const code = String(feature.properties.code || '').toUpperCase()
  const actCode = String(feature.properties.actCode || '').toUpperCase()
  const focusId = String(focus.id || '').toUpperCase()
  if (focus.type === 'act') return focusId === code || focusId === actCode
  if (focus.type !== 'candidate' && focus.type !== 'managed') return false
  return focusId === code || focusId === actCode
}

function measureLength(points) {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    const [lat, lon] = points[index - 1]
    const [nextLat, nextLon] = points[index]
    total += haversineKm(lat, lon, nextLat, nextLon)
  }
  return total
}

function polygonStyle(feature, focus, type) {
  const selected = focus?.type === type && focus.id === feature.properties.id
  const stroke = (feature.properties.stroke || '#37352f').toLowerCase()
  const muted = stroke === '#000000'
  const color = muted ? '#5c5b57' : feature.properties.stroke
  const fill = muted ? '#37352f' : feature.properties.fill || color
  const base = muted ? 0.05 : Math.min(feature.properties.fillOpacity ?? 0.2, 0.22)
  return {
    color,
    weight: selected ? 2.5 : 1.25,
    fillColor: fill,
    fillOpacity: selected ? Math.min(base + 0.16, 0.4) : base,
  }
}

function SiteDot({ type, id, positionId, lat, lon, color, filled, active, title, setFocus, moveSite, shape = 'circle' }) {
  return (
    <Marker
      pane="sites"
      draggable
      position={[lat, lon]}
      icon={circleIcon(color, filled, active, shape)}
      zIndexOffset={active ? 700 : 0}
      eventHandlers={dragHandlers(type, id, setFocus, moveSite, positionId || id)}
    >
      <Tooltip className="site-tip" direction="top" offset={[0, -8]} opacity={1}>
        {title}
      </Tooltip>
    </Marker>
  )
}

function dragHandlers(type, id, setFocus, moveSite, positionId = id) {
  return {
    click: (event) => {
      L.DomEvent.stopPropagation(event)
      setFocus({ type, id, source: 'map' })
    },
    dragend: (event) => {
      const next = event.target.getLatLng()
      moveSite(type, positionId, next.lat, next.lng)
    },
  }
}

function isActive(type, id, focusKey, hoverKey) {
  const key = `${type}:${id}`
  return key === focusKey || key === hoverKey
}

function resolveFocus(catalog, focus, placed) {
  if (!focus) return null
  if (focus.type === 'candidate') {
    const site = catalog.candidates.find((item) => item.id === focus.id)
    return site ? { ...site, ...placed('candidate', site.id, site.lat, site.lon) } : null
  }
  if (focus.type === 'managed') {
    const site = catalog.managed.find((item) => item.id === focus.id)
    return site ? { ...site, ...placed('managed', site.id, site.lat, site.lon), type: 'managed' } : null
  }
  if (focus.type === 'aisha') {
    const site = catalog.aisha.find((item) => item.id === focus.id)
    return site ? { ...site, ...placed('aisha', site.id, site.lat, site.lon), type: 'aisha' } : null
  }
  if (focus.type === 'crc') {
    const site = catalog.crcs.find((item) => item.id === focus.id)
    return site ? { ...site, ...placed('crc', site.id, site.lat, site.lon), type: 'crc' } : null
  }
  if (focus.type === 'act') {
    const site = actMapSites().find((item) => item.id === focus.id)
    if (site) return { ...placed('act', site.id, site.lat, site.lon), type: 'act' }
    const key = String(focus.id).toUpperCase()
    const feature = extents.features.find((item) => {
      const code = String(item.properties.code || '').toUpperCase()
      const actCode = String(item.properties.actCode || '').toUpperCase()
      return code === key || actCode === key
    })
    const ring = feature?.geometry?.coordinates?.[0]
    if (!ring?.length) return null
    const lat = ring.reduce((sum, pair) => sum + pair[1], 0) / ring.length
    const lon = ring.reduce((sum, pair) => sum + pair[0], 0) / ring.length
    return { lat, lon, type: 'act' }
  }
  return null
}
