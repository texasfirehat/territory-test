"""Rebuild data/baytown.js (run from the project folder: python3 tools/build_baytown.py <tiger-folder>).

Needs: pip install pyshp shapely. Download and unzip into <tiger-folder>:
  https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_48201_roads.zip  (Harris County)
  https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_48071_roads.zip  (Chambers County)
  https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_48_place.zip     (city limits)

Build data/baytown.js from Census TIGER 2025 (roads + city limits) and NCES school locations."""
import json, re, shapefile
from shapely.ops import unary_union
from shapely.geometry import shape, LineString, MultiLineString, Point
from shapely.ops import unary_union, linemerge

import sys
SRC = (sys.argv[1] if len(sys.argv) > 1 else "tiger") + "/"  # folder with the unzipped TIGER files
OUT = "data/baytown.js"

# ---- City limits
city = None
for sr in shapefile.Reader(SRC + "tl_2025_48_place.shp").iterShapeRecords():
    if sr.record["NAME"] == "Baytown":
        city = shape(sr.shape.__geo_interface__)
assert city is not None
# Fire districts reach past the city limits in places (marsh, ETJ); include them too.
from shapely.geometry import Polygon as _P
_d = json.load(open("tools/districts_traced.json"))
_dist = unary_union([_P([(lo, la) for la, lo in ring]) for rings in _d.values() for ring in rings])
clip = city.union(_dist).buffer(0.0015)  # ~150 m, so streets along the edges are kept

# ---- Street name expansion (TIGER uses abbreviations)
TYPES = {"St": "Street", "Ave": "Avenue", "Rd": "Road", "Dr": "Drive", "Ln": "Lane", "Blvd": "Boulevard",
         "Ct": "Court", "Pl": "Place", "Pkwy": "Parkway", "Hwy": "Highway", "Cir": "Circle", "Ter": "Terrace",
         "Trl": "Trail", "Sq": "Square", "Way": "Way", "Aly": "Alley", "Expy": "Expressway", "Fwy": "Freeway",
         "Cv": "Cove", "Pt": "Point", "Xing": "Crossing", "Loop": "Loop", "Run": "Run", "Pass": "Pass",
         "Holw": "Hollow", "Grv": "Grove", "Hl": "Hill", "Hls": "Hills", "Crk": "Creek", "Bnd": "Bend",
         "Gln": "Glen", "Vw": "View", "Rdg": "Ridge", "Cres": "Crescent", "Mdw": "Meadow", "Mdws": "Meadows",
         "Spgs": "Springs", "Est": "Estates", "Ests": "Estates", "Pnes": "Pines", "Psge": "Passage",
         "Walk": "Walk", "Row": "Row", "Park": "Park", "Plz": "Plaza", "Lndg": "Landing", "Vis": "Vista",
         "Trce": "Trace", "Path": "Path", "Cswy": "Causeway", "Hbr": "Harbor", "Is": "Island", "Pike": "Pike",
         "Brg": "Bridge", "Byu": "Bayou", "Clfs": "Cliffs", "Cyn": "Canyon", "Frk": "Fork", "Frst": "Forest",
         "Hts": "Heights", "Jct": "Junction", "Knl": "Knoll", "Lk": "Lake", "Lks": "Lakes", "Mnr": "Manor",
         "Orch": "Orchard", "Oval": "Oval", "Pr": "Prairie", "Rnch": "Ranch", "Shrs": "Shores", "Vly": "Valley",
         "Vlg": "Village", "Wls": "Wells", "Cmns": "Commons", "Ctr": "Center", "Spur": "Spur", "Ramp": "Ramp", "Lp": "Loop", "Crst": "Crest"}
DIRS = {"N": "North", "S": "South", "E": "East", "W": "West", "NE": "Northeast", "NW": "Northwest",
        "SE": "Southeast", "SW": "Southwest"}


def expand(name):
    t = name.split()
    if not t:
        return name
    if t[0] == "Ave" and len(t) == 2:
        return "Avenue " + t[1]
    if t[0] == "FM" and len(t) >= 2:
        return "FM " + t[1]
    if t[0] in DIRS and len(t) > 1:
        t[0] = DIRS[t[0]]
    if t[-1] in DIRS and len(t) > 2:
        t[-1] = DIRS[t[-1]]
        if t[-2] in TYPES:
            t[-2] = TYPES[t[-2]]
    elif t[-1] in TYPES and len(t) > 1:
        t[-1] = TYPES[t[-1]]
    return " ".join(t)


def is_highway(name):
    return bool(re.match(r"^(I-|Interstate|US Hwy|State Hwy|Tx-|FM |Farm-to-Market|Spur |Loop \d|Sh |Hwy \d|State Rte)", name, re.I))


streets = {}
for fn in ["tl_2025_48201_roads.shp", "tl_2025_48071_roads.shp"]:
    for sr in shapefile.Reader(SRC + fn).iterShapeRecords():
        rec = sr.record
        name = (rec["FULLNAME"] or "").strip()
        if not name or rec["MTFCC"] not in ("S1100", "S1200", "S1400"):
            continue
        geom = shape(sr.shape.__geo_interface__)
        if not geom.intersects(clip):
            continue
        g = geom.intersection(clip)
        if g.is_empty:
            continue
        streets.setdefault(name, []).append(g)

out_streets = []
for raw, geoms in streets.items():
    u = unary_union(geoms)
    merged = linemerge(u) if u.geom_type == "MultiLineString" else u
    parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    lines = []
    for p in parts:
        if p.geom_type != "LineString" or p.length < 0.0002:
            continue
        p = p.simplify(0.00003)
        lines.append([[round(y, 5), round(x, 5)] for x, y in p.coords])
    if not lines:
        continue
    full = expand(raw)
    aliases = [raw] if raw != full else []
    out_streets.append({"name": full, "aliases": aliases, "lines": lines, "hwy": is_highway(raw)})

# Combine entries that expanded to the same name (e.g. "Garth Rd" and "Garth Road")
combined = {}
for s in out_streets:
    c = combined.setdefault(s["name"], {"name": s["name"], "aliases": [], "lines": [], "hwy": s["hwy"]})
    c["lines"] += s["lines"]
    c["aliases"] = sorted(set(c["aliases"] + s["aliases"]))
# TIGER often leaves the type off some segments ("Garth" next to "Garth Road").
# Fold a bare name into the typed street when exactly one typed street has that base.
TYPE_WORDS = set(TYPES.values())
by_base = {}
for n in combined:
    w = n.split()
    if len(w) > 1 and w[-1] in TYPE_WORDS:
        by_base.setdefault(" ".join(w[:-1]), []).append(n)
for n in list(combined):
    if n in by_base or n not in combined:
        pass
    w = n.split()
    if w[-1] in TYPE_WORDS:
        continue
    targets = by_base.get(n, [])
    if len(targets) == 1:
        t = combined[targets[0]]
        t["lines"] += combined[n]["lines"]
        del combined[n]
    else:
        combined[n]["review"] = "Census data has no street type for this name; check the correct name"

# Friendlier highway names, keeping the Census form as an accepted answer
HWY = {
    "I- 10": ("Interstate 10", ["I-10", "IH 10", "IH-10", "I 10", "East Freeway"]),
    "State Hwy 146": ("Highway 146", ["State Highway 146", "SH 146", "Hwy 146", "Texas 146"]),
    "State Hwy 146E Bus": ("Business Highway 146", ["Business 146", "SH 146 Business", "Hwy 146 Business", "State Highway 146E Business"]),
    "State Hwy 99": ("Grand Parkway", ["State Highway 99", "SH 99", "Highway 99", "Hwy 99"]),
    "State Spur 330": ("Spur 330", ["State Spur 330", "SS 330"]),
}
for raw, (nice, al) in HWY.items():
    if raw in combined:
        s = combined.pop(raw)
        s["name"] = nice
        s["aliases"] = sorted(set(s["aliases"] + al + [raw]))
        s.pop("review", None)
        combined[nice] = s

out_streets = sorted(combined.values(), key=lambda s: s["name"])
for s in out_streets:
    if s.get("hwy") or s["name"].startswith(("FM ", "Avenue ")):
        s.pop("review", None)
    if s["name"].startswith("FM "):
        s["aliases"] = sorted(set(s["aliases"] + [s["name"] + " Road", "Farm to Market " + s["name"][3:]]))
    if not s["hwy"]:
        del s["hwy"]

# ---- Schools (NCES EDGE 2024-25 public, 2023-24 private); official GCCISD naming
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
schools = [{"name": n, "aliases": a, "point": [la, lo], "inCity": city.contains(Point(lo, la))} for n, a, la, lo in SCHOOLS]

# City limits as list of rings [[lat, lon], ...]
polys = list(city.geoms) if city.geom_type == "MultiPolygon" else [city]
limits = [[[round(y, 5), round(x, 5)] for x, y in p.simplify(0.00005).exterior.coords] for p in polys]

data = {
    "source": "Streets and city limits: U.S. Census Bureau TIGER/Line 2025. Schools: NCES EDGE school geocodes (public 2024-25, private 2023-24).",
    "cityLimits": limits,
    "streets": out_streets,
    "schools": schools,
}
with open(OUT, "w") as f:
    f.write("/* Baytown, TX reference data. " + data["source"] + " */\n")
    f.write("window.BAYTOWN = " + json.dumps(data, separators=(",", ":")) + ";\n")
print("streets", len(out_streets), "highways", sum(1 for s in out_streets if s.get("hwy")),
      "rings", len(limits), "schools outside city:", [s["name"] for s in schools if not s["inCity"]])
