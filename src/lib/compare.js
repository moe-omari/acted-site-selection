import registers from '../data/registers.json'
import { actRows, areaPopulation, verificationRows } from './areas'
import { formatNumber } from './format'

const headers = registers.verification.headers

const SECTOR_RULES = [
  ['Land and tenure', /land ownership|ownership type|ground rent|rent per household|permission|agreement type|vacate/i],
  ['Site management', /committee|training|list of site residents|women involved|source of information|network coverage|communal lighting|communal heating|site first established|residents stayed/i],
  ['Priorities', /priority/i],
  ['Nutrition', /MUAC/i],
  ['Education', /learning space|education service|school age|Who is running/i],
  ['Health', /health facility|medical assistance|barriers residents face in using these health/i],
  ['Food', /food assistance|ration|source of food|energy source used for cooking|functioning market/i],
  ['Sanitation', /toilet|latrine|soap|environmental health|problems in the past 30 days/i],
  ['Water', /water/i],
  ['Shelter', /shelter|tent|building|sleeping outdoors|source of lighting/i],
  ['Safety and access', /explosive|ordnance|EO victim|drainage|rainwater|pathway|vehicles|fire hazard|physical hazard/i],
  ['Population', /population|household|individual|MALES|FEMALES|children_|adult_|elderly_|headed|UNACCOMPANIED|SEPARATED|disability|chronic|pregnant|lactating|arrived|left the site|fhh_|chh_|uasc_|unacc_|sep_proportion|male_total|female_total|total_|est_hh|avg_indiv|effective_pop|small_site/i],
  ['Site profile', /typology|Site Status|Interview type|type of assessment|no longer active|could the site not be found/i],
]

function skipped(header) {
  const text = String(header || '').trim()
  if (!text) return true
  if (text.length > 280) return true
  return /phone|focal point the person|name of the|gender of the|person's role|Case ID|^Url$|^Site ID$|^Site Name$|Form Site|Created Date|Date of interview|date_format|Region Information|additional comments|^description$|consent to your name|My name is|Verify that the figures/i.test(text)
}

function sectorName(header) {
  for (const [name, pattern] of SECTOR_RULES) {
    if (pattern.test(header)) return name
  }
  return 'Other'
}

const questions = []
const grouped = new Map()
headers.forEach((header, index) => {
  if (skipped(header)) return
  const sector = sectorName(header)
  if (!grouped.has(sector)) grouped.set(sector, [])
  const question = { header, index, label: header.replace(/\s+/g, ' ').trim() }
  grouped.get(sector).push(question)
  questions.push(question)
})

const sectorOrder = [...SECTOR_RULES.map(([name]) => name), 'Other']

function filledValues(values) {
  return values.map((value) => (value == null ? '' : String(value).trim())).filter(Boolean)
}

function maskParens(value) {
  return value.replace(/\([^)]*\)/g, (match) => match.replace(/,/g, '\u0001'))
}

function unmask(value) {
  return value.replace(/\u0001/g, ',')
}

function commaPieces(value) {
  return maskParens(value).split(/,\s+/).map((part) => unmask(part).trim()).filter(Boolean)
}

function looksLikeSentence(part) {
  return part.length > 80 || /[.!?]/.test(part)
}

function shouldSplitCommas(groups) {
  const all = groups.flat()
  const pieces = all.map(commaPieces)
  const multi = pieces.filter((parts) => parts.length > 1 && parts.every((part) => !looksLikeSentence(part)))
  if (!multi.length) return false
  if (multi.every((parts) => /^(yes|no)$/i.test(parts[0]))) return false
  const standalone = new Set(all.filter((value) => commaPieces(value).length === 1))
  const seen = new Map()
  for (const parts of multi) {
    for (const part of new Set(parts)) seen.set(part, (seen.get(part) || 0) + 1)
  }
  const recurring = [...seen.values()].filter((count) => count > 1).length
  return multi.some((parts) => parts.some((part) => standalone.has(part))) || recurring >= 2
}

function answerParts(value, splitComma) {
  const semi = value.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean)
  const parts = semi.length > 1 ? semi : [value]
  if (!splitComma) return parts
  return parts.flatMap((part) => {
    const bits = commaPieces(part)
    if (bits.length < 2 || bits.some(looksLikeSentence) || /^(yes|no)$/i.test(bits[0])) return [part]
    return bits
  })
}

function categoryCells(groups) {
  const splitComma = shouldSplitCommas(groups)
  const counts = groups.map((values) => {
    const tally = new Map()
    for (const value of values) {
      for (const part of answerParts(value, splitComma)) {
        tally.set(part, (tally.get(part) || 0) + 1)
      }
    }
    return tally
  })
  const totals = new Map()
  counts.forEach((tally) => {
    for (const [label, count] of tally) totals.set(label, (totals.get(label) || 0) + count)
  })
  let labels = [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)
  if (!splitComma && labels.length > 6) labels = labels.slice(0, 6)
  return counts.map((tally, index) => {
    if (!groups[index].length) return { kind: 'empty' }
    const n = groups[index].length
    return {
      kind: 'category',
      n,
      items: labels.map((label) => ({
        label,
        count: tally.get(label) || 0,
        pct: (tally.get(label) || 0) / n,
      })),
    }
  })
}

function summarize(values) {
  const filled = filledValues(values)
  if (!filled.length) return { kind: 'empty' }
  const numeric = filled.every((value) => /^-?\d[\d,]*(\.\d+)?$/.test(value))
  if (numeric) {
    const numbers = filled.map((value) => Number(value.replace(/,/g, '')))
    const sum = numbers.reduce((total, value) => total + value, 0)
    return {
      kind: 'number',
      sum,
      avg: sum / numbers.length,
      n: numbers.length,
    }
  }
  if (filled.every((value) => /^(yes|no)$/i.test(value))) {
    const yes = filled.filter((value) => /^yes$/i.test(value)).length
    return { kind: 'yesno', yes, n: filled.length, pct: yes / filled.length }
  }
  return null
}

export function compareAreas(areas, dots) {
  const columns = areas.map((area) => {
    const rows = verificationRows(area.ring, dots)
    const act = actRows(area.ring, dots)
    const population = areaPopulation(rows, act, area.ring, dots)
    return {
      id: area.id,
      name: area.name,
      color: area.color,
      verification: rows.length,
      act: act.length,
      hhs: population.hhs,
      individuals: population.individuals,
      rows,
    }
  })
  const sectors = sectorOrder.flatMap((name) => {
    const items = grouped.get(name) || []
    const rows = items.flatMap((question) => {
      const groups = columns.map((column) => filledValues(column.rows.map((row) => row[question.index])))
      const direct = groups.map(summarize)
      const cells = direct.every((cell) => cell) ? direct : categoryCells(groups)
      if (cells.every((cell) => cell.kind === 'empty')) return []
      return [{ label: question.label, cells }]
    })
    if (!rows.length) return []
    return [{ name, rows }]
  })
  return {
    columns: columns.map(({ rows, ...column }) => column),
    sectors,
    questionCount: questions.length,
  }
}
