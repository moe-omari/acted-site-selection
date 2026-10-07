"""Build the managed site extents layer from the September footprint KML."""

import re
import xml.etree.ElementTree as ET
from pathlib import Path

from build_overlays import CODE, DATA, NS, clean, kml_color, paint, write

MANAGED_EXTENT = Path(r"d:\downloads\ACTED — site extents (R2, updated 10 Sep)2 (1).kml")


def style_book(root):
    styles = {}
    for node in root.findall(".//k:Style", NS):
        line = kml_color(node.findtext("k:LineStyle/k:color", default="", namespaces=NS))
        fill = kml_color(node.findtext("k:PolyStyle/k:color", default="", namespaces=NS))
        styles[node.attrib.get("id", "")] = {"line": line, "fill": fill}
    for node in root.findall(".//k:StyleMap", NS):
        for pair in node.findall("k:Pair", NS):
            if clean(pair.findtext("k:key", default="", namespaces=NS)) == "normal":
                url = clean(pair.findtext("k:styleUrl", default="", namespaces=NS)).lstrip("#")
                styles[node.attrib.get("id", "")] = styles.get(url, {})
    return styles


def plain_text(html):
    text = re.sub(r"<br\s*/?>", "\n", html or "", flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return clean(text)


def description_fields(html):
    fields = {}
    for line in plain_text(html).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = clean(value)
    return fields


def whole_number(value):
    text = (value or "").replace(",", "").strip()
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    return None


def line_points(mark):
    text = mark.findtext(".//k:LineString/k:coordinates", default="", namespaces=NS)
    points = []
    for token in (text or "").replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        points.append([round(float(parts[0]), 6), round(float(parts[1]), 6)])
    return points


def build():
    root = ET.parse(MANAGED_EXTENT).getroot()
    styles = style_book(root)
    features = []
    seen = set()
    for index, mark in enumerate(root.findall(".//k:Placemark", NS), start=1):
        points = line_points(mark)
        if len(points) < 2:
            continue
        closed = len(points) >= 4 and points[0] == points[-1]
        geom = (
            {"type": "Polygon", "coordinates": [points]}
            if closed
            else {"type": "LineString", "coordinates": points}
        )
        raw = clean(mark.findtext("k:name", default="", namespaces=NS))
        fields = description_fields(mark.findtext("k:description", default="", namespaces=NS))
        code = (fields.get("Site ID") or "").upper()
        if not code:
            match = CODE.search(raw)
            code = match.group(0).upper() if match else ""
        name = fields.get("Site Name") or raw or "Managed extent"
        if not code and name.casefold() in {"al mawasi", "at tahrir", "خط ممنوع تجاوزه"}:
            continue
        feature_id = code if code and code not in seen else f"{code or 'managed-extent'}-{index}"
        seen.add(feature_id)
        painted = paint(mark.findtext("k:styleUrl", default="", namespaces=NS), styles)
        if painted["fillOpacity"] < 0.08:
            painted["fillOpacity"] = 0.16
        properties = {
            "id": feature_id,
            "code": code,
            "name": name,
            "label": raw,
            **painted,
        }
        for source, key in (
            ("Site Name (Arabic)", "nameAr"),
            ("Displacement Type", "siteType"),
            ("Site Status", "status"),
            ("Managing Agency", "agency"),
            ("Implementing Partner", "partner"),
            ("Governorate", "governorate"),
            ("Neighborhood", "neighborhood"),
            ("Management", "management"),
            ("Why", "why"),
            ("Flag", "flag"),
        ):
            value = fields.get(source)
            if value:
                properties[key] = value
        households = whole_number(fields.get("Total Households"))
        individuals = whole_number(fields.get("Total Individuals"))
        if households is not None:
            properties["households"] = households
        if individuals is not None:
            properties["individuals"] = individuals
        if not code:
            note = plain_text(mark.findtext("k:description", default="", namespaces=NS))
            if note and note != name:
                properties["note"] = note
        features.append({"type": "Feature", "properties": properties, "geometry": geom})
    write(DATA / "managed-extents.json", features)


if __name__ == "__main__":
    build()
