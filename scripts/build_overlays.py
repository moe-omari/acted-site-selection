"""Convert neighborhood and site-extent KML files into GeoJSON layers."""

import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from approvals import approved_site_codes
from extent_match import load_sites, site_for_extent_name

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "src" / "data"
NS = {"k": "http://www.opengis.net/kml/2.2"}
CODE = re.compile(r"[A-Za-z]{3}\d{3,5}")
EXTENT_FILES = [
    Path(r"d:\downloads\Sites extent.kml"),
    Path(r"d:\downloads\Khan Younis - At Tahrir sites extent.kml"),
]


def clean(value):
    return (value or "").replace("\u200f", "").replace("\u200e", "").replace("\t", " ").strip()


def kml_color(value):
    text = clean(value).lower()
    if len(text) != 8:
        return None
    alpha = int(text[0:2], 16) / 255
    blue, green, red = text[2:4], text[4:6], text[6:8]
    return {"color": f"#{red}{green}{blue}", "opacity": round(alpha, 3)}


def ring(text):
    points = []
    for token in (text or "").replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        points.append([round(float(parts[0]), 6), round(float(parts[1]), 6)])
    if len(points) >= 2 and points[0] != points[-1]:
        points.append(points[0])
    return points


def style_index(root):
    styles = {}
    for node in root.findall("k:Document/k:Style", NS):
        line = node.findtext("k:LineStyle/k:color", default="", namespaces=NS)
        fill = node.findtext("k:PolyStyle/k:color", default="", namespaces=NS)
        styles[node.attrib.get("id", "")] = {"line": kml_color(line), "fill": kml_color(fill)}
    maps = {}
    for node in root.findall("k:Document/k:StyleMap", NS):
        for pair in node.findall("k:Pair", NS):
            if clean(pair.findtext("k:key", default="", namespaces=NS)) == "normal":
                url = clean(pair.findtext("k:styleUrl", default="", namespaces=NS)).lstrip("#")
                maps[node.attrib.get("id", "")] = styles.get(url, {})
    return maps


def polygon_rings(polygon):
    rings = []
    outer = polygon.findtext("k:outerBoundaryIs/k:LinearRing/k:coordinates", default="", namespaces=NS)
    outer_ring = ring(outer)
    if len(outer_ring) >= 4:
        rings.append(outer_ring)
    for inner in polygon.findall("k:innerBoundaryIs/k:LinearRing/k:coordinates", NS):
        inner_ring = ring(inner.text)
        if len(inner_ring) >= 4:
            rings.append(inner_ring)
    return rings


def geometry(mark):
    polygons = [polygon_rings(node) for node in mark.findall(".//k:Polygon", NS)]
    polygons = [item for item in polygons if item]
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    if len(polygons) > 1:
        return {"type": "MultiPolygon", "coordinates": polygons}
    line = mark.findtext(".//k:LineString/k:coordinates", default="", namespaces=NS)
    points = ring(line)
    if len(points) >= 2:
        return {"type": "LineString", "coordinates": points}
    return None


def data_fields(mark):
    fields = {}
    for item in mark.findall(".//k:Data", NS):
        fields[item.attrib.get("name", "")] = clean(item.findtext("k:value", default="", namespaces=NS))
    return fields


def paint(style_url, styles):
    style = styles.get(clean(style_url).lstrip("#"), {})
    line = style.get("line") or {}
    fill = style.get("fill") or {}
    return {
        "stroke": line.get("color") or fill.get("color") or "#37352f",
        "fill": fill.get("color") or line.get("color") or "#37352f",
        "fillOpacity": fill.get("opacity", 0.12),
    }


def write(path, features):
    path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"wrote {len(features)} features to {path}")


def build_neighborhoods():
    root = ET.parse(r"d:\downloads\Gaza Neighborhoods.kml").getroot()
    styles = style_index(root)
    features = []
    seen = set()
    for index, mark in enumerate(root.findall(".//k:Placemark", NS), start=1):
        geom = geometry(mark)
        if not geom:
            continue
        fields = data_fields(mark)
        name = fields.get("Neighbourh") or clean(mark.findtext("k:name", default="", namespaces=NS))
        code = fields.get("PCODE_Neig") or f"n-{index}"
        feature_id = code if code not in seen else f"{code}-{index}"
        seen.add(feature_id)
        population = fields.get("Population")
        projected = fields.get("Pop_projec")
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": feature_id,
                    "name": name,
                    "governorate": fields.get("Governorat", ""),
                    "municipality": fields.get("Name_Munic", ""),
                    "population": int(population) if population and population.isdigit() else None,
                    "projected": int(projected) if projected and projected.isdigit() else None,
                    **paint(mark.findtext("k:styleUrl", default="", namespaces=NS), styles),
                },
                "geometry": geom,
            }
        )
    write(DATA / "neighborhoods.json", features)


def extent_parts(name):
    match = CODE.search(name)
    if not match:
        return name, name
    code = match.group(0).upper()
    label = (name[: match.start()] + " " + name[match.end() :]).strip(" -")
    return code, label or code


MANUAL_EXTENT_LINKS = {
    "مضلع 75": ("KYS3750", "Al-Jazeera"),
    "مضلع 72": ("ACT1604", "الحياة 2"),
    "مضلع 71": ("ACT1603", "الحياة 1"),
    "مضلع 4": ("KYS4094", "Al Rahma alGharbi"),
    "مضلع 76": ("ACT1203", "المسلخ"),
    "karama": ("KYS1318", "Al-Karama"),
    "اليمامه": ("KYS5128", "Al Yamamah Site"),
    "Al Majd 3": ("ACT1400", "Al Majd 3"),
    "RFH5288": ("ACT1207", "نسيم السلطان"),
    "Naseem Al Sultan": ("ACT1207", "نسيم السلطان"),
    "الحياة المهمشين": ("KYS3818", "Al-Hayat"),
    "رحماء": ("KYS3930", "Al Astal"),
    "مضلع 67": ("ACT1402", "AL KARAM ALALBANI"),
    "ACT1109": ("KYS4238", "Al-Ikhlas Site"),
    "الاقصى": ("ACT1105", "الاقصى"),
    "KYS1601": ("KYS5690", "Al-Khaleej"),
    "KYS1605": ("KYS5715", "Dream Plus"),
    "RFH4985": ("ACT1403", "Ajyal 2"),
    "Ajyal 2": ("ACT1403", "Ajyal 2"),
    "زهرة المدائن": ("ACT103", "Zahrat Al-Madaen"),
    "alhabasha": ("KYS5319", "Al Habsha"),
    "ACT3004": ("KYS5319", "Al Habsha"),
    "al zaytona": ("KYS5593", "Al-Zaitona"),
    "ACT3002": ("KYS5593", "Al-Zaitona"),
    "alhorrya 2": ("KYS5320", "Al-Hurriya 2"),
    "ACT3003": ("KYS5320", "Al-Hurriya 2"),
    "Al-Taawun2": ("ACT1301", "Al-Taawun2"),
}

MANUAL_ACT_CODES = {
    "ACT1109": "ACT1109",
    "KYS1601": "ACT1601",
    "KYS1605": "ACT1605",
}


def manual_extent_link(*names):
    for name in names:
        link = MANUAL_EXTENT_LINKS.get(clean(name))
        if link:
            return link
    return None


def build_extents():
    alias = approved_site_codes()
    sites = load_sites(DATA / "catalog.json")
    known_ids = {site["id"].upper() for site in sites}
    features = []
    seen = set()
    remapped = 0
    named = 0
    for path in EXTENT_FILES:
        root = ET.parse(path).getroot()
        styles = style_index(root)
        for index, mark in enumerate(root.findall(".//k:Placemark", NS), start=1):
            geom = geometry(mark)
            if not geom:
                continue
            raw = clean(mark.findtext("k:name", default="", namespaces=NS))
            code, label = extent_parts(raw)
            official = alias.get(code, code)
            manual = manual_extent_link(raw, code, label)
            if manual:
                official, label = manual
            elif official.upper() not in known_ids:
                matched = site_for_extent_name(label, geom, sites)
                if matched:
                    official = matched
                    named += 1
            if official != code:
                remapped += 1
            feature_id = official if official not in seen else f"{official}-{path.stem}-{index}"
            seen.add(feature_id)
            properties = {
                "id": feature_id,
                "code": official,
                "name": label,
                "label": raw,
                **paint(mark.findtext("k:styleUrl", default="", namespaces=NS), styles),
            }
            if code in MANUAL_ACT_CODES:
                properties["actCode"] = MANUAL_ACT_CODES[code]
            elif code.upper().startswith("ACT") and official != code and not str(official).upper().startswith("ACT"):
                properties["actCode"] = code
            features.append({"type": "Feature", "properties": properties, "geometry": geom})
    write(DATA / "extents.json", features)
    print(f"remapped {remapped} extent codes, {named} by nearby name")


if __name__ == "__main__":
    build_neighborhoods()
    build_extents()
