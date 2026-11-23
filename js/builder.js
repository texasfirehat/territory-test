(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = TT.escapeHtml;
  const DRAFT_KEY = 'territoryTests.draft';
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

  const blank = () => ({ title: 'Territory Test', settings: { streetsPerTest: 30, passingScore: 80, timeLimitMinutes: 0, streetMatching: 'strict', allowTypos: false, basemap: 'none' }, districts: [] });
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { cfg = null; }
  const pub = window.TERRITORY_TESTS;
  let mergeNote = '';
  if (cfg && pub && cfg.version !== pub.version) {
    // Published tests changed since this draft: start from the new version and carry the draft's edits over.
    try { localStorage.setItem(DRAFT_KEY + '.backup', JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    const merged = TT.mergeEdits(pub, cfg);
    mergeNote = `The published tests were updated. Your edits were carried over to the new version (${merged._merge.carried} items kept their settings` +
      (merged._merge.added ? `, ${merged._merge.added} items you added were kept` : '') + '). Download tests.js when you are ready to publish.';
    delete merged._merge;
    cfg = merged;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }
  if (!cfg) cfg = pub ? JSON.parse(JSON.stringify(pub)) : blank();
  cfg.settings = Object.assign(blank().settings, cfg.settings);
  cfg.districts = cfg.districts || [];

  let cur = 0;           // selected district index
  let draw = null;       // active drawing mode
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const district = () => cfg.districts[cur];

  function save() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cfg)); } catch (e) { status('Could not save draft in this browser: ' + e.message, true); } }
  function status(msg, err) { const s = $('status'); s.textContent = msg || ''; s.className = 'status' + (msg ? ' show' : '') + (err ? ' err' : ''); }

  // ---------- Map ----------
  const map = L.map('map', { doubleClickZoom: false, preferCanvas: true });
  let baseLayer = null;
  function setRefBase(key) { if (baseLayer) map.removeLayer(baseLayer); baseLayer = TT.addBasemap(map, key); }
  $('refBase').onchange = (e) => setRefBase(e.target.value);
  setRefBase('reference');
  if (window.BAYTOWN) L.polygon(BAYTOWN.cityLimits, { color: '#555', weight: 1.5, dashArray: '2 4', fill: false, interactive: false }).addTo(map);
  const drawn = L.layerGroup().addTo(map);
  const temp = L.layerGroup().addTo(map);
  const itemLayers = {};

  function renderMap(fit) {
    drawn.clearLayers();
    const d = district();
    if (!d) { map.setView([39.8, -98.6], 4); return; }
    const all = [];
    if (TT.hasBoundary(d.boundary)) {
      const b = L.polygon(TT.leafletRings(d.boundary), { color: '#CA0000', weight: 2, dashArray: '6 6', fillOpacity: 0.04, interactive: false }).addTo(drawn);
      all.push(b);
    }
    (d.items || []).forEach(it => {
      const on = it.include !== false;
      let lyr;
      if (it.type === 'street') {
        lyr = L.polyline(it.lines, { color: on ? (it.required ? '#CA0000' : '#0050A0') : '#9aa1ad', weight: on ? (it.required ? 7 : 5) : 3, opacity: 0.85 });
      } else {
        lyr = L.marker(it.point, { draggable: true, icon: L.divIcon({ className: `pin ${it.type}`, html: it.type === 'school' ? 'S' : 'L', iconSize: [30, 30] }), opacity: on ? 1 : 0.5 });
        lyr.on('dragend', () => { const p = lyr.getLatLng(); it.point = [+p.lat.toFixed(6), +p.lng.toFixed(6)]; save(); });
      }
      lyr.bindTooltip(esc(it.name || '(unnamed)'), { sticky: it.type === 'street' });
      lyr.on('click', (e) => { if (!draw) focusItem(it.id); else if (it.type !== 'street') onDrawClick(e.latlng); });
      lyr.addTo(drawn); itemLayers[it.id] = lyr; all.push(lyr);
    });
    if (fit && all.length) map.fitBounds(L.featureGroup(all).getBounds(), { padding: [30, 30] });
  }
  function flash(id) {
    const l = itemLayers[id]; if (!l) return;
    if (l.setStyle) { l.setStyle({ color: '#EFC11A', weight: 9 }); l.bringToFront(); setTimeout(() => renderMap(false), 1500); map.fitBounds(l.getBounds(), { maxZoom: 17, padding: [60, 60] }); }
    else { map.setView(l.getLatLng(), Math.max(map.getZoom(), 16)); l.openTooltip(); }
  }
  function focusItem(id) {
    $('fType').value = ''; $('fText').value = ''; renderItems();
    const row = document.getElementById('it-' + id);
    if (row) { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.style.outline = '3px solid #EFC11A'; setTimeout(() => row.style.outline = '', 1500); }
  }

  // ---------- Header / settings ----------
  function bindSettings() {
    $('tTitle').value = cfg.title || '';
    $('tTitle').oninput = (e) => { cfg.title = e.target.value; save(); };
    const s = cfg.settings;
    $('sPass').value = s.passingScore; $('sPass').oninput = (e) => { s.passingScore = Math.min(100, Math.max(0, +e.target.value || 0)); save(); };
    $('sTime').value = s.timeLimitMinutes; $('sTime').oninput = (e) => { s.timeLimitMinutes = Math.max(0, +e.target.value || 0); save(); };
    $('sCount').value = s.streetsPerTest || 0; $('sCount').oninput = (e) => { s.streetsPerTest = Math.max(0, Math.round(+e.target.value || 0)); save(); };
    $('sMatch').value = s.streetMatching; $('sMatch').onchange = (e) => { s.streetMatching = e.target.value; save(); };
    $('sTypos').checked = !!s.allowTypos; $('sTypos').onchange = (e) => { s.allowTypos = e.target.checked; save(); };
    $('sBase').value = s.basemap; $('sBase').onchange = (e) => { s.basemap = e.target.value; save(); };
  }

  // ---------- Districts ----------
  function renderDistricts() {
    const sel = $('dSel'); sel.innerHTML = '';
    cfg.districts.forEach((d, i) => { const o = document.createElement('option'); o.value = i; o.textContent = d.name; sel.appendChild(o); });
    if (!cfg.districts.length) { const o = document.createElement('option'); o.textContent = '— no districts yet —'; sel.appendChild(o); }
    sel.value = cur;
    const has = !!district();
    ['dRename', 'dDel', 'tBoundary', 'tImport', 'tBaytown', 'tStreet', 'tSchool', 'tLandmark'].forEach(id => $(id).disabled = !has);
  }
  $('dSel').onchange = (e) => { cancelDraw(); cur = +e.target.value; refresh(true); };
  $('dNew').onclick = () => {
    const name = prompt('District name (e.g. "District 3 – Station 3"):'); if (!name) return;
    cfg.districts.push({ id: uid('d'), name: name.trim(), boundary: [], items: [] });
    cur = cfg.districts.length - 1; save(); refresh(false);
    status('Now zoom the map to the district and click "Draw boundary".');
  };
  $('dRename').onclick = () => { const n = prompt('New name:', district().name); if (n) { district().name = n.trim(); save(); renderDistricts(); } };
  $('dDel').onclick = () => {
    if (!confirm(`Delete "${district().name}" and all its items?`)) return;
    cfg.districts.splice(cur, 1); cur = 0; save(); refresh(true);
  };

  // ---------- Drawing ----------
  function startDraw(kind) {
    cancelDraw();
    draw = { kind, pts: [] };
    document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
    $({ boundary: 'tBoundary', street: 'tStreet', school: 'tSchool', landmark: 'tLandmark' }[kind]).classList.add('active');
    map.getContainer().style.cursor = 'crosshair';
    if (kind === 'boundary' || kind === 'street') {
      $('drawBar').hidden = false;
      status(kind === 'boundary' ? 'Click around the district edge to add corners. Click Finish (or press Enter) when done.'
        : 'Click along the street to trace it. Click Finish (or press Enter) when done.');
    } else status(`Click the map where the ${kind} is.`);
  }
  function cancelDraw() {
    draw = null; temp.clearLayers(); $('drawBar').hidden = true;
    map.getContainer().style.cursor = '';
    document.querySelectorAll('.toolbar button').forEach(b => b.classList.remove('active'));
  }
  function redrawTemp() {
    temp.clearLayers(); if (!draw) return;
    const pts = draw.pts;
    if (draw.kind === 'boundary' && pts.length > 2) L.polygon(pts, { color: '#000000', weight: 2 }).addTo(temp);
    else if (pts.length > 1) L.polyline(pts, { color: '#000000', weight: 4 }).addTo(temp);
    pts.forEach(p => L.circleMarker(p, { radius: 4, color: '#000000' }).addTo(temp));
  }
  map.on('click', (e) => onDrawClick(e.latlng));
  function onDrawClick(ll) {
    if (!draw) return;
    const p = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)];
    if (draw.kind === 'school' || draw.kind === 'landmark') {
      const kind = draw.kind; cancelDraw();
      const name = prompt(`Name of this ${kind}:`); if (!name) { status(''); return; }
      district().items.push({ id: uid('i'), type: kind, name: name.trim(), aliases: [], point: p, include: true });
      save(); refresh(false); status(`Added ${kind} "${name.trim()}". Drag its pin to adjust.`);
      return;
    }
    draw.pts.push(p); redrawTemp();
  }
  function finishDraw() {
    if (!draw) return;
    const { kind, pts } = draw;
    if (kind === 'boundary') {
      if (pts.length < 3) { status('A boundary needs at least 3 points.', true); return; }
      district().boundary = pts; cancelDraw(); save(); refresh(false);
      status('Boundary saved. Next: "Import from OpenStreetMap", or add items by hand.');
    } else if (kind === 'street') {
      if (pts.length < 2) { status('A street needs at least 2 points.', true); return; }
      cancelDraw();
      const name = prompt('Street name (e.g. "Oak Avenue"):'); if (!name) { status(''); return; }
      const existing = district().items.find(i => i.type === 'street' && TT.normalize(i.name) === TT.normalize(name));
      if (existing && confirm(`"${existing.name}" already exists. Add this as another section of it?`)) existing.lines.push(pts);
      else district().items.push({ id: uid('i'), type: 'street', name: name.trim(), aliases: [], lines: [pts], include: true });
      save(); refresh(false); status(`Added street "${name.trim()}".`);
    }
  }
  $('tBoundary').onclick = () => startDraw('boundary');
  $('tStreet').onclick = () => startDraw('street');
  $('tSchool').onclick = () => startDraw('school');
  $('tLandmark').onclick = () => startDraw('landmark');
  $('drawDone').onclick = finishDraw;
  $('drawCancel').onclick = () => { cancelDraw(); status(''); };
  $('drawUndo').onclick = () => { if (draw) { draw.pts.pop(); redrawTemp(); } };
  document.addEventListener('keydown', (e) => {
    if (!draw || e.target.tagName === 'INPUT') return;
    if (e.key === 'Enter') finishDraw();
    if (e.key === 'Escape') { cancelDraw(); status(''); }
    if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Backspace') { draw.pts.pop(); redrawTemp(); e.preventDefault(); }
  });

  // ---------- Baytown data (Census streets + NCES schools), bundled in data/baytown.js ----------
  $('tBaytown').onclick = () => {
    const d = district();
    if (!window.BAYTOWN) { status('data/baytown.js is missing.', true); return; }
    if (!TT.hasBoundary(d.boundary)) { status('Draw the district boundary first.', true); return; }
    const have = new Set(d.items.map(i => i.type + '|' + TT.normalize(i.name)));
    let st = 0, sc = 0, skip = 0, rev = 0;
    const found = TT.baytownItems(BAYTOWN, d.boundary);
    found.streets.forEach(s => {
      if (have.has('street|' + TT.normalize(s.name))) { skip++; return; }
      if (s.review) rev++;
      d.items.push(Object.assign({ id: uid('i'), type: 'street', include: true }, s)); st++;
    });
    found.schools.forEach(s => {
      if (have.has('school|' + TT.normalize(s.name))) { skip++; return; }
      d.items.push(Object.assign({ id: uid('i'), type: 'school', include: true }, s)); sc++;
    });
    save(); refresh(true);
    status(`Added ${st} streets and ${sc} schools` + (skip ? ` (${skip} already present)` : '') +
      (rev ? `. ${rev} street names are marked ⚠ – check them against your map.` : '.') +
      ' Uncheck streets you don\'t want tested (e.g. tiny cul-de-sacs).');
  };

  // ---------- OpenStreetMap import ----------
  $('tImport').onclick = async () => {
    const d = district();
    if (!TT.hasBoundary(d.boundary)) { status('Draw the district boundary first.', true); return; }
    const all = TT.rings(d.boundary).flat();
    const lats = all.map(p => p[0]), lngs = all.map(p => p[1]);
    const bbox = `${Math.min(...lats)},${Math.min(...lngs)},${Math.max(...lats)},${Math.max(...lngs)}`;
    const q = `[out:json][timeout:90];
(way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]["name"](${bbox}););
out geom;
(nwr["amenity"~"^(school|kindergarten|college|university)$"]["name"](${bbox});
 nwr["amenity"~"^(hospital|clinic|fire_station|police|library|townhall|courthouse|community_centre|nursing_home|place_of_worship|post_office|social_facility)$"]["name"](${bbox});
 nwr["leisure"~"^(park|stadium|sports_centre|golf_course)$"]["name"](${bbox});
 nwr["shop"~"^(mall|supermarket|department_store)$"]["name"](${bbox});
 nwr["man_made"~"^(water_tower|tower)$"]["name"](${bbox});
 nwr["tourism"~"^(hotel|museum|attraction)$"]["name"](${bbox});
 nwr["aeroway"="aerodrome"]["name"](${bbox});
 nwr["building"~"^(apartments|industrial|warehouse)$"]["name"](${bbox});
);
out center tags;`;
    status('Downloading from OpenStreetMap… (this can take up to a minute)');
    $('tImport').disabled = true;
    try {
      const resp = await fetch(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: q }) });
      if (!resp.ok) throw new Error(`Overpass server returned ${resp.status}. It may be busy; try again in a minute.`);
      const json = await resp.json();
      const added = importOsm(d, json.elements || [], !!window.BAYTOWN);
      save(); refresh(true);
      status(`Imported ${added.street} streets, ${added.school} schools, ${added.landmark} possible landmarks` +
        (added.skipped ? ` (${added.skipped} already present, skipped)` : '') +
        '. Landmarks start unchecked: tick the ones you want tested. Check spellings against your local map.');
    } catch (e) {
      status('Import failed: ' + e.message, true);
    } finally { $('tImport').disabled = false; }
  };

  function importOsm(d, els, landmarksOnly) {
    const counts = { street: 0, school: 0, landmark: 0, skipped: 0 };
    const have = new Set(d.items.map(i => i.type + '|' + TT.normalize(i.name)));
    const altNames = (t) => [t.alt_name, t.old_name, t.short_name, t.official_name, t.loc_name]
      .filter(Boolean).flatMap(s => s.split(';')).map(s => s.trim()).filter(s => s && s !== t.name);
    // Streets: merge OSM ways with the same name; keep only parts inside the boundary.
    const streets = new Map();
    els.filter(e => !landmarksOnly && e.type === 'way' && e.tags && e.tags.highway && e.geometry).forEach(w => {
      const pts = w.geometry.map(g => [+g.lat.toFixed(6), +g.lon.toFixed(6)]);
      const inside = pts.map(p => TT.inBoundary(p, d.boundary));
      // Split into runs that are inside, extended by one point so streets reach the edge.
      let run = [];
      const runs = [];
      for (let i = 0; i < pts.length; i++) {
        const keep = inside[i] || inside[i - 1] || inside[i + 1];
        if (keep) run.push(pts[i]); else if (run.length) { runs.push(run); run = []; }
      }
      if (run.length) runs.push(run);
      if (!runs.length) return;
      const key = TT.normalize(w.tags.name);
      const s = streets.get(key) || { name: w.tags.name, aliases: new Set(), lines: [] };
      altNames(w.tags).forEach(a => s.aliases.add(a));
      if (w.tags.ref && !/^\d+$/.test(w.tags.ref)) s.aliases.add(w.tags.ref);
      runs.filter(r => r.length > 1).forEach(r => s.lines.push(r));
      streets.set(key, s);
    });
    [...streets.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
      if (!s.lines.length) return;
      if (have.has('street|' + TT.normalize(s.name))) { counts.skipped++; return; }
      d.items.push({ id: uid('i'), type: 'street', name: s.name, aliases: [...s.aliases], lines: s.lines, include: true, source: 'osm' });
      counts.street++;
    });
    // Schools and landmarks
    els.filter(e => e.tags && e.tags.name && !e.tags.highway).forEach(e => {
      const p = e.type === 'node' ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null;
      if (!p || !TT.inBoundary(p, d.boundary)) return;
      const type = /^(school|kindergarten|college|university)$/.test(e.tags.amenity || '') ? 'school' : 'landmark';
      if (landmarksOnly && type === 'school') return;
      const key = type + '|' + TT.normalize(e.tags.name);
      if (have.has(key)) { counts.skipped++; return; }
      have.add(key);
      d.items.push({ id: uid('i'), type, name: e.tags.name, aliases: altNames(e.tags), point: [+p[0].toFixed(6), +p[1].toFixed(6)],
        include: type === 'school', source: 'osm', kind: e.tags.amenity || e.tags.leisure || e.tags.shop || e.tags.man_made || e.tags.tourism || e.tags.building || '' });
      counts[type]++;
    });
    return counts;
  }

  // ---------- Items list ----------
  function visibleItems() {
    const d = district(); if (!d) return [];
    const t = $('fType').value, q = $('fText').value.trim().toLowerCase();
    const typeOk = (i) => !t || (t === 'review' ? !!i.review : t === 'required' ? !!i.required : i.type === t);
    return d.items.filter(i => typeOk(i) && (!q || (i.name || '').toLowerCase().includes(q)));
  }
  function renderItems() {
    const box = $('items'); box.innerHTML = '';
    const d = district();
    if (!d) { $('itemCount').textContent = ''; return; }
    const inc = d.items.filter(i => i.include !== false);
    const c = (t) => inc.filter(i => i.type === t).length;
    const req = inc.filter(i => i.required).length;
    $('itemCount').textContent = `— ${c('street')} streets (${req} required), ${c('school')} schools, ${c('landmark')} landmarks on test`;
    const order = { street: 0, school: 1, landmark: 2 };
    visibleItems().slice().sort((a, b) => order[a.type] - order[b.type]).forEach(it => {
      const row = document.createElement('div');
      row.className = 'item' + (it.include === false ? ' off' : '') + (it.required ? ' required' : ''); row.id = 'it-' + it.id;
      row.innerHTML = `<div class="head">
          <input type="checkbox" ${it.include !== false ? 'checked' : ''} title="Include on test">
          <span class="tag ${it.type}">${it.type === 'street' ? 'ST' : it.type === 'school' ? 'SCH' : 'LM'}</span>
          <input type="text" class="nm" value="${esc(it.name)}">
          <button class="small" data-a="zoom" title="Show on map">⌖</button>
          <button class="small danger" data-a="del" title="Delete">✕</button>
        </div>
        <input type="text" class="aliases" placeholder="Also accept… (comma separated)" value="${esc((it.aliases || []).join(', '))}">
        ${it.type === 'street' ? `<label class="req-toggle" title="Always asked; must be correct to pass"><input type="checkbox" class="req-cb" ${it.required ? 'checked' : ''}> Required (always asked, must be correct)</label>` : ''}
        ${it.kind ? `<div class="muted">OSM: ${esc(it.kind.replace(/_/g, ' '))}</div>` : ''}
        ${it.review ? `<div class="review">⚠ ${esc(it.review)} <button class="small" data-a="ok">Name is correct</button></div>` : ''}`;
      row.querySelector('input[type=checkbox]').onchange = (e) => {
        it.include = e.target.checked;
        if (!it.include && it.required) { delete it.required; }
        save(); renderMap(false); renderCount();
      };
      const rc = row.querySelector('.req-cb');
      if (rc) rc.onchange = (e) => {
        if (e.target.checked) { it.required = true; it.include = true; } else delete it.required;
        save(); renderMap(false); renderCount();
      };
      row.querySelector('.nm').oninput = (e) => { it.name = e.target.value; delete it.review; save(); };
      row.querySelector('.nm').onchange = () => renderMap(false);
      row.querySelector('.aliases').oninput = (e) => { it.aliases = e.target.value.split(',').map(s => s.trim()).filter(Boolean); save(); };
      row.querySelector('[data-a=zoom]').onclick = () => flash(it.id);
      const ok = row.querySelector('[data-a=ok]');
      if (ok) ok.onclick = () => { delete it.review; save(); renderCount(); };
      row.querySelector('[data-a=del]').onclick = () => {
        if (!confirm(`Delete "${it.name}"?`)) return;
        d.items.splice(d.items.indexOf(it), 1); save(); refresh(false);
      };
      box.appendChild(row);
    });
    if (!d.items.length) box.innerHTML = '<p class="muted">No items yet. Draw a boundary and import from OpenStreetMap, or add items by hand.</p>';
  }
  function renderCount() { const s = $('items').scrollTop; renderItems(); $('items').scrollTop = s; }
  $('fType').onchange = renderItems; $('fText').oninput = renderItems;
  const setShown = (v) => { visibleItems().forEach(i => i.include = v); save(); refresh(false); };
  $('inclAll').onclick = () => setShown(true); $('exclAll').onclick = () => setShown(false);

  // ---------- Export / import / preview ----------
  function cleanConfig() {
    return { title: cfg.title, version: cfg.version, settings: cfg.settings, districts: cfg.districts.map(d => ({
      id: d.id, name: d.name, boundary: d.boundary,
      items: d.items.filter(i => (i.name || '').trim()).map(i => {
        const o = { id: i.id, type: i.type, name: i.name.trim(), aliases: i.aliases || [] };
        if (i.include === false) o.include = false;
        if (i.required) o.required = true;
        if (i.removedAliases) o.removedAliases = i.removedAliases;
        if (i.review) o.review = i.review;
        if (i.type === 'street') o.lines = i.lines; else o.point = i.point;
        return o;
      })
    })) };
  }
  $('export').onclick = () => {
    cfg.version = new Date().toISOString(); save();
    const body = '/* Territory test data – generated by builder.html on ' + new Date().toISOString().slice(0, 10) + ' */\nwindow.TERRITORY_TESTS = ' + JSON.stringify(cleanConfig(), null, 1) + ';\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    a.download = 'tests.js'; a.click();
    status('Downloaded tests.js. Upload it to the website as data/tests.js to publish.');
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      let txt = await f.text();
      txt = txt.replace(/^[\s\S]*?window\.TERRITORY_TESTS\s*=\s*/, '').replace(/;\s*$/, '');
      const data = JSON.parse(txt);
      if (!data.districts) throw new Error('No districts found in file.');
      if (!confirm('Replace your current work with this file?')) return;
      cfg = data; cfg.settings = Object.assign(blank().settings, cfg.settings); cur = 0; save(); bindSettings(); refresh(true);
      status(`Loaded ${data.districts.length} district(s) from ${f.name}.`);
    } catch (err) { status('Could not read file: ' + err.message, true); }
    e.target.value = '';
  };
  $('preview').onclick = () => {
    localStorage.setItem('territoryTests.preview', JSON.stringify(cleanConfig()));
    window.open('index.html?preview=1', '_blank');
  };
  $('reset').onclick = () => {
    if (!confirm('Discard your browser draft and reload the published data/tests.js?')) return;
    localStorage.removeItem(DRAFT_KEY); location.reload();
  };

  function refresh(fit) { renderDistricts(); renderItems(); renderMap(fit); }
  bindSettings(); refresh(true);
  if (mergeNote) status(mergeNote);
})();
