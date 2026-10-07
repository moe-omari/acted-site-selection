import CompareTable from './CompareTable'
import { compareAreas } from '../lib/compare'
import { useAppState } from '../state'

export default function AreaCompare() {
  const { compareTarget, setCompareTarget, definedAreas, catalog, siteDots } = useAppState()
  const target = catalog.areas.find((area) => area.name === compareTarget)
  const areas = definedAreas.filter((area) => area.parent === compareTarget)
  if (!target || areas.length < 2) return null
  const report = compareAreas(areas, siteDots)

  const exportPdf = () => {
    const previous = document.title
    document.title = `${target.name} comparison`
    const restore = () => {
      document.title = previous
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  return (
    <section className="compare" aria-label={`Compare areas in ${target.name}`}>
      <header className="compare-head">
        <div>
          <p>Comparison · {target.neighborhood}</p>
          <h2>{target.name}</h2>
        </div>
        <span className="compare-actions">
          <button type="button" className="text-btn" onClick={exportPdf}>Export PDF</button>
          <button type="button" className="text-btn" onClick={() => setCompareTarget(null)}>Close</button>
        </span>
      </header>
      <p className="compare-note">
        Site verification assessments whose site or footprint falls inside each outline. Each bar is the share of assessed sites in that area. Drag a column edge to resize it.
      </p>
      <div className="compare-scroll">
        <CompareTable columns={report.columns} sectors={report.sectors} />
      </div>
    </section>
  )
}
