"""Rebuild data/baytown.js and tools/districts.json from the City of Baytown's official GIS.

Run from the project folder:
    python3 tools/fetch_city_gis.py tools/city_gis     # download (needs access to mapdata.baytown.org)
    python3 tools/build_baytown.py                      # build data/baytown.js + tools/districts.json
    node tools/make_tests.js                            # build data/tests.js

Needs: pip install shapely
Sources: Street Centerlines, City Limit and BFD Fire Districts layers on mapdata.baytown.org;
school locations from NCES EDGE (public 2024-25, private 2023-24).
"""
import json, re
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union, linemerge

SRC = "tools/city_gis/"
OUT = "data/baytown.js"

# ---------------------------------------------------------------- districts & city limits
def polys(g):
    return list(g.geoms) if hasattr(g, "geoms") else [g]

districts = {}
for f in json.load(open(SRC + "fire_districts.geojson"))["features"]:
    n = str(int(f["properties"]["FIRE_DISTR"]))
    g = shape(f["geometry"]).buffer(0).simplify(0.00003)
    districts[n] = [[[round(y, 5), round(x, 5)] for x, y in p.exterior.coords] for p in polys(g) if p.area > 1e-7]
json.dump(districts, open("tools/districts.json", "w"))

city = unary_union([shape(f["geometry"]).buffer(0) for f in json.load(open(SRC + "city_limit.geojson"))["features"]])
dist_union = unary_union([shape(f["geometry"]).buffer(0) for f in json.load(open(SRC + "fire_districts.geojson"))["features"]])
clip = city.union(dist_union).buffer(0.0015)

# ---------------------------------------------------------------- street names
KEEP = {"LOCAL", "ARTERIAL", "COLLECT", "MAJOR", "HWY", "FREEWAY", "PRIVATE", "FRONTAGE"}
SKIP_WORDS = re.compile(r"\b(RAMP|GATE|FRONTAGE|EXIT|ENTRANCE|U-?TURN|CROSSOVER|ROADS)\b")
TYPES = {"ST": "Street", "AVE": "Avenue", "AV": "Avenue", "RD": "Road", "DR": "Drive", "LN": "Lane", "CT": "Court",
         "CIR": "Circle", "BLVD": "Boulevard", "WAY": "Way", "WY": "Way", "TRL": "Trail", "PL": "Place",
         "PKWY": "Parkway", "CRK": "Creek", "CV": "Cove", "BND": "Bend", "LP": "Loop", "LOOP": "Loop",
         "VW": "View", "HWY": "Highway", "HY": "Highway", "TER": "Terrace", "SQ": "Square", "XING": "Crossing",
         "PT": "Point", "RUN": "Run", "PASS": "Pass", "TRCE": "Trace", "HOLW": "Hollow", "GLN": "Glen",
         "RDG": "Ridge", "LNDG": "Landing", "PLZ": "Plaza", "CSWY": "Causeway", "EXPY": "Expressway"}
DIRS = {"N": "North", "S": "South", "E": "East", "W": "West"}
SMALL = {"OF", "THE", "AND", "DE", "LA", "DEL"}


def word(w, first):
    if re.match(r"^\d+(ST|ND|RD|TH)$", w):
        return w.lower()
    if w in SMALL and not first:
        return w.lower()
    if re.match(r"^MC[A-Z]", w, re.I):
        return "Mc" + w[2:].capitalize()
    if w in ("FM", "US", "CR", "II", "III"):
        return w
    return w.capitalize()


def nice(raw):
    """Official city name (e.g. 'N MAIN ST') -> (display name, [extra aliases]) or None to skip."""
    r = re.sub(r"\s+", " ", (raw or "").replace("THE END !", "")).strip().upper()
    r = re.sub(r" (NB|SB|EB|WB)$", "", r)
    if not r or re.match(r"^\d{3,}\b", r):
        return None
    if r.startswith("IH 10"):
        return "Interstate 10", ["I-10", "IH 10", "IH-10", "I 10", "East Freeway"]
    if re.search(r"SH 146 (BS|BUS)", r):
        return "Business Highway 146", ["Business 146", "SH 146 Business", "Hwy 146 Business"]
    if "SH 146" in r:
        return "Highway 146", ["SH 146", "Hwy 146", "State Highway 146", "Texas 146", "North Highway 146", "South Highway 146"]
    if "GRAND PKWY" in r:
        return "Grand Parkway", ["SH 99", "Highway 99", "Hwy 99", "State Highway 99"]
    if r == "SPUR 330":
        return "Spur 330", ["State Spur 330", "SS 330"]
    m = re.match(r"^FM (\d+)( RD)?$", r)
    if m:
        return "FM " + m.group(1), ["FM " + m.group(1) + " Road", "Farm to Market " + m.group(1)]
    t = r.split()
    out = []
    if t[0] == "AVE" and len(t) == 2:
        return "Avenue " + t[1], ["Ave " + t[1]]
    if t[0] in DIRS and len(t) > 1:
        out.append(DIRS[t[0]]); t = t[1:]
    trail = None
    if len(t) > 1 and t[-1] in DIRS:
        trail = DIRS[t[-1]]; t = t[:-1]
    typ = None
    if len(t) > 1 and t[-1] in TYPES:
        typ = TYPES[t[-1]]; t = t[:-1]
    out += [word(w, i == 0 and not out) for i, w in enumerate(t)]
    if typ: out.append(typ)
    if trail: out.append(trail)
    return " ".join(out), []


# Local corrections that override the city data: rename (or drop, with "rename": null) the segments
# of a street whose midpoint falls inside a bounding box [west, south, east, north].
CORR = json.load(open("tools/street_corrections.json"))

def corrected(raw, g):
    for c in CORR:
        if raw.upper() == c["match"].upper():
            w, so, e, n = c["bbox"]
            mid = g.interpolate(0.5, normalized=True)
            if w <= mid.x <= e and so <= mid.y <= n:
                return c["rename"]
    return raw

streets = {}
skipped = {}
for f in json.load(open(SRC + "centerlines.geojson"))["features"]:
    p = f["properties"]
    cls = (p.get("ROAD_CLASS") or "").strip()
    raw = (p.get("FULL_NAME") or "").strip()
    if cls not in KEEP or not raw or SKIP_WORDS.search(raw.upper()):
        skipped[cls] = skipped.get(cls, 0) + 1
        continue
    if not f.get("geometry"):
        continue
    g = shape(f["geometry"])
    if not g.intersects(clip):
        continue
    raw = corrected(raw, g)
    # The city marks proposed streets with asterisks ("** = PROPOSED STREETS"); strip them, but remember.
    proposed = bool(raw) and "*" in raw
    raw = raw.replace("*", "").strip() if raw else raw
    if not raw:
        continue
    res = nice(raw)
    if not res:
        continue
    name, extra = res
    s = streets.setdefault(name, {"geoms": [], "aliases": set(), "built": False})
    s["built"] = s["built"] or not proposed
    s["major"] = s.get("major", False) or cls in ("ARTERIAL", "MAJOR", "HWY", "FREEWAY")
    s["geoms"].append(g.intersection(clip))
    s["aliases"].update(extra)
    # Abbreviated forms of the official name ("Garth Rd") are matched by the scorer, so they are not listed.
    # The city's ALIAS field holds old/alternate names (e.g. 'Mockingbird Ln' for Mockingbird St); not accepted.

out_streets = []
for name, s in sorted(streets.items()):
    u = unary_union(s["geoms"])
    m = linemerge(u) if u.geom_type == "MultiLineString" else u
    lines = []
    for part in (m.geoms if hasattr(m, "geoms") else [m]):
        if part.geom_type != "LineString" or part.length < 0.00015:
            continue
        part = part.simplify(0.00003)
        lines.append([[round(y, 5), round(x, 5)] for x, y in part.coords])
    if lines:
        al = sorted(a for a in s["aliases"] if a.lower() != name.lower())
        st = {"name": name, "aliases": al, "lines": lines}
        if s.get("major"):
            st["major"] = True  # city road class ARTERIAL / MAJOR / HWY / FREEWAY
        if not s["built"]:
            st["review"] = "City GIS marks this street as proposed (**). Check that it has been built; it starts unchecked."
        out_streets.append(st)

# ---------------------------------------------------------------- schools (NCES EDGE); official GCCISD naming
SCHOOLS = [
    ("Alamo Elementary School", [], 29.793794, -94.962483),
    ("Ashbel Smith Elementary School", [], 29.732959, -94.96105),
    ("Austin Elementary School", ["Stephen F. Austin Elementary School", "SF Austin Elementary"], 29.7656, -94.92883),
    ("Bañuelos Elementary School", ["Banuelos Elementary School"], 29.812026, -94.986416),
    ("Bowie Elementary School", ["James Bowie Elementary School"], 29.743965, -94.946041),
    ("Carver Elementary School", ["George Washington Carver Elementary School"], 29.728771, -94.972936),
    ("Clark Elementary School", [], 29.783676, -94.914625),
    ("Crockett Elementary School", ["Davy Crockett Elementary School"], 29.774287, -94.955221),
    ("De Zavala Elementary School", ["DeZavala Elementary School", "Lorenzo de Zavala Elementary School"], 29.723878, -94.955904),
    ("Harlem Elementary School", [], 29.801677, -95.009965),
    ("Highlands Elementary School", [], 29.820146, -95.054322),
    ("Hopper Primary School", ["Bonnie P. Hopper Primary School", "Hopper Primary"], 29.822315, -95.054012),
    ("Lamar Elementary School", ["Mirabeau B. Lamar Elementary School"], 29.739518, -94.969648),
    ("Pumphrey Elementary School", ["Jessie Lee Pumphrey Elementary School"], 29.827896, -94.987283),
    ("San Jacinto Elementary School", [], 29.728124, -95.000752),
    ("Travis Elementary School", ["William B. Travis Elementary School"], 29.776406, -95.034271),
    ("Victoria Walker Elementary School", ["Walker Elementary School"], 29.813358, -94.984545),
    ("Sheila Liles Early Learning Academy", ["Liles Early Learning Academy", "Sheila C. Liles Early Learning Academy", "Liles ELA"], 29.776062, -94.967972),
    ("Baytown Junior School", ["Baytown Junior High School", "Baytown JH", "Baytown JS"], 29.778077, -95.032985),
    ("Cedar Bayou Junior School", ["Cedar Bayou Junior High School", "Cedar Bayou JH", "Cedar Bayou JS"], 29.752082, -94.934951),
    ("E.F. Green Junior School", ["EF Green Junior High School", "Green Junior School", "EF Green JS", "Edward F. Green Junior School"], 29.824589, -94.975591),
    ("Gentry Junior School", ["Gentry Junior High School", "George H. Gentry Junior School", "Gentry JH", "Gentry JS"], 29.794565, -94.941836),
    ("Highlands Junior School", ["Highlands Junior High School", "Highlands JH", "Highlands JS"], 29.820107, -95.040159),
    ("Horace Mann Junior School", ["Horace Mann Junior High School", "Mann Junior School", "Horace Mann JH", "Horace Mann JS"], 29.725238, -94.95881),
    ("Goose Creek Memorial High School", ["Memorial High School", "GCM", "Goose Creek Memorial"], 29.824537, -94.970989),
    ("Lee High School", ["Robert E. Lee High School", "Baytown Lee High School", "REL"], 29.730882, -94.986478),
    ("Sterling High School", ["Ross S. Sterling High School", "Ross Sterling High School"], 29.771133, -94.969445),
    ("IMPACT Early College High School", ["Impact Early College", "Impact High School"], 29.732981, -94.981611),
    ("Stuart Career Tech High School", ["Stuart Career and Technical High School", "Stuart Career Tech", "Stuart CTHS"], 29.756272, -94.966615),
    ("Peter E. Hyland Center", ["Hyland Center"], 29.742293, -94.981762),
    ("POINT Alternative Center", ["Point Alternative Center", "POINT"], 29.806039, -95.051775),
    ("High Point School", [], 29.802512, -94.989537),
    ("Baytown Christian Academy", ["BCA"], 29.78495, -94.966411),
]
schools = [{"name": n, "aliases": a, "point": [la, lo]} for n, a, la, lo in SCHOOLS]

# ---------------------------------------------------------------- waterways
# City GIS streams + water bodies, plus named Census water areas the city layer lacks (e.g. Tabbs Bay).
# Each waterway is clipped to every fire district it is in: >= 200 m of stream or >= 2 ha of water.
import shapefile
from shapely.geometry import Polygon as SPolygon

WCFG = json.load(open("tools/waterway_names.json"))
STREAM_FIX = {"MC GEE GULLY": "McGee Gully", "SAN JACINTO RIVER AUTHORITY CA": "San Jacinto River Authority Canal",
              "SAN JACINTO RIVER AUTHORITY": "San Jacinto River Authority Canal", "H L AND P CANAL": "HL&P Canal",
              "BUCK GULLY CEDAR BAYOU": "Buck Gully", "BLUFF GULLY SAN JACINTO RIVER": "Bluff Gully",
              "PINE GULLY CEDAR BAYOU": "Pine Gully", "ELLIS BRANCH CEDAR BAYOU": "Ellis Branch"}
# Skip ditches/pipes/ponds, bare type words ("Creek"), highway-named drains, and the city's catch-all
# "TRINITY BAY" polygon (it covers Tabbs Bay, Galveston Bay etc.; the named bays come from other entries).
WATER_SKIP = re.compile(r"ROAD|PIPE|DITCH|DRAIN|146|RETENTION|PLANT|POND|SUMP|DREG|CENTERLINE|EXXON|"
                        r"^(LAKE|CREEK|BAYOU|GULLY|CANAL|BAY|RIVER)$|^TRINITY BAY$", re.I)
CENSUS_ABBR = {"Byu": "Bayou", "Lk": "Lake", "Cnl": "Canal", "Chnnl": "Channel", "Riv": "River", "Crk": "Creek", "Res": "Reservoir"}
WATER_ALIASES = {"HL&P Canal": ["HL and P Canal", "H L and P Canal", "HLP Canal"], "McGee Gully": ["Mc Gee Gully"]}


def wname(raw):
    r = re.sub(r"\s+", " ", (raw or "")).strip()
    if not r or WATER_SKIP.search(r):
        return None
    if r.upper() in STREAM_FIX:
        return STREAM_FIX[r.upper()]
    return " ".join(w if w in ("of", "and") else (w.capitalize() if w.isupper() or w.islower() else w) for w in r.split())


water = {}  # name -> {"lines": [...shapely], "polys": [...shapely]}
for f in json.load(open(SRC + "water_streams.geojson"))["features"]:
    n = wname(f["properties"].get("FENAME"))
    if n and f.get("geometry"):
        water.setdefault(n, {"lines": [], "polys": []})["lines"].append(shape(f["geometry"]))
for f in json.load(open(SRC + "water_bodies.geojson"))["features"]:
    p = f["properties"]
    n = wname(p.get("NAME") or p.get("Label_1"))
    if n and f.get("geometry"):
        water.setdefault(n, {"lines": [], "polys": []})["polys"].append(shape(f["geometry"]).buffer(0))
city_water = unary_union([g for w in water.values() for g in w["polys"]]) if water else None
for county in ("48201", "48071"):
    for sr in shapefile.Reader(f"{SRC}census_areawater/tl_2025_{county}_areawater.shp").iterShapeRecords():
        raw = sr.record["FULLNAME"]
        if not raw:
            continue
        g = shape(sr.shape.__geo_interface__).buffer(0)
        if not g.intersects(clip):
            continue
        if city_water is not None and g.intersection(city_water).area > 0.5 * g.area:
            continue  # the city layer already has this water (under its own name)
        n = " ".join(CENSUS_ABBR.get(w, w) for w in raw.split())
        if WATER_SKIP.search(n):
            continue
        water.setdefault(n, {"lines": [], "polys": []})["polys"].append(g)

for old, new in (WCFG.get("rename") or {}).items():
    if old in water:
        water.setdefault(new, {"lines": [], "polys": []})
        water[new]["lines"] += water[old]["lines"]; water[new]["polys"] += water[old]["polys"]
        del water[old]
drop = {d.lower() for d in WCFG.get("drop", [])}
required_w = {r.lower() for r in WCFG.get("required", [])}

dist_polys = {k: unary_union([SPolygon([(lo, la) for la, lo in r]) for r in v]).buffer(0) for k, v in districts.items()}
M_PER_DEG = 111000.0
out_water = []
for name in sorted(water):
    if name.lower() in drop:
        continue
    if WCFG.get("onlyRequired") and name.lower() not in required_w:
        continue
    w = water[name]
    L = unary_union(w["lines"]) if w["lines"] else None
    P = unary_union(w["polys"]) if w["polys"] else None
    per = {}
    for k, dp in dist_polys.items():
        inL = L.intersection(dp) if L is not None else None
        inP = P.intersection(dp) if P is not None else None
        len_m = inL.length * M_PER_DEG if inL is not None and not inL.is_empty else 0
        area_m2 = inP.area * M_PER_DEG * M_PER_DEG * 0.87 if inP is not None and not inP.is_empty else 0
        if len_m < 200 and area_m2 < 20000:
            continue
        show = dp.buffer(0.003)  # draw a little past the district edge
        ent = {"lines": [], "polys": []}
        if L is not None:
            for part in polys(L.intersection(show)):
                if part.geom_type == "LineString" and part.length > 0.0002:
                    ent["lines"].append([[round(y, 5), round(x, 5)] for x, y in part.simplify(0.00004).coords])
        if P is not None:
            for part in polys(P.intersection(show)):
                if part.geom_type == "Polygon" and part.area > 2e-7:
                    ent["polys"].append([[round(y, 5), round(x, 5)] for x, y in part.simplify(0.00006).exterior.coords])
        # label point: inside the district, on the water
        if inP is not None and not inP.is_empty and area_m2 >= 20000:
            big = max(polys(inP), key=lambda g: g.area)
            pt = big.representative_point()
        else:
            lines_in = [g for g in polys(inL) if g.geom_type == "LineString"]
            pt = max(lines_in, key=lambda g: g.length).interpolate(0.5, normalized=True)
        ent["point"] = [round(pt.y, 5), round(pt.x, 5)]
        per[k] = ent
    if not per:
        continue
    al = sorted(set(WATER_ALIASES.get(name, []) + list((WCFG.get("local") or {}).get(name, []))))
    item = {"name": name, "aliases": al, "districts": per}
    if name.lower() in required_w:
        item["required"] = True
    out_water.append(item)
missing_req = sorted(required_w - {w["name"].lower() for w in out_water})
print("waterways", len(out_water), "| required not found:", missing_req or "none")

limits = [[[round(y, 5), round(x, 5)] for x, y in p.simplify(0.00005).exterior.coords] for p in polys(city) if p.area > 1e-7]
data = {
    "source": "Streets, city limits, fire districts and waterways: City of Baytown GIS (mapdata.baytown.org); extra named water areas: U.S. Census TIGER 2025. Schools: NCES EDGE school geocodes.",
    "cityLimits": limits,
    "streets": out_streets,
    "schools": schools,
    "waterways": out_water,
}
with open(OUT, "w") as f:
    f.write("/* Baytown, TX reference data. " + data["source"] + " */\n")
    f.write("window.BAYTOWN = " + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n")
print("streets", len(out_streets), "| districts", {k: len(v) for k, v in districts.items()}, "| skipped by class", skipped)
