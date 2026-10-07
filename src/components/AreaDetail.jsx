import { useMemo } from 'react'
import CompareTable from './CompareTable'
import { compareAreas } from '../lib/compare'
import { formatKm } from '../lib/format'
import { areaServices } from '../lib/services'
import { useAppState } from '../state'

export default function AreaDetail() {
  const { detailAreaId, setDetailAreaId, definedAreas, catalog, placed, siteDots } = useAppState()
  const area = definedAreas.find((item) => item.id === detailAreaId)
  const target = catalog.areas.find((item) => item.name === area?.parent)
  const report = useMemo(() => (area ? compareAreas([area], siteDots) : null), [area, siteDots])
  const services = useMemo(() => (area ? areaServices(area.ring, placed, siteDots) : null), [area, placed, siteDots])
  if (!area || !report || !services) return null

  return (
    <section className="compare" aria-label={`Assessments in ${area.name}`}>
      <header className="compare-head">
        <div>
          <p>Site verification · {target?.name || area.parent}</p>
          <h2>{area.name}</h2>
        </div>
        <button type="button" className="text-btn" onClick={() => setDetailAreaId(null)}>Close</button>
      </header>
      <div className="service-averages">
        <div>
          <p>Assessments</p>
          <strong>{services.sites.length}</strong>
        </div>
        <div>
          <p>Average distance to nearest CRC</p>
          <strong>{formatKm(services.crcKm)}</strong>
        </div>
        <div>
          <p>Average distance to nearest Aisha</p>
          <strong>{formatKm(services.aishaKm)}</strong>
        </div>
      </div>
      <div className="compare-scroll">
        {services.sites.length ? (
          <table className="service-table">
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Nearest CRC</th>
                <th>Nearest Aisha</th>
              </tr>
            </thead>
            <tbody>
              {services.sites.map((site, index) => (
                <tr key={`${site.id}-${index}`}>
                  <th>
                    {site.name}
                    {site.id ? <span>{site.id}</span> : null}
                  </th>
                  <td>{site.crcKm == null ? '—' : `${site.crcName} · ${formatKm(site.crcKm)}`}</td>
                  <td>{site.aishaKm == null ? '—' : `${site.aishaName} · ${formatKm(site.aishaKm)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="compare-note">No site verification assessments fall inside this area.</p>
        )}
        <CompareTable columns={report.columns} sectors={report.sectors} />
      </div>
    </section>
  )
}
