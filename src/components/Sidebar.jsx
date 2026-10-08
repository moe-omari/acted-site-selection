import { useEffect, useRef, useState } from 'react'
import { useAppState } from '../state'
import { formatCount, formatNumber } from '../lib/format'

const SCOPES = [
  ['plan', 'Plan'],
  ['candidates', 'Candidates'],
  ['act', 'ACT'],
  ['managed', 'Managed'],
  ['aisha', 'Aisha'],
  ['crcs', 'CRCs'],
]

const LAYERS_HEIGHT_KEY = 'acted-map-layers-height'
const LIST_HEIGHT_KEY = 'acted-site-list-height'
const COLOR_NAMES = {
  '#c4554d': 'Red',
  '#0f7b6c': 'Green',
  '#d9730d': 'Orange',
  '#337ea9': 'Blue',
  '#9065b0': 'Purple',
  '#9c27b0': 'Violet',
  '#b3541e': 'Brown',
  '#2e7d32': 'Dark green',
}

function readSavedHeight(key) {
  const saved = Number(localStorage.getItem(key))
  return Number.isFinite(saved) && saved >= 72 ? saved : null
}

const LAYERS = [
  ['plan', 'Sites in the plan', '#337ea9'],
  ['other', 'Candidates outside the plan', '#9b9a97'],
  ['blocks', 'Gaza blocks', '#9C27B0'],
  ['neighborhoods', 'Neighborhoods', '#5c5b57'],
  ['extents', 'Site extents', '#3949ab'],
  ['unlinkedExtents', 'Unlinked site extents', '#c4554d'],
  ['act', 'ACT sites', '#3949ab'],
  ['managedExtents', 'Managed sites extents', '#3ca2e6'],
  ['managed', 'Currently managed', '#0f7b6c'],
  ['partners', 'Managed by partners', '#0e7490'],
  ['crcs', 'CRCs', '#d9730d'],
  ['aisha', 'Aisha safe spaces', '#e4549b'],
]

export default function Sidebar() {
  const {
    query,
    setQuery,
    scope,
    setScope,
    areaFilter,
    selectArea,
    catalog,
    layers,
    toggleLayer,
    rows,
    counts,
    focus,
    setFocus,
    setHover,
    plan,
    exportPlan,
    definedAreas,
    draft,
    draftCounts,
    namingId,
    setNamingId,
    areaCounts,
    startDraw,
    cancelDraw,
    finishDraw,
    editingId,
    editCounts,
    startEdit,
    cancelEdit,
    finishEdit,
    renameArea,
    setAreaColor,
    areaColors,
    toggleDefinedArea,
    deleteArea,
    featureArea,
    exportDefinedArea,
    exportApproved,
    drawingParent,
    openArea,
    openCompare,
  } = useAppState()

  const layersRef = useRef(null)
  const listRef = useRef(null)
  const [layersHeight, setLayersHeight] = useState(() => readSavedHeight(LAYERS_HEIGHT_KEY))
  const [listHeight, setListHeight] = useState(() => readSavedHeight(LIST_HEIGHT_KEY))
  const [colorId, setColorId] = useState(null)

  useEffect(() => {
    if (!colorId) return undefined
    const onPointer = (event) => {
      if (event.target.closest('.area-color, .color-picker')) return
      setColorId(null)
    }
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setColorId(null)
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [colorId])

  useEffect(() => {
    if (layersHeight == null) localStorage.removeItem(LAYERS_HEIGHT_KEY)
    else localStorage.setItem(LAYERS_HEIGHT_KEY, String(layersHeight))
  }, [layersHeight])

  useEffect(() => {
    if (listHeight == null) localStorage.removeItem(LIST_HEIGHT_KEY)
    else localStorage.setItem(LIST_HEIGHT_KEY, String(listHeight))
  }, [listHeight])

  function resizeLayers(event) {
    const panel = layersRef.current
    const handle = event.currentTarget
    if (!panel) return
    event.preventDefault()
    try { handle.setPointerCapture(event.pointerId) } catch { /* window listeners still follow the drag */ }
    const startY = event.clientY
    const startHeight = panel.getBoundingClientRect().height
    const room = panel.parentElement.getBoundingClientRect().height - 134
    const maxHeight = Math.max(120, room)
    function move(moveEvent) {
      const next = Math.round(Math.min(maxHeight, Math.max(120, startHeight + moveEvent.clientY - startY)))
      setLayersHeight(next)
    }
    function stop() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function resizeList(event) {
    const panel = listRef.current
    const handle = event.currentTarget
    if (!panel) return
    event.preventDefault()
    try { handle.setPointerCapture(event.pointerId) } catch { /* window listeners still follow the drag */ }
    const startY = event.clientY
    const startHeight = panel.getBoundingClientRect().height
    const areasHeight = panel.parentElement.querySelector('.areas-panel').getBoundingClientRect().height
    const maxHeight = startHeight + Math.max(0, areasHeight - 72)
    function move(moveEvent) {
      const next = Math.round(Math.min(maxHeight, Math.max(72, startHeight + startY - moveEvent.clientY)))
      setListHeight(next)
    }
    function stop() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  return (
    <aside className="sidebar">
      <header className="brand">
        <div>
          <h1>Site selection</h1>
          <p>Acted site management</p>
        </div>
      </header>

      <label className="search">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.4 10.4 13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search any site or ID"
          aria-label="Search sites"
        />
      </label>

      <div className="area-chips" role="group" aria-label="Areas">
        <button
          type="button"
          className={areaFilter === 'all' ? 'chip is-on' : 'chip'}
          onClick={() => selectArea('all')}
        >
          All areas
        </button>
        {catalog.areas.map((area) => (
          <button
            key={area.name}
            type="button"
            className={areaFilter === area.name ? 'chip is-on' : 'chip'}
            onClick={() => selectArea(area.name)}
          >
            <i style={{ background: area.color }} />
            {area.name}
          </button>
        ))}
      </div>

      <div className="scopes" role="tablist" aria-label="List">
        {SCOPES.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={scope === id}
            className={scope === id ? 'scope is-on' : 'scope'}
            onClick={() => setScope(id)}
          >
            {label}
            <span>{counts[id]}</span>
          </button>
        ))}
      </div>

      <div className="browse">
        <div
          className={layersHeight == null ? 'layers' : 'layers is-sized'}
          style={layersHeight == null ? undefined : { height: layersHeight }}
          ref={layersRef}
        >
          <div className="layers-label">Map layers</div>
          <div className="layers-body">
            {LAYERS.map(([id, label, color]) => (
              <label key={id} className="layer">
                <input type="checkbox" checked={layers[id]} onChange={() => toggleLayer(id)} />
                <i style={{ background: color }} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
        <div
          className="layers-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize areas and map layers"
          title="Drag to resize areas and map layers"
          onPointerDown={resizeLayers}
          onDoubleClick={() => setLayersHeight(null)}
        />
        <div className="areas-panel">
          <div className="area-block">
            <div className="area-block-head">
              <span>Areas</span>
              <span className="area-draw-actions">
                <button type="button" className="text-btn" title="Download every site verification assessment and every ACT site, with the map neighborhood, area, and dot coordinate for each one" onClick={exportApproved}>Export sites</button>
              </span>
            </div>
            {catalog.areas.map((target) => {
              const children = definedAreas.filter((area) => area.parent === target.name)
              const drawing = Boolean(draft) && drawingParent === target.name
              const editingChild = children.some((area) => area.id === editingId)
              return (
                <section key={target.name} className="area-group">
                  <div className="area-group-head">
                    <i style={{ background: target.color }} />
                    <strong>{target.name}</strong>
                    <span className="area-actions">
                      {drawing ? (
                        <>
                          <button type="button" onClick={finishDraw} disabled={draft.length < 3}>Finish</button>
                          <button type="button" onClick={cancelDraw}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => startDraw(target.name)} disabled={Boolean(draft) || Boolean(editingId)}>Add</button>
                          <button type="button" onClick={() => openCompare(target.name)} disabled={children.length < 2}>Compare</button>
                        </>
                      )}
                    </span>
                  </div>
                  {drawing ? (
                    <p className="area-hint">
                      {draft.length < 3
                        ? 'Click the map to trace it. Double-click to close it.'
                        : `${draftCounts.verification} ${draftCounts.verification === 1 ? 'site' : 'sites'} · ${draftCounts.act} ACT sites · ${formatCount(draftCounts.hhs)} HH · ${formatNumber(draftCounts.individuals)} individuals inside this outline.`}
                    </p>
                  ) : null}
                  {!drawing && editingChild ? (
                    <p className="area-hint">Drag a corner to move the boundary. Click a midpoint to add a corner. Double-click a corner to remove it.</p>
                  ) : null}
                  {children.length === 0 ? <p className="area-empty">No areas under {target.name} yet.</p> : null}
                  {children.map((area) => {
                    const editing = editingId === area.id
                    const totals = (editing ? editCounts : null) ?? areaCounts[area.id] ?? { verification: 0, act: 0, hhs: 0, individuals: 0 }
                    return (
                      <div key={area.id} className={editing ? 'area-row is-editing' : 'area-row'}>
                        <div className="area-title">
                          <input
                            type="checkbox"
                            checked={area.visible}
                            aria-label={`Show ${area.name}`}
                            onChange={() => toggleDefinedArea(area.id)}
                          />
                          <button
                            type="button"
                            className="area-color"
                            style={{ background: area.color }}
                            aria-label={`Change the color of ${area.name}`}
                            aria-expanded={colorId === area.id}
                            onClick={() => setColorId((current) => (current === area.id ? null : area.id))}
                          />
                          <input
                            className="area-name"
                            value={area.name}
                            aria-label="Area name"
                            autoFocus={namingId === area.id}
                            onFocus={(event) => event.target.select()}
                            onChange={(event) => renameArea(area.id, event.target.value)}
                            onBlur={() => {
                              if (!area.name.trim()) renameArea(area.id, 'Area')
                              setNamingId(null)
                            }}
                          />
                        </div>
                        {colorId === area.id ? (
                          <div className="color-picker" role="listbox" aria-label={`Colors for ${area.name}`}>
                            {areaColors.map((color) => (
                              <button
                                key={color}
                                type="button"
                                role="option"
                                aria-selected={color.toLowerCase() === area.color.toLowerCase()}
                                aria-label={COLOR_NAMES[color.toLowerCase()] || 'Color'}
                                style={{ background: color }}
                                onClick={() => {
                                  setAreaColor(area.id, color)
                                  setColorId(null)
                                }}
                              />
                            ))}
                          </div>
                        ) : null}
                        <span className="area-actions">
                          {editing ? (
                            <>
                              <button type="button" className="is-on" onClick={finishEdit}>Done</button>
                              <button type="button" onClick={cancelEdit}>Cancel</button>
                            </>
                          ) : (
                            <button
                              type="button"
                              title={`Edit the boundary of ${area.name}`}
                              onClick={() => startEdit(area.id)}
                              disabled={Boolean(draft) || Boolean(editingId)}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            className={area.featured ? 'is-on' : ''}
                            onClick={() => featureArea(area.id)}
                          >
                            {area.featured ? 'On card' : 'Use on card'}
                          </button>
                          <button type="button" onClick={() => openArea(area.id)}>Results</button>
                          <button type="button" onClick={() => exportDefinedArea(area.id)}>Export</button>
                          <button type="button" aria-label={`Remove ${area.name}`} onClick={() => deleteArea(area.id)}>Remove</button>
                        </span>
                        <button type="button" className="area-meta" onClick={() => openArea(area.id)}>
                          {totals.verification} {totals.verification === 1 ? 'site' : 'sites'} · {totals.act} ACT sites · {formatCount(totals.hhs)} HH · {formatNumber(totals.individuals)} individuals
                        </button>
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </div>
      </div>

      <div
        className="list-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize site list"
        title="Drag to resize the site list"
        onPointerDown={resizeList}
        onDoubleClick={() => setListHeight(null)}
      />
      <div
        className={listHeight == null ? 'list' : 'list is-sized'}
        style={listHeight == null ? undefined : { height: listHeight }}
        ref={listRef}
      >
        {rows.length === 0 ? <p className="empty">Nothing matches this view.</p> : null}
        {rows.map((row) => {
          const active = focus?.type === row.type && focus?.id === row.id
          return (
            <button
              key={`${row.type}-${row.id}`}
              type="button"
              className={active ? 'site-row is-on' : 'site-row'}
              onClick={() => setFocus({ type: row.type, id: row.id, source: query.trim() ? 'search' : 'list' })}
              onMouseEnter={() => setHover({ type: row.type, id: row.id })}
              onMouseLeave={() => setHover(null)}
            >
              {row.type === 'candidate' || row.type === 'act' ? (
                <span
                  className={plan.has(row.id) ? 'tick is-on' : 'tick'}
                  style={{ '--c': row.color }}
                  title={plan.has(row.id) ? 'In the plan' : undefined}
                />
              ) : (
                <span className="swatch" style={{ background: row.color }} />
              )}
              <span className="site-copy">
                <span className="site-title">{row.title}</span>
                <span className="site-sub">{row.subtitle}</span>
              </span>
              <span className="site-meta">{row.meta}</span>
            </button>
          )
        })}
      </div>

      <footer className="side-foot">
        <button type="button" className="text-btn" onClick={exportPlan}>
          Export plan
        </button>
      </footer>
    </aside>
  )
}
