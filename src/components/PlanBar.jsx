import { useEffect, useRef, useState } from 'react'
import { formatCount, formatGap, formatNumber } from '../lib/format'
import { useAppState } from '../state'

export default function PlanBar() {
  const { catalog, stats, areaFilter, selectArea, definedAreas, areaCounts, targets, setPlanTarget, setAreaTarget } = useAppState()
  const householdGap = stats.hhs - targets.households
  const peopleGap = stats.individuals - targets.individuals

  return (
    <div className="planbar">
      <div className={areaFilter === 'all' ? 'plan-card is-on' : 'plan-card'}>
        <button type="button" className="plan-card-body" onClick={() => selectArea('all')}>
          <span className="kicker">Whole plan</span>
          <strong>{formatNumber(stats.sites)} sites</strong>
          <span className="metrics">
            <em>{formatNumber(stats.hhs)} HH</em>
            <em className={gapClass(householdGap)}>{formatGap(householdGap)} HH</em>
          </span>
          <span className="metrics">
            <em>{formatNumber(stats.individuals)} individuals</em>
            <em className={gapClass(peopleGap)}>{formatGap(peopleGap)}</em>
          </span>
          <span className="track">
            <span style={{ width: trackWidth(stats.individuals, targets.individuals) }} />
          </span>
        </button>
        <span className="target">
          <span className="target-edit">
            Target
            <TargetInput
              value={targets.individuals}
              label="Whole plan target individuals"
              onCommit={(individuals) => setPlanTarget({ individuals })}
            />
            individuals ·
            <TargetInput
              value={targets.households}
              label="Whole plan target households"
              onCommit={(households) => setPlanTarget({ households })}
            />
            HH
          </span>
        </span>
      </div>

      {catalog.areas.map((area) => {
        const featured = definedAreas.find((item) => item.parent === area.name && item.featured)
        const totals = featured ? areaCounts[featured.id] : null
        const bucket = stats.byArea[area.name]
        const goal = targets.areas[area.name]
        const people = (totals ? totals.individuals : bucket.individuals) - goal.individuals
        const households = (totals ? totals.hhs : bucket.hhs) - goal.hhs
        const individuals = totals ? totals.individuals : bucket.individuals
        const hhs = totals ? totals.hhs : bucket.hhs
        return (
          <div
            key={area.name}
            className={areaFilter === area.name ? 'plan-card is-on' : 'plan-card'}
            style={{ '--card': area.color }}
          >
            <button type="button" className="plan-card-body" onClick={() => selectArea(area.name)}>
              <span className="kicker">
                <i style={{ background: area.color }} />
                {area.neighborhood}
              </span>
              <strong>{featured ? featured.name : area.name}</strong>
              {featured ? (
                <span className="metrics">
                  <em>{formatNumber(totals.verification)} assessments</em>
                  <em>{formatNumber(totals.act)} ACT</em>
                </span>
              ) : (
                <span className="metrics">
                  <em>{formatNumber(bucket.sites)} sites</em>
                  <em>{formatNumber(bucket.hhs)} HH</em>
                </span>
              )}
              <span className="metrics">
                <em>{formatNumber(individuals)}</em>
                <em className={gapClass(people)}>{formatGap(people)}</em>
              </span>
              {featured ? (
                <span className="metrics">
                  <em>{formatCount(hhs)} HH</em>
                  <em className={gapClass(households)}>{formatGap(households)} HH</em>
                </span>
              ) : null}
              <span className="track">
                <span style={{ width: trackWidth(individuals, goal.individuals), background: area.color }} />
              </span>
            </button>
            <span className="target">
              <span className="target-edit">
                {featured ? `${area.name} · ` : ''}
                Target
                <TargetInput
                  value={goal.individuals}
                  label={`${area.name} target individuals`}
                  onCommit={(next) => setAreaTarget(area.name, { individuals: next })}
                />
                ·
                <TargetInput
                  value={goal.hhs}
                  label={`${area.name} target households`}
                  onCommit={(next) => setAreaTarget(area.name, { hhs: next })}
                />
                HH
              </span>
              {featured ? null : <span className={gapClass(households)}>{formatGap(households)} HH</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function TargetInput({ value, label, onCommit }) {
  const [text, setText] = useState(() => formatCount(value))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(formatCount(value))
  }, [value])

  const commit = () => {
    focused.current = false
    const parsed = Number(String(text).replace(/,/g, '').trim())
    if (!Number.isFinite(parsed) || parsed < 0) {
      setText(formatCount(value))
      return
    }
    onCommit(parsed)
    setText(formatCount(parsed))
  }

  return (
    <input
      className="target-input"
      aria-label={label}
      inputMode="decimal"
      value={text}
      title="Edit target"
      size={Math.max(4, text.length)}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => {
        focused.current = true
        event.target.select()
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

function trackWidth(value, target) {
  if (!target) return '0%'
  return `${Math.min(100, (value / target) * 100)}%`
}

function gapClass(value) {
  if (Math.round(value) > 0) return 'gap over'
  if (Math.round(value) < 0) return 'gap under'
  return 'gap ok'
}
