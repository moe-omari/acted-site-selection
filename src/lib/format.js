export function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

export function formatCount(value) {
  const digits = Number.isInteger(value) ? 0 : 1
  return formatNumber(value, digits)
}

export function formatGap(value) {
  const rounded = Math.round(value)
  if (rounded === 0) return 'On target'
  const text = formatNumber(Math.abs(rounded))
  return rounded > 0 ? `+${text}` : `−${text}`
}

export function formatKm(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${formatNumber(value, value < 10 ? 2 : 1)} km`
}

export function formatCoord(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}
