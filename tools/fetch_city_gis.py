"""Download layers from the City of Baytown GIS (mapdata.baytown.org) as GeoJSON in WGS84.

Usage (from the project folder): python3 tools/fetch_city_gis.py tools/city_gis
"""
import json, sys, urllib.request, urllib.parse
BASE = "https://mapdata.baytown.org/arcgis/rest/services/"
OUT = sys.argv[1] if len(sys.argv) > 1 else "."

def fetch(path, name, where="1=1"):
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": where, "outFields": "*", "outSR": 4326, "f": "geojson",
                                    "resultOffset": offset, "resultRecordCount": 1000, "returnGeometry": "true"})
        with urllib.request.urlopen(BASE + path + "/query?" + q, timeout=120) as r:
            d = json.load(r)
        if "error" in d:
            raise RuntimeError(d["error"])
        got = d.get("features", [])
        feats += got
        if len(got) < 1000 and not d.get("exceededTransferLimit") and not d.get("properties", {}).get("exceededTransferLimit"):
            break
        offset += len(got)
        if not got:
            break
    json.dump({"type": "FeatureCollection", "features": feats}, open(f"{OUT}/{name}.geojson", "w"))
    print(name, len(feats))

fetch("testServices/BaytownCAD/MapServer/6", "fire_districts")
fetch("ArcgisOnline/COB_ProductionLayers/MapServer/8", "city_limit")
fetch("ArcgisOnline/BaytownLayers/MapServer/114", "fire_stations")
fetch("ArcgisOnline/COB_ProductionLayers/MapServer/2", "centerlines")
fetch("ArcgisOnline/BaytownLayers/MapServer/20", "water_streams")
fetch("ArcgisOnline/BaytownLayers/MapServer/21", "water_bodies")

# Census TIGER named water areas (fills bays the city layer lacks, e.g. Tabbs Bay)
import io, zipfile
for county in ("48201", "48071"):
    url = f"https://www2.census.gov/geo/tiger/TIGER2025/AREAWATER/tl_2025_{county}_areawater.zip"
    with urllib.request.urlopen(url, timeout=300) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(f"{OUT}/census_areawater")
    print("census areawater", county)
