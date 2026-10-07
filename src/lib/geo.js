export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (degrees) => (degrees * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function ringCentroid(ring) {
  const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
  const points = closed ? ring.slice(0, -1) : ring.slice()
  if (!points.length) return null
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % points.length]
    const cross = x1 * y2 - x2 * y1
    area += cross
    cx += (x1 + x2) * cross
    cy += (y1 + y2) * cross
  }
  area *= 0.5
  const average = {
    lon: points.reduce((sum, pair) => sum + pair[0], 0) / points.length,
    lat: points.reduce((sum, pair) => sum + pair[1], 0) / points.length,
  }
  const weighted = Math.abs(area) < 1e-12 ? null : { lon: cx / (6 * area), lat: cy / (6 * area) }
  if (weighted && pointInRing(weighted.lat, weighted.lon, ring)) return weighted
  if (pointInRing(average.lat, average.lon, ring)) return average
  const lons = points.map((pair) => pair[0])
  const lats = points.map((pair) => pair[1])
  const minLon = Math.min(...lons)
  const maxLon = Math.max(...lons)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const box = { lon: (minLon + maxLon) / 2, lat: (minLat + maxLat) / 2 }
  if (pointInRing(box.lat, box.lon, ring)) return box
  let best = null
  let bestDistance = Infinity
  const steps = 12
  for (let y = 0; y <= steps; y += 1) {
    for (let x = 0; x <= steps; x += 1) {
      const lon = minLon + ((maxLon - minLon) * x) / steps
      const lat = minLat + ((maxLat - minLat) * y) / steps
      if (!pointInRing(lat, lon, ring)) continue
      const distance = (lon - box.lon) ** 2 + (lat - box.lat) ** 2
      if (distance >= bestDistance) continue
      best = { lon, lat }
      bestDistance = distance
    }
  }
  return best || { lon: points[0][0], lat: points[0][1] }
}

export function pointInRing(lat, lon, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = (yi > lat) !== (yj > lat)
    if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function nearest(origin, points) {
  let best = null
  let distance = Infinity
  for (const point of points) {
    const km = haversineKm(origin.lat, origin.lon, point.lat, point.lon)
    if (km < distance) {
      best = point
      distance = km
    }
  }
  return best ? { point: best, km: distance } : null
}

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) => row.map(escapeCell).join(','))
    .join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function ringsOverlap(a, b) {
  const left = closeRing(a)
  const right = closeRing(b)
  if (left.some(([lon, lat]) => pointInRing(lat, lon, right))) return true
  if (right.some(([lon, lat]) => pointInRing(lat, lon, left))) return true
  for (let i = 0; i < left.length - 1; i += 1) {
    for (let j = 0; j < right.length - 1; j += 1) {
      if (segmentsCross(left[i], left[i + 1], right[j], right[j + 1])) return true
    }
  }
  return false
}

function closeRing(ring) {
  if (ring.length < 2) return ring
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) return ring
  return [...ring, first]
}

function segmentsCross(p, q, r, s) {
  const d1 = cross(s[0] - r[0], s[1] - r[1], p[0] - r[0], p[1] - r[1])
  const d2 = cross(s[0] - r[0], s[1] - r[1], q[0] - r[0], q[1] - r[1])
  const d3 = cross(q[0] - p[0], q[1] - p[1], r[0] - p[0], r[1] - p[1])
  const d4 = cross(q[0] - p[0], q[1] - p[1], s[0] - p[0], s[1] - p[1])
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx
}

function escapeCell(value) {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}
