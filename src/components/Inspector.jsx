import blocks from '../data/blocks.json'
import extents from '../data/extents.json'
import managedSiteExtents from '../data/managed-extents.json'
import { partnerFor, partnerSitesByOthers as partnerSites } from '../lib/partners'
import { formatCoord, formatCount, formatKm, formatNumber } from '../lib/format'
import { haversineKm, nearest, pointInRing } from '../lib/geo'
import { siteTypology } from '../lib/areas'
import { actRecord, actMapPoint, focusForExtent } from '../lib/sites'
import { useAppState } from '../state'

export default function Inspector() {
  const { focus: selected, setFocus, catalog, plan, overlaps, areaByName, stats, placed, targets } = useAppState()
  const focus = focusForExtent(selected, catalog)
  if (!focus) return null

  if (focus.type === 'candidate') {
    const site = catalog.candidates.find((item) => item.id === focus.id)
    if (!site) return null
    const here = placed('candidate', site.id, site.lat, site.lon)
    const located = { ...site, ...here }
    const area = areaByName[site.area]
    const crc = catalog.crcs.find((item) => item.region === area?.crc)
    const managedHit = catalog.managed.find((item) => item.id === site.id)
    const closestAisha = nearestService(located, 'aisha', catalog.aisha, placed)
    const inPlan = plan.has(site.id)
    return (
      <aside className="inspector">
        <Header eyebrow={site.area} title={site.name} onClose={() => setFocus(null)} />
        <div className="pills">
          <span className="pill" style={{ '--c': area?.color }}>{site.neighborhood}</span>
          <span className={inPlan ? 'pill solid' : 'pill'}>{inPlan ? 'In plan' : 'Outside plan'}</span>
          {overlaps.candidateIds.has(site.id) ? <span className="pill green">Currently managed</span> : null}
          {partnerPill(site.id)}
          {area?.anchorId === site.id ? <span className="pill">Area anchor</span> : null}
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Site ID">{site.id}</Row>
          {partnerRow(site.id)}
          <Row label="Typology">{siteTypology(site.id) || '—'}</Row>
          {site.status ? <Row label="Status">{site.status}</Row> : null}
          <Row label="Households">{formatCount(site.hhs)}</Row>
          <Row label="Individuals">{formatCount(site.individuals)}</Row>
          {site.fromVerification || site.fromExtent ? null : <Row label="Rank from anchor">{site.rank}</Row>}
          <Row label="Distance to anchor">{formatKm(area ? haversineKm(here.lat, here.lon, area.lat, area.lon) : site.distanceAnchorKm)}</Row>
          <Row label="Distance to CRC">{formatKm(crc ? haversineKm(here.lat, here.lon, crc.lat, crc.lon) : site.distanceCrcKm)}</Row>
          <Row label="Nearest Aisha">{serviceText(closestAisha, (item) => item.point.address)}</Row>
          <Row label="CRC">{crc ? crc.name : area?.crc}</Row>
          {site.fromVerification || site.fromExtent ? null : <Row label="Workbook">{site.workbookSelected ? 'Selected' : 'Not selected'}</Row>}
          <Row label="Coordinates">{formatCoord(located.lat, located.lon)}</Row>
        </section>
        <section>
          <h3>Around this site</h3>
          {managedHit ? (
            <p className="note">Same location as managed site {managedHit.name} ({managedHit.id}).</p>
          ) : (
            <Nearby label="Nearest managed site" item={nearest(located, catalog.managed)} />
          )}
          {area ? (
            <p className="note">
              {area.name} now covers {formatKm(stats.byArea[area.name].radiusKm)} from {area.anchorId}, with {formatNumber(stats.byArea[area.name].individuals)} individuals against a target of {formatNumber(targets.areas[area.name].individuals)}.
            </p>
          ) : null}
        </section>
      </aside>
    )
  }

  if (focus.type === 'partner') {
    const site = partnerSites.find((item) => item.key === focus.id)
    if (!site) return null
    const here = placed('partner', site.key, site.lat, site.lon)
    return (
      <aside className="inspector">
        <Header eyebrow="Managed by partners" title={site.name || site.id} onClose={() => setFocus(null)} />
        {site.nameAr ? <p className="arabic" dir="auto">{site.nameAr}</p> : null}
        <div className="pills">
          {site.partner ? <span className="pill green">{site.partner}</span> : null}
          {site.governorate ? <span className="pill">{site.governorate}</span> : null}
          {site.neighborhood ? <span className="pill">{site.neighborhood}</span> : null}
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Site ID">{site.id}</Row>
          {site.partner ? <Row label="Partner">{site.partner}</Row> : null}
          {site.siteType ? <Row label="Type">{site.siteType}</Row> : null}
          {site.status ? <Row label="Status">{site.status}</Row> : null}
          {site.households != null ? <Row label="Households">{formatNumber(site.households)}</Row> : null}
          {site.individuals != null ? <Row label="Individuals">{formatNumber(site.individuals)}</Row> : null}
          {site.governorate ? <Row label="Governorate">{site.governorate}</Row> : null}
          {site.neighborhood ? <Row label="Neighborhood">{site.neighborhood}</Row> : null}
          <Row label="Coordinates">{formatCoord(here.lat, here.lon)}</Row>
        </section>
      </aside>
    )
  }

  if (focus.type === 'managed') {
    const site = catalog.managed.find((item) => item.id === focus.id)
    if (!site) return null
    const here = placed('managed', site.id, site.lat, site.lon)
    const inside = catalog.areas
      .map((area) => ({ area, km: haversineKm(here.lat, here.lon, area.lat, area.lon), radius: stats.byArea[area.name].radiusKm }))
      .filter((item) => item.radius && item.km <= item.radius)
    const closestCrc = nearestService(here, 'crc', catalog.crcs, placed)
    const closestAisha = nearestService(here, 'aisha', catalog.aisha, placed)
    const linked = catalog.candidates.find((item) => item.id === site.id)
    const footprint = managedFootprint(site.id)
    return (
      <aside className="inspector">
        <Header eyebrow="Currently managed" title={site.name} onClose={() => setFocus(null)} />
        {site.nameAr ? <p className="arabic" dir="auto">{site.nameAr}</p> : null}
        <div className="pills">
          {site.governorate ? <span className="pill green">{site.governorate}</span> : null}
          {site.place ? <span className="pill">{site.place}</span> : null}
          {partnerPill(site.id)}
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Site ID">{site.id}</Row>
          {partnerRow(site.id)}
          <Row label="Typology">{siteTypology(site.id) || '—'}</Row>
          {footprint?.households != null ? <Row label="Households">{formatNumber(footprint.households)}</Row> : null}
          {footprint?.individuals != null ? <Row label="Individuals">{formatNumber(footprint.individuals)}</Row> : null}
          {site.governorate ? <Row label="Governorate">{site.governorate}</Row> : null}
          {site.place ? <Row label="Neighborhood">{site.place}</Row> : null}
          <Row label="Coordinates">{formatCoord(here.lat, here.lon)}</Row>
          {closestCrc ? <Row label="Nearest CRC">{closestCrc.point.name} · {formatKm(closestCrc.km)}</Row> : null}
          <Row label="Nearest Aisha">{serviceText(closestAisha, (item) => item.point.address)}</Row>
        </section>
        <section>
          <h3>Proposed areas</h3>
          {inside.length ? inside.map(({ area, km }) => (
            <p key={area.name} className="note">Inside {area.name} coverage, {formatKm(km)} from the anchor.</p>
          )) : <p className="note">Outside the current coverage of all three proposed areas.</p>}
          {linked ? (
            <p className="note">
              This ID is also a candidate in {linked.area}: {formatNumber(linked.hhs)} HH, {formatNumber(linked.individuals)} individuals, rank {linked.rank}.
            </p>
          ) : null}
        </section>
      </aside>
    )
  }

  if (focus.type === 'aisha') {
    const site = catalog.aisha.find((item) => item.id === focus.id)
    if (!site) return null
    const here = placed('aisha', site.id, site.lat, site.lon)
    const closestArea = nearest(here, catalog.areas)
    return (
      <aside className="inspector">
        <Header eyebrow="Aisha safe space" title={site.address} onClose={() => setFocus(null)} />
        <div className="pills">
          <span className="pill pink">{site.status}</span>
          <span className="pill">{site.governorate}</span>
          <span className="pill">{site.type}</span>
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Number">{site.id}</Row>
          <Row label="Donor">{site.donor}</Row>
          <Row label="Organization">{site.organization}</Row>
          <Row label="Focal point">{site.focalPoint}</Row>
          <Row label="Phone"><a href={`tel:${site.phone}`}>{site.phone}</a></Row>
          <Row label="Email"><a href={`mailto:${site.email}`}>{site.email}</a></Row>
          <Row label="Coordinates">{formatCoord(here.lat, here.lon)}</Row>
        </section>
        {closestArea ? (
          <section>
            <h3>Nearest proposed area</h3>
            <p className="note">{closestArea.point.name} anchor is {formatKm(closestArea.km)} away. Target {formatCount(targets.areas[closestArea.point.name].hhs)} HH.</p>
          </section>
        ) : null}
      </aside>
    )
  }

  if (focus.type === 'crc') {
    const site = catalog.crcs.find((item) => item.id === focus.id)
    if (!site) return null
    const here = placed('crc', site.id, site.lat, site.lon)
    const linkedAreas = catalog.areas.filter((area) => area.crc === site.region)
    const planned = catalog.candidates.filter((item) => plan.has(item.id) && linkedAreas.some((area) => area.name === item.area))
    const avg = planned.length
      ? planned.reduce((sum, item) => sum + item.distanceCrcKm, 0) / planned.length
      : null
    return (
      <aside className="inspector">
        <Header eyebrow="Community resource centre" title={site.name} onClose={() => setFocus(null)} />
        <div className="pills">
          <span className="pill orange">{site.region}</span>
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Coordinates">{formatCoord(here.lat, here.lon)}</Row>
          <Row label="Areas served">{linkedAreas.map((area) => area.name).join(', ') || '—'}</Row>
          <Row label="Plan sites">{formatNumber(planned.length)}</Row>
          <Row label="Avg. distance">{formatKm(avg)}</Row>
        </section>
        <p className="note">Areas grow outward from their anchor until household and individual targets are both met. Distance to this CRC is the closeness check from the workbook.</p>
      </aside>
    )
  }

  if (focus.type === 'block') {
    const feature = blocks.features.find((item) => item.properties.id === focus.id)
    if (!feature) return null
    const ring = feature.geometry.coordinates[0]
    const contains = (type, site) => {
      const here = placed(type, site.id, site.lat, site.lon)
      return pointInRing(here.lat, here.lon, ring)
    }
    const planSites = catalog.candidates.filter((site) => plan.has(site.id) && contains('candidate', site))
    const managedCount = catalog.managed.filter((site) => contains('managed', site)).length
    const aishaCount = catalog.aisha.filter((site) => contains('aisha', site)).length
    return (
      <aside className="inspector">
        <Header eyebrow="Gaza block" title={`Block ${feature.properties.name}`} onClose={() => setFocus(null)} />
        <div className="pills">
          {feature.properties.governorate ? <span className="pill purple">{feature.properties.governorate}</span> : null}
        </div>
        <section>
          <h3>Inside this block</h3>
          <Row label="Plan sites">{formatNumber(planSites.length)}</Row>
          <Row label="Managed sites">{formatNumber(managedCount)}</Row>
          <Row label="Aisha spaces">{formatNumber(aishaCount)}</Row>
        </section>
        {planSites.length ? (
          <section>
            <h3>Plan sites</h3>
            {planSites.map((site) => (
              <button key={site.id} type="button" className="block-site" onClick={() => setFocus({ type: 'candidate', id: site.id })}>
                <span>{site.name}</span>
                <em>{site.id}</em>
              </button>
            ))}
          </section>
        ) : (
          <p className="note">No sites from the current plan fall inside this block.</p>
        )}
      </aside>
    )
  }

  if (focus.type === 'act') {
    const site = actRecord([focus.id])
    if (!site) return null
    const feature = extents.features.find((item) => item.properties.id === focus.extentId)
      ?? extents.features.find((item) => String(item.properties.code || '').toUpperCase() === site.id.toUpperCase() || String(item.properties.actCode || '').toUpperCase() === site.id.toUpperCase())
    const extentName = feature?.properties?.name?.trim()
    const title = site['Site name'] || extentName || site.id
    const inPlan = plan.has(site.id)
    const point = actMapPoint(site)
    const here = point ? placed('act', site.id, point.lat, point.lon) : null
    const closestAisha = here ? nearestService(here, 'aisha', catalog.aisha, placed) : null
    return (
      <aside className="inspector">
        <Header eyebrow="ACT site" title={title} onClose={() => setFocus(null)} />
        {site['Site name (Arabic)'] ? <p className="arabic" dir="auto">{site['Site name (Arabic)']}</p> : null}
        <div className="pills">
          {site['Site status'] ? <span className="pill green">{site['Site status']}</span> : null}
          {site.Governorate ? <span className="pill">{site.Governorate}</span> : null}
          {site.Neighbourhood ? <span className="pill">{site.Neighbourhood}</span> : null}
          {inPlan ? <span className="pill solid">In plan</span> : null}
          {partnerPill(site.id) || partnerPill(site['New Site ID'])}
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Site ID">{site.id}</Row>
          {partnerRow(site.id) || partnerRow(site['New Site ID'])}
          <Row label="Typology">{siteTypology(site.id, site['New Site ID']) || '—'}</Row>
          {here ? <Row label="Coordinates">{formatCoord(here.lat, here.lon)}</Row> : null}
          {here ? <Row label="Nearest Aisha">{serviceText(closestAisha, (item) => item.point.address)}</Row> : null}
          {extentName && extentName !== title ? <Row label="Extent">{extentName}</Row> : null}
          {ACT_FIELDS.map(([key, label]) => {
            const value = site[key]
            if (value == null || String(value).trim() === '') return null
            const text = key === 'Households' || key === 'Individuals' ? formatNumber(Number(value)) : value
            return <Row key={key} label={label}>{text}</Row>
          })}
        </section>
      </aside>
    )
  }

  if (focus.type === 'managedExtent') {
    const feature = managedSiteExtents.features.find((item) => item.properties.id === focus.id)
    if (!feature) return null
    const place = feature.properties
    const title = place.name || place.code || 'Managed extent'
    return (
      <aside className="inspector">
        <Header eyebrow="Managed site extent" title={title} onClose={() => setFocus(null)} />
        {place.nameAr ? <p className="arabic" dir="auto">{place.nameAr}</p> : null}
        <div className="pills">
          {place.code ? <span className="pill">{place.code}</span> : null}
          {place.status ? <span className="pill green">{place.status}</span> : null}
          {place.governorate ? <span className="pill">{place.governorate}</span> : null}
          {place.neighborhood ? <span className="pill">{place.neighborhood}</span> : null}
        </div>
        <section>
          <h3>Properties</h3>
          {place.code ? <Row label="Site ID">{place.code}</Row> : null}
          {place.siteType ? <Row label="Type">{place.siteType}</Row> : null}
          {place.households != null ? <Row label="Households">{formatNumber(place.households)}</Row> : null}
          {place.individuals != null ? <Row label="Individuals">{formatNumber(place.individuals)}</Row> : null}
          {place.agency ? <Row label="Managing agency">{place.agency}</Row> : null}
          {place.partner ? <Row label="Implementing partner">{place.partner}</Row> : null}
          {place.management ? <Row label="Management">{place.management}</Row> : null}
          {place.why ? <Row label="Why this site">{place.why}</Row> : null}
          {place.flag ? <Row label="Flag">{place.flag}</Row> : null}
          {place.label && place.label !== title ? <Row label="Source name">{place.label}</Row> : null}
        </section>
        {place.note ? <p className="note">{place.note}</p> : null}
      </aside>
    )
  }

  if (focus.type === 'extent') {
    const feature = extents.features.find((item) => item.properties.id === focus.id)
    if (!feature) return null
    const place = feature.properties
    return (
      <aside className="inspector">
        <Header eyebrow="Site extent" title={place.name === place.code ? place.code : place.name} onClose={() => setFocus(null)} />
        <div className="pills">
          <span className="pill">{place.code}</span>
        </div>
        <section>
          <h3>Properties</h3>
          <Row label="Site ID">{place.code}</Row>
          {place.label && place.label !== place.name ? <Row label="Source name">{place.label}</Row> : null}
        </section>
        <p className="note">No workbook or managed site uses the ID {place.code}.</p>
      </aside>
    )
  }

  return null
}

function Header({ eyebrow, title, onClose }) {
  return (
    <header className="inspector-head">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  )
}

function partnerPill(id) {
  const site = partnerFor(id)
  if (!site) return null
  return <span className="pill green">{site.partner ? `Managed by ${site.partner}` : 'Managed by a partner'}</span>
}

function partnerRow(id) {
  const site = partnerFor(id)
  if (!site) return null
  return <Row label="Partner">{site.partner || '—'}</Row>
}

function Row({ label, children }) {
  return (
    <div className="prop">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  )
}

function nearestService(origin, type, sites, placed) {
  const points = sites.map((site) => ({ ...site, ...placed(type, site.id, site.lat, site.lon) }))
  return nearest(origin, points)
}

function serviceText(item, nameOf) {
  if (!item) return '—'
  const name = nameOf ? nameOf(item) : item.point.name
  return `${name} · ${formatKm(item.km)}`
}

function Nearby({ label, item, nameOf }) {
  if (!item) return null
  const name = nameOf ? nameOf(item) : item.point.name
  return (
    <p className="note">{label}: {name} ({item.point.id}), {formatKm(item.km)}.</p>
  )
}

function managedFootprint(code) {
  if (!code) return null
  return managedSiteExtents.features.find((feature) => feature.properties.code === code)?.properties ?? null
}

const ACT_FIELDS = [
  ['Alternative name', 'Alternative name'],
  ['Site type', 'Type'],
  ['Sub-neighbourhood (adm4)', 'Sub-neighbourhood'],
  ['Households', 'Households'],
  ['Individuals', 'Individuals'],
  ['Site management agency', 'Site management'],
  ['Implementing partner', 'Implementing partner'],
  ['Managed / unmanaged', 'Management'],
  ['Neighbourhood allocated to', 'Allocated neighbourhood'],
  ['Why this site is yours', 'Why this site'],
  ['site verification (yes or no)', 'Verification'],
  ['sites extent (yes or No)', 'Extent drawn'],
  ['Last updated', 'Last updated'],
  ['Group no.', 'Group'],
  ['Sweep done?', 'Sweep'],
  ['New Site ID', 'New site ID'],
  ['Comments', 'Comments'],
]
