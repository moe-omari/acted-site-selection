"""Convert the Gaza block KML into src/data/blocks.geojson."""

import json
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KML = Path(r"d:\downloads\6) IF Gaza Split.kml")
OUT = ROOT / "src" / "data" / "blocks.json"
NS = {"k": "http://www.opengis.net/kml/2.2"}


def clean(value):
    return (value or "").replace("\u200f", "").replace("\u200e", "").strip()


def ring(text):
    points = []
    for token in text.replace("\n", " ").split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        points.append([round(float(parts[0]), 6), round(float(parts[1]), 6)])
    if points and points[0] != points[-1]:
        points.append(points[0])
    return points


def main():
    root = ET.parse(KML).getroot()
    features = []
    for mark in root.findall(".//k:Placemark", NS):
        data = {}
        for item in mark.findall(".//k:Data", NS):
            data[item.attrib.get("name", "")] = clean(item.findtext("k:value", default="", namespaces=NS))
        name = clean(mark.findtext("k:name", default="", namespaces=NS))
        coordinates = ring(mark.findtext(".//k:coordinates", default="", namespaces=NS))
        if len(coordinates) < 4:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "id": name,
                    "name": name,
                    "governorate": data.get("Governorate", ""),
                },
                "geometry": {"type": "Polygon", "coordinates": [coordinates]},
            }
        )
    collection = {"type": "FeatureCollection", "features": features}
    OUT.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(features)} blocks to {OUT}")


if __name__ == "__main__":
    main()
