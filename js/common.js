/* Shared helpers: answer normalization, scoring, map drawing. */
(function (global) {
  'use strict';

  // ---------- Answer normalization ----------
  const ABBREV = {
    st: 'street', str: 'street', ave: 'avenue', av: 'avenue', avn: 'avenue',
    rd: 'road', dr: 'drive', drv: 'drive', ln: 'lane', blvd: 'boulevard', bl: 'boulevard',
    ct: 'court', crt: 'court', pl: 'place', pkwy: 'parkway', pky: 'parkway',
    hwy: 'highway', cir: 'circle', ter: 'terrace', terr: 'terrace', trl: 'trail', tr: 'trail',
    sq: 'square', wy: 'way', aly: 'alley', expy: 'expressway', fwy: 'freeway',
    cres: 'crescent', cv: 'cove', pt: 'point', xing: 'crossing', loop: 'loop', run: 'run',
    n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
    mt: 'mount', ft: 'fort',
    elem: 'elementary', el: 'elementary', es: 'elementary school', ms: 'middle school',
    hs: 'high school', jr: 'junior', sr: 'senior', sch: 'school', schl: 'school',
    acad: 'academy', ctr: 'center', centre: 'center', hosp: 'hospital', twp: 'township',
    co: 'county', dept: 'department'
  };
  const ORDINALS = {
    first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th', sixth: '6th',
    seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th', eleventh: '11th', twelfth: '12th'
  };
  const STREET_TYPES = new Set(['street', 'avenue', 'road', 'drive', 'lane', 'boulevard', 'court',
    'place', 'parkway', 'highway', 'circle', 'terrace', 'trail', 'square', 'way', 'alley',
    'expressway', 'freeway', 'crescent', 'cove', 'point', 'crossing', 'loop', 'run', 'pike', 'row']);
  const DIRECTIONS = new Set(['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest']);

  function tokens(s) {
    s = String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '').replace(/\.(?=\S)/g, '');
    const split = s.split(/[^a-z0-9]+/).filter(Boolean);
    // Join runs of initials: "e f green" -> "ef green" (so "E. F. Green" = "EF Green").
    const raw = [];
    let lastWasInitial = false;
    for (const t of split) {
      const initial = /^[a-z]$/.test(t);
      if (initial && lastWasInitial) raw[raw.length - 1] += t; else raw.push(t);
      lastWasInitial = initial;
    }
    return raw.map((t, i) => {
      if (ORDINALS[t]) return ORDINALS[t];
      // "St" at the start of a name is usually "Saint" (St Johns Rd), elsewhere "Street".
      if (t === 'st') return (i === 0 && raw.length > 1) ? 'saint' : 'street';
      return ABBREV[t] || t;
    });
  }
  function normalize(s) { return tokens(s).join(' '); }

  // Lenient form for streets: drop street-type suffix and leading/trailing direction.
  function lenientStreet(s) {
    let t = tokens(s);
    if (t.length > 1 && DIRECTIONS.has(t[0])) t = t.slice(1);
    if (t.length > 1 && DIRECTIONS.has(t[t.length - 1])) t = t.slice(0, -1);
    if (t.length > 1 && STREET_TYPES.has(t[t.length - 1])) t = t.slice(0, -1);
    return t.join(' ');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  /**
   * Grade one answer. Returns {correct:boolean, note:string}.
   * settings.streetMatching: 'strict' (type e.g. "Ave" required) | 'lenient' (type + direction optional)
   * settings.allowTypos: one-letter slip allowed on answers of 6+ letters.
   */
  function gradeAnswer(item, answer, settings) {
    settings = settings || {};
    const given = normalize(answer);
    if (!given) return { correct: false, note: 'Blank' };
    const accepted = [item.name].concat(item.aliases || []).filter(Boolean);
    const lenient = settings.streetMatching === 'lenient' && item.type === 'street';
    const dropSchool = (s) => normalize(s).replace(/ school$/, '');
    const forms = (s) => item.type === 'school' ? [normalize(s), dropSchool(s)]
      : lenient ? [normalize(s), lenientStreet(s)] : [normalize(s)];
    const givenForms = forms(answer);
    for (const acc of accepted) {
      const accForms = forms(acc);
      if (givenForms.some(g => accForms.includes(g))) return { correct: true, note: '' };
    }
    if (settings.allowTypos) {
      for (const acc of accepted) {
        for (const a of forms(acc)) for (const g of givenForms) {
          if (a.replace(/ /g, '').length >= 6 && levenshtein(a, g) <= 1) return { correct: true, note: 'Accepted with minor spelling slip' };
        }
      }
    }
    return { correct: false, note: '' };
  }

  // ---------- Geometry helpers ----------
  function segLenSq(a, b) { const dy = a[0] - b[0], dx = (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180); return dx * dx + dy * dy; }
  function lineLength(line) { let L = 0; for (let i = 1; i < line.length; i++) L += Math.sqrt(segLenSq(line[i - 1], line[i])); return L; }
  // Point halfway along the longest piece of a (multi)line street.
  function labelPoint(lines) {
    if (!lines || !lines.length) return null;
    let best = lines[0], bestL = -1;
    for (const l of lines) { const L = lineLength(l); if (L > bestL) { bestL = L; best = l; } }
    if (best.length === 1) return best[0];
    let target = bestL / 2;
    for (let i = 1; i < best.length; i++) {
      const s = Math.sqrt(segLenSq(best[i - 1], best[i]));
      if (target <= s && s > 0) {
        const f = target / s;
        return [best[i - 1][0] + (best[i][0] - best[i - 1][0]) * f, best[i - 1][1] + (best[i][1] - best[i - 1][1]) * f];
      }
      target -= s;
    }
    return best[best.length - 1];
  }
  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const yi = poly[i][0], xi = poly[i][1], yj = poly[j][0], xj = poly[j][1];
      if (((yi > pt[0]) !== (yj > pt[0])) && (pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  // A district boundary is either one ring [[lat,lng],...] or several rings [[[lat,lng],...], ...].
  function rings(boundary) {
    if (!boundary || !boundary.length) return [];
    return typeof boundary[0][0] === 'number' ? [boundary] : boundary;
  }
  function inBoundary(pt, boundary) { return rings(boundary).some(r => r.length > 2 && pointInPolygon(pt, r)); }
  function hasBoundary(boundary) { return rings(boundary).some(r => r.length > 2); }
  // Leaflet polygon data for a (multi-)ring boundary
  function leafletRings(boundary) { return rings(boundary).map(r => [r]); }
  // Add points along long segments so a line crossing the boundary with few vertices is still caught.
  function densify(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / step);
      for (let k = 1; k <= n; k++) out.push([+(a[0] + (b[0] - a[0]) * k / n).toFixed(5), +(a[1] + (b[1] - a[1]) * k / n).toFixed(5)]);
    }
    return out;
  }
  // Parts of a line inside the boundary, extended one vertex so streets reach the edge.
  function clipLine(pts, boundary) {
    const inside = pts.map(p => inBoundary(p, boundary));
    const runs = []; let run = [];
    for (let i = 0; i < pts.length; i++) {
      if (inside[i] || inside[i - 1] || inside[i + 1]) run.push(pts[i]); else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    return runs.filter(r => r.length > 1);
  }
  // Streets and schools from data/baytown.js that fall inside a boundary.
  function baytownItems(data, boundary, minLen) {
    const streets = [], schools = [];
    data.streets.forEach(s => {
      const lines = s.lines.flatMap(l => clipLine(densify(l, 0.0005), boundary));
      // Ignore slivers that only poke into the district
      const inLen = lines.reduce((t, l) => t + lineLength(l.filter(p => inBoundary(p, boundary))), 0);
      if (!lines.length || inLen < (minLen || 0.0006)) return;
      streets.push(Object.assign({ name: s.name, aliases: s.aliases.slice(), lines }, s.review ? { review: s.review } : {}));
    });
    data.schools.forEach(s => { if (inBoundary(s.point, boundary)) schools.push({ name: s.name, aliases: s.aliases.slice(), point: s.point }); });
    return { streets, schools };
  }

  // ---------- Basemaps (all label-free except the builder's reference map) ----------
  const BASEMAPS = {
    none: null,
    light: {
      url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
      opts: { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' }
    },
    aerial: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opts: { maxZoom: 19, attribution: 'Imagery &copy; Esri' }
    },
    reference: { // has labels: builder only
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      opts: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
    }
  };
  function addBasemap(map, key) {
    const b = BASEMAPS[key];
    if (!b) return null;
    return L.tileLayer(b.url, b.opts).addTo(map);
  }

  const TYPE_INFO = {
    street: { label: 'Streets', prefix: '', cls: 'street' },
    school: { label: 'Schools', prefix: 'S', cls: 'school' },
    landmark: { label: 'Landmarks', prefix: 'L', cls: 'landmark' }
  };

  function numberItems(items) {
    const counters = { street: 0, school: 0, landmark: 0 };
    return items.map(it => Object.assign({}, it, { num: TYPE_INFO[it.type].prefix + (++counters[it.type]) }));
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  global.TT = { normalize, lenientStreet, gradeAnswer, levenshtein, labelPoint, pointInPolygon, lineLength,
    rings, inBoundary, hasBoundary, leafletRings, densify, clipLine, baytownItems,
    BASEMAPS, addBasemap, TYPE_INFO, numberItems, escapeHtml };
})(window);
