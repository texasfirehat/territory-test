# Baytown Fire Department – Territory Test

A website for proctored territory tests. Firefighters see a district map with every name removed and type in the name of each numbered street, school and landmark. The site scores the test when they submit it.

It's a static site with no server or database, and it runs on GitHub Pages.

## What's included

- **Every named street in Baytown and its fire districts (1,686 of them),** with the city limits and the seven BFD fire districts. All of this comes from the City of Baytown's official GIS (mapdata.baytown.org). Ramps, parking-lot roads, gates, proposed and vacated streets, and right-of-way-only segments are left out. The data file is `data/baytown.js`.
- **All 32 Goose Creek CISD campuses (Goose Creek Virtual Academy is left out on purpose) and Baytown Christian Academy.** The locations come from the U.S. Dept. of Education (NCES) school files: public schools for 2024-25 and private schools for 2023-24. Each school's name is the one firefighters would use, and alternate names are also accepted, e.g. "Baytown Junior High" for Baytown Junior School, or "Robert E. Lee High School".
- **Ready-made tests:** one for each of the seven BFD fire districts, plus "All Schools in BFD Districts", which covers every school inside the districts. Each district test asks 30 random streets from the district plus every school in it.

## District boundaries

The district boundaries come from the city's GIS layer **BT_FIRE_District**, the same districts the dispatch (CAD) system uses. In a few places they differ from the *Baytown Fire Response Districts* PDF map:
- District 6 also covers the area between its PDF parcels and I-10.
- District 3 also covers the gap south of District 6.
- District 4 also includes the southern marsh.

Streets right on a district line can appear in both districts' tests.

Five schools are outside every fire district, so they aren't tested anywhere: Harlem Elementary, Highlands Elementary, Hopper Primary, Highlands Junior and the POINT Alternative Center.

## Updating from the city GIS

When the city updates its streets or districts, rebuild from the project folder:

```bash
python3 tools/fetch_city_gis.py tools/city_gis
```

```bash
python3 tools/build_baytown.py
```

```bash
node tools/make_tests.js
```

The first command downloads the city's layers, the second builds `data/baytown.js` and `tools/districts.json`, and the third builds `data/tests.js`. You need Python with `shapely` installed (`pip install shapely`) and Node.js.

### Local name corrections

Sometimes the city data doesn't match what's on the ground. You can override a name in `tools/street_corrections.json`. Each entry renames the segments of one street whose midpoint falls inside a box (`[west, south, east, north]` in longitude and latitude). Use `"rename": null` to leave a segment out. Corrections are reapplied on every rebuild.

Current corrections:
- Taft Dr east of Narcille St is renamed Taft Circle.

Rebuilding with `make_tests.js` replaces any edits made in the builder, such as unchecked streets and landmarks. Rebuild first, then make your edits.

## Pages

| Page | Who uses it | What it does |
|---|---|---|
| `index.html` | Firefighters | They enter their name, pick a test, and type the name of each numbered item on the map. Clicking an item on the map jumps to its field, and the field being typed in is highlighted on the map. After they submit, they see their score, PASS/FAIL, the correct answer for each miss, and a green/red map. They can print the results (or save them as a PDF) or download a CSV. |
| `builder.html` | Administrators | Creates districts, chooses what's tested, previews the test and exports `tests.js`. |

## Adding a fire district

1. Open `builder.html` and click **+ New district**. Name it something like "District 4 – Station 4".
2. Click **1. Draw boundary**, click the corners of the district on the map, then click **Finish**. The grey dotted line is the city limits.
3. Click **2. Add Baytown streets & schools**. This adds every street and school inside the boundary.
4. Review the list:
   - Uncheck streets you don't want tested. Unchecked streets still show as grey lines on the map.
   - Optionally, click **+ Landmarks from OpenStreetMap** to pull in hospitals, churches, parks and so on (they start unchecked), or use **+ Place landmark** to place your own.
5. Under **Scoring & display settings**, set **Streets asked per test**. The default is 30. Each attempt draws a new random set of streets from the district, and every checked school and landmark is always asked.
6. Click **Preview test** to try it. Then click **Download tests.js** and replace `data/tests.js` in the GitHub repository (see below).

Your work in progress is saved in your browser, so you can close the page and come back. **Download tests.js** is the only way to publish it. **Open file…** loads a `tests.js` you exported earlier.

## Scoring

- Capitalization, punctuation and accents don't matter.
- Common abbreviations are accepted: St/Street, Ave, Rd, Blvd, N/North, 1st/First, Elem, HS, JH, and so on.
- For schools, the word "School" can be left off.
- **Strict** street matching (the default) requires the street type, so "Garth" is wrong for "Garth Road". **Lenient** matching makes the type and direction optional.
- The passing score, time limit and typo tolerance are all settings in the builder.

## Hosting on GitHub Pages

1. Create a repository on GitHub and push this folder to it.
2. In the repository, go to **Settings → Pages**. Set **Source** to *Deploy from a branch*, choose `main`, choose the `/ (root)` folder, and click **Save**.
3. After a minute or two the site is live at `https://<your-account>.github.io/<repository-name>/`. The builder is at `.../builder.html`.

To publish a new or changed test, upload a new `data/tests.js`. You can do this on github.com with **Add file → Upload files**. The site updates within a minute or two.

Note that a public repository means anyone with the link can open the site, including the builder. The builder can only change your own browser's copy until someone uploads a new `tests.js`. Since your tests are proctored, that's fine.

## Sources

- Streets, city limits and fire districts: City of Baytown GIS (mapdata.baytown.org)
- School locations: NCES EDGE school geocodes (public 2024-25, private 2023-24)
