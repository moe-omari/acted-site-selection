"""Build src/data/zite-sites.json from the Zite Manager export.

Sites already represented on the map are left out.
"""
import json
import re
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\PC\Downloads\zitemanager_sites.xlsx")
TARGET = ROOT / "src" / "data" / "zite-sites.json"
POINT = re.compile(r"POINT\s*\(\s*([+-]?\d+(?:\.\d+)?)\s*[, ]\s*([+-]?\d+(?:\.\d+)?)\s*\)", re.I)


def text(value):
    return str(value or "").strip()


def norm(value):
    return text(value).upper()


def number(value):
    if value is None or value == "":
        return None
    try:
        amount = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if amount != amount:
        return None
    if amount.is_integer():
        return int(amount)
    return round(amount, 1)


def coordinate(value):
    if value is None or value == "":
        return None
    try:
        amount = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None
    if amount != amount:
        return None
    return round(amount, 6)


def point(value):
    match = POINT.search(text(value))
    if not match:
        return None, None
    lon = coordinate(match.group(1))
    lat = coordinate(match.group(2))
    if lat is None or lon is None:
        return None, None
    if not (31 <= lat <= 32.2 and 34 <= lon <= 34.7):
        return None, None
    return lat, lon


def add_code(known, value):
    key = norm(value)
    if key:
        known.add(key)


def feature_codes(feature, known):
    props = feature.get("properties") or {}
    for key in ("id", "code", "actCode"):
        add_code(known, props.get(key))


def known_ids():
    known = set()
    catalog = json.loads((ROOT / "src/data/catalog.json").read_text(encoding="utf-8"))
    for site in catalog.get("candidates", []):
        add_code(known, site.get("id"))
    for site in catalog.get("managed", []):
        add_code(known, site.get("id"))
    registers = json.loads((ROOT / "src/data/registers.json").read_text(encoding="utf-8"))
    verification = registers["verification"]
    for row in verification["rows"]:
        add_code(known, row[verification["siteId"]])
        add_code(known, row[verification["formSiteId"]])
    act = registers["act"]
    for row in act["rows"]:
        add_code(known, row[act["siteId"]])
        add_code(known, row[act["newSiteId"]])
    partners = json.loads((ROOT / "src/data/partner-sites.json").read_text(encoding="utf-8"))
    for site in partners:
        add_code(known, site.get("id"))
        add_code(known, site.get("key"))
    for name in ("extents.json", "managed-extents.json"):
        collection = json.loads((ROOT / "src/data" / name).read_text(encoding="utf-8"))
        for feature in collection.get("features", []):
            feature_codes(feature, known)
    return known


def column(headers, prefix):
    for index, name in enumerate(headers):
        if name.startswith(prefix):
            return index
    raise SystemExit(f"missing column {prefix}")


def main():
    known = known_ids()
    workbook = load_workbook(SOURCE, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = sheet.iter_rows(values_only=True)
    headers = [text(cell) for cell in next(rows)]
    site_id = column(headers, "Site ID")
    form_id = next(index for index, name in enumerate(headers) if name.endswith("/Site ID"))
    name = column(headers, "Site Name")
    name_ar = column(headers, "Site Information/Site Name (Arabic)")
    partner = column(headers, "Site Information/Implementing Partner")
    governorate = column(headers, "Region Information/First Level Region Name")
    neighborhood = column(headers, "Region Information/Second Level Region Name")
    site_type = column(headers, "Site Information/Site Type")
    status = column(headers, "Site Information/Site Status")
    individuals = column(headers, "Site demographics/Estimated number of individuals currently accommodated")
    total = column(headers, "Site demographics/total_population")
    households = column(headers, "Site demographics/Please review the below information/Estimated number of households")
    location = column(headers, "Site Information/Location")

    skipped_known = 0
    skipped_point = 0
    sites = {}
    for row in rows:
        if row is None:
            continue
        code = text(row[site_id])
        other = text(row[form_id])
        if not code:
            continue
        if norm(code) in known or (other and norm(other) in known):
            skipped_known += 1
            continue
        lat, lon = point(row[location])
        if lat is None:
            skipped_point += 1
            continue
        people = number(row[individuals])
        if people is None:
            people = number(row[total])
        current = sites.get(code)
        record = {
            "id": code,
            "name": text(row[name]) or code,
            "nameAr": text(row[name_ar]),
            "partner": text(row[partner]),
            "governorate": text(row[governorate]),
            "neighborhood": text(row[neighborhood]),
            "siteType": text(row[site_type]),
            "status": text(row[status]),
            "households": number(row[households]),
            "individuals": people,
            "lat": lat,
            "lon": lon,
        }
        if current is None or (people or 0) > (current["individuals"] or 0):
            sites[code] = record

    payload = list(sites.values())
    TARGET.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"kept {len(payload)} skipped_known {skipped_known} skipped_point {skipped_point}")


if __name__ == "__main__":
    main()
