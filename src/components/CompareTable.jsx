import { Fragment, useEffect, useRef, useState } from 'react'
import { formatCount, formatNumber } from '../lib/format'

const MIN_COLUMN = 140

export default function CompareTable({ columns, sectors }) {
  const count = columns.length + 1
  const tableRef = useRef(null)
  const [ratios, setRatios] = useState(() => equalRatios(count))

  useEffect(() => {
    setRatios((current) => (current.length === count ? current : equalRatios(count)))
  }, [count])

  const startResize = (index) => (event) => {
    event.preventDefault()
    event.stopPropagation()
    const table = tableRef.current
    if (!table) return
    const startWidths = [...table.querySelectorAll('col')].map((col) => col.getBoundingClientRect().width)
    const startX = event.clientX
    const handle = event.currentTarget
    try { handle.setPointerCapture(event.pointerId) } catch { /* window listeners still follow the drag */ }
    const move = (nextEvent) => {
      setRatios(resizeColumns(startWidths, index, nextEvent.clientX - startX))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <table className="compare-table" ref={tableRef}>
      <colgroup>
        {ratios.map((ratio, index) => (
          <col key={index} style={{ width: `${ratio * 100}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th>
            Sector
            <span className="col-resize" role="separator" aria-orientation="vertical" aria-label="Resize sector column" onPointerDown={startResize(0)} />
          </th>
          {columns.map((column, index) => (
            <th key={column.id}>
              <i style={{ background: column.color }} />
              {column.name}
              <span className="col-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${column.name}`} onPointerDown={startResize(index + 1)} />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr className="compare-summary">
          <th>Inside the outline</th>
          {columns.map((column) => (
            <td key={column.id}>
              <strong>{formatNumber(column.verification)} assessments</strong>
              <span>{formatNumber(column.act)} ACT sites</span>
              <span>{formatCount(column.hhs)} HH · {formatNumber(column.individuals)} individuals</span>
            </td>
          ))}
        </tr>
        {sectors.map((sector) => (
          <Fragment key={sector.name}>
            <tr className="compare-sector">
              <th colSpan={columns.length + 1}>{sector.name}</th>
            </tr>
            {sector.rows.map((row) => (
              <tr key={`${sector.name}-${row.label}`}>
                <th>{row.label}</th>
                {row.cells.map((cell, cellIndex) => (
                  <td key={columns[cellIndex].id}>
                    <Cell cell={cell} color={columns[cellIndex].color} />
                  </td>
                ))}
              </tr>
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

function equalRatios(count) {
  return Array.from({ length: count }, () => 1 / count)
}

function resizeColumns(startWidths, index, delta) {
  const total = startWidths.reduce((sum, width) => sum + width, 0)
  if (!total || !startWidths.length) return equalRatios(startWidths.length || 1)
  const next = startWidths.slice()
  const flex = []
  for (let item = index + 1; item < next.length; item += 1) flex.push(item)
  if (!flex.length) {
    for (let item = 0; item < index; item += 1) flex.push(item)
  }
  const slack = flex.reduce((sum, item) => sum + Math.max(0, startWidths[item] - MIN_COLUMN), 0)
  let taken = delta
  if (taken > slack) taken = slack
  if (startWidths[index] + taken < MIN_COLUMN) taken = MIN_COLUMN - startWidths[index]
  next[index] = startWidths[index] + taken
  if (taken >= 0) {
    const slacks = flex.map((item) => Math.max(0, startWidths[item] - MIN_COLUMN))
    const slackSum = slacks.reduce((sum, value) => sum + value, 0) || 1
    let remain = taken
    flex.forEach((item, itemIndex) => {
      const share = itemIndex === flex.length - 1 ? remain : (taken * slacks[itemIndex]) / slackSum
      const cut = Math.min(slacks[itemIndex], Math.max(0, share))
      next[item] = startWidths[item] - cut
      remain -= cut
    })
    if (remain > 0) next[index] -= remain
  } else {
    const grow = -taken
    const base = flex.reduce((sum, item) => sum + startWidths[item], 0) || 1
    let given = 0
    flex.forEach((item, itemIndex) => {
      if (itemIndex === flex.length - 1) {
        next[item] = startWidths[item] + (grow - given)
      } else {
        const add = (grow * startWidths[item]) / base
        next[item] = startWidths[item] + add
        given += add
      }
    })
  }
  return next.map((width) => width / total)
}

function Cell({ cell, color }) {
  if (cell.kind === 'empty') return <strong>—</strong>
  if (cell.kind === 'yesno') {
    return (
      <ChoiceBars
        color={color}
        total={cell.n}
        items={[
          { label: 'Yes', count: cell.yes, pct: cell.pct },
          { label: 'No', count: cell.n - cell.yes, pct: cell.n ? 1 - cell.pct : 0 },
        ]}
      />
    )
  }
  if (cell.kind === 'number') {
    return (
      <strong>
        {formatNumber(cell.sum, Number.isInteger(cell.sum) ? 0 : 1)}
        {cell.n > 1 ? <em> avg {formatNumber(cell.avg, 1)}</em> : null}
      </strong>
    )
  }
  return <ChoiceBars color={color} total={cell.n} items={cell.items} />
}

function ChoiceBars({ items, total, color }) {
  const visible = (items || []).filter((item) => item.count > 0)
  if (!visible.length) return <strong>—</strong>
  return (
    <div className="choice-bars">
      {visible.map((item) => (
        <div className="choice-bar" key={item.label} title={`${item.label}: ${item.count}/${total}`}>
          <span className="choice-bar-label">
            {item.label}
            <em>{item.count}/{total}</em>
          </span>
          <span className="choice-bar-track" aria-hidden="true">
            <span style={{ width: `${Math.max(4, Math.round(item.pct * 100))}%`, background: color }} />
          </span>
        </div>
      ))}
    </div>
  )
}
