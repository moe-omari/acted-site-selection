"""Link an unnamed or ACT footprint to a site with a similar name sitting on it."""

import json
import math
import re
import unicodedata
from difflib import SequenceMatcher

NEAR_METERS = 80


def norm(value):
    text = unicodedata.normalize("NFKD", value or "").lower()
    text = text.replace("’", " ").replace("'", " ").replace("_", " ").replace("-", " ")
    for source, target in (
        ("jazeera", "jazira"),
        ("jazayir", "jazira"),
        ("jazera", "jazira"),
        ("taawun", "tawun"),
        ("taawon", "tawun"),
        ("tawoon", "tawun"),
        ("horrya", "hurya"),
        ("hurriya", "hurya"),
        ("huria", "hurya"),
        ("hayat", "haya"),
        ("hayah", "haya"),
    ):
        text = text.replace(source, target)
    text = re.sub(r"[^a-z0-9\u0600-\u06ff\s]", " ", text)
    tokens = []
    for token in text.split():
        if token in {"site", "camp", "the"}:
            continue
        if token.startswith("al") and len(token) > 4:
            token = token[2:]
        if token and token != "al":
            tokens.append(token)
    return " ".join(tokens)


def number_key(text):
    numbers = re.findall(r"\d+", norm(text))
    return numbers[-1] if numbers else ""


def names_match(left, right):
    a, b = norm(left), norm(right)
    if not a or not b or number_key(left) != number_key(right):
        return False
    if a == b:
        return True
    return SequenceMatcher(None, a, b).ratio() >= 0.84


def haversine_m(lat1, lon1, lat2, lon2):
    radius = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    half = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * radius * math.asin(min(1, math.sqrt(half)))


def outer_ring(geometry):
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        return coordinates[0]
    if geometry["type"] == "MultiPolygon":
        return coordinates[0][0]
    return coordinates


def contains(lat, lon, ring):
    inside = False
    for index, point in enumerate(ring):
        lon_i, lat_i = point
        lon_j, lat_j = ring[index - 1]
        crosses = (lat_i > lat) != (lat_j > lat)
        if crosses and lon < (lon_j - lon_i) * (lat - lat_i) / ((lat_j - lat_i) or 1e-12) + lon_i:
            inside = not inside
    return inside


def meters_to_ring(lat, lon, ring):
    if contains(lat, lon, ring):
        return 0
    best = 1e12
    for index, point in enumerate(ring):
        lon1, lat1 = ring[index - 1]
        lon2, lat2 = point
        for step in range(9):
            weight = step / 8
            best = min(
                best,
                haversine_m(lat, lon, lat1 + (lat2 - lat1) * weight, lon1 + (lon2 - lon1) * weight),
            )
    return best


def load_sites(catalog_path):
    if not catalog_path.exists():
        return []
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    sites = []
    for kind in ("candidates", "managed"):
        sites.extend(catalog.get(kind, []))
    return sites


def site_for_extent_name(label, geometry, sites):
    ring = outer_ring(geometry)
    best = None
    for site in sites:
        if site.get("lat") is None or site.get("lon") is None:
            continue
        if not names_match(label, site.get("name", "")):
            continue
        meters = meters_to_ring(site["lat"], site["lon"], ring)
        if meters > NEAR_METERS:
            continue
        if best is None or meters < best[0]:
            best = (meters, site["id"])
    return best[1] if best else None
