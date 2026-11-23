(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = TT.escapeHtml;

  // Builder "Preview" passes its working copy through localStorage.
  let config = window.TERRITORY_TESTS;
  if (new URLSearchParams(location.search).has('preview')) {
    try { const p = localStorage.getItem('territoryTests.preview'); if (p) config = JSON.parse(p); } catch (e) { /* ignore */ }
  }
  if (!config || !config.districts || !config.districts.length) {
    $('start').innerHTML = '<h2>No tests configured</h2><p>Build one in the <a href="builder.html">test builder</a> and export it to <code>data/tests.js</code>.</p>';
    return;
  }
  const S = Object.assign({ streetsPerTest: 0, passingScore: 80, timeLimitMinutes: 0, streetMatching: 'strict', allowTypos: false, basemap: 'none' }, config.settings);

  document.title = config.title || 'Territory Test';
  $('title').textContent = config.title || 'Territory Test';
  $('startTitle').textContent = config.title || 'Territory Test';
  const sel = $('districtSel');
  config.districts.forEach((d, i) => {
    const o = document.createElement('option'); o.value = i;
    const inc = (d.items || []).filter(it => it.include !== false);
    const st = inc.filter(i => i.type === 'street').length, k = +(config.settings || {}).streetsPerTest || 0;
    const req = inc.filter(i => i.type === 'street' && i.required).length;
    const n = inc.length - st + (k > 0 ? Math.max(req, Math.min(k, st)) : st);
    o.textContent = `${d.name} (${n} questions)`; sel.appendChild(o);
  });
  const rules = [];
  rules.push(S.streetMatching === 'lenient' ? 'Street types (St, Ave, Rd…) and directions are optional.' : 'Include the street type, e.g. "Oak Ave" or "Oak Avenue".');
  rules.push('Abbreviations are fine (St, Ave, Blvd, N, Elem…). Capitalization doesn\'t matter.');
  if (S.timeLimitMinutes > 0) rules.push(`Time limit: ${S.timeLimitMinutes} minutes. The test submits itself when time runs out.`);
  if (+S.streetsPerTest > 0) rules.push(`Each test asks ${S.streetsPerTest} randomly chosen streets from the district, plus its schools and landmarks.`);
  rules.push(`Passing score: ${S.passingScore}%.`);
  if (config.districts.some(d => (d.items || []).some(i => i.required && i.include !== false)))
    rules.push('Items marked REQ (main roads and key waterways) must all be correct to pass, whatever your score.');
  $('startInfo').innerHTML = rules.map(esc).join('<br>');

  let state = null;

  $('startBtn').onclick = () => {
    const name = $('takerName').value.trim();
    if (!name) { $('takerName').focus(); $('takerName').placeholder = 'Please enter your name'; return; }
    startTest(name, config.districts[+sel.value]);
  };

  function startTest(name, district) {
    let pool = (district.items || []).filter(it => it.include !== false);
    // Random sample of streets per attempt (all schools/landmarks always included).
    const n = +S.streetsPerTest || 0;
    let streets = pool.filter(it => it.type === 'street');
    if (n > 0 && streets.length > n) {
      // Required streets are always asked; the rest of the N slots are filled at random.
      const req = streets.filter(it => it.required), rest = streets.filter(it => !it.required);
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      streets = req.concat(rest.slice(0, Math.max(0, n - req.length)));
    }
    // Number streets north-to-south, west-to-east so the list reads in map order.
    const lp = (it) => TT.labelPoint(it.lines) || [0, 0];
    streets.sort((a, b) => { const A = lp(a), B = lp(b); return Math.round((B[0] - A[0]) * 400) || (A[1] - B[1]); });
    const items = TT.numberItems(streets.concat(pool.filter(it => it.type !== 'street')));
    state = { name, district, items, started: new Date(), layers: {}, submitted: false };
    $('start').hidden = true; $('testView').hidden = false;
    $('title').textContent = `${config.title || 'Territory Test'} — ${district.name}`;
    buildQuestions(items);
    buildMap(district, items);
    updateProgress();
    if (S.timeLimitMinutes > 0) startTimer(S.timeLimitMinutes * 60);
    window.addEventListener('beforeunload', guard);
  }
  function guard(e) { if (state && !state.submitted) { e.preventDefault(); e.returnValue = ''; } }

  function buildQuestions(items) {
    const box = $('questions'); box.innerHTML = '';
    ['street', 'waterway', 'school', 'landmark'].forEach(type => {
      const group = items.filter(it => it.type === type);
      if (!group.length) return;
      const h = document.createElement('h2'); h.textContent = TT.TYPE_INFO[type].label; box.appendChild(h);
      group.forEach(it => {
        const row = document.createElement('div');
        row.className = `q ${type}${it.required ? ' required' : ''}`; row.id = 'q-' + it.id;
        row.innerHTML = `<span class="num">${esc(it.num)}</span>
          <input type="text" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="words" aria-label="Name of ${TT.TYPE_INFO[type].label.toLowerCase().slice(0, -1)} ${esc(it.num)}">
          ${it.required ? '<span class="req" title="Required: must be correct to pass">REQ</span>' : ''}
          <span class="mark"></span>`;
        const inp = row.querySelector('input');
        inp.addEventListener('focus', () => highlight(it.id, true));
        inp.addEventListener('input', () => setAnswered(it.id, inp.value.trim() !== ''));
        inp.addEventListener('blur', () => highlight(it.id, false));
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); const all = [...document.querySelectorAll('#questions input')]; const n = all[all.indexOf(inp) + 1]; if (n) n.focus(); }
        });
        box.appendChild(row);
      });
    });
  }

  function buildMap(district, items) {
    const map = L.map('map', { zoomControl: true, attributionControl: true, preferCanvas: true });
    state.map = map;
    TT.addBasemap(map, S.basemap);
    const group = [];
    if (TT.hasBoundary(district.boundary)) {
      const b = L.polygon(TT.leafletRings(district.boundary), { color: '#CA0000', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map);
      group.push(b);
    }
    // Whole-city street grid, faint and unlabeled, so the district sits in context.
    if (window.BAYTOWN && S.cityContext !== false) {
      const ctx = { color: '#cfd3da', weight: 2, interactive: false };
      L.polyline(BAYTOWN.streets.map(s => s.lines).flat(), ctx).addTo(map);
      L.polygon(BAYTOWN.cityLimits, { color: '#9aa1ad', weight: 1, fill: false, interactive: false }).addTo(map);
    }
    // Context streets (not tested) drawn faintly so the grid looks complete.
    const asked = new Set(items.map(i => i.id));
    (district.items || []).filter(it => it.type === 'street' && !asked.has(it.id)).forEach(it => {
      L.polyline(it.lines, { color: '#b9bec7', weight: 4, interactive: false }).addTo(map);
    });
    // Waterways first, so streets draw on top of them.
    const waterLayers = {};
    items.filter(it => it.type === 'waterway').forEach(it => {
      const g = L.featureGroup();
      (it.polys || []).forEach(r => L.polygon(r, WATER.base.poly).addTo(g));
      (it.lines || []).forEach(l => L.polyline(l, WATER.base.line).addTo(g));
      g.on('click', () => focusField(it.id));
      waterLayers[it.id] = g.addTo(map);
    });
    items.forEach(it => {
      const lyr = { item: it };
      let at;
      if (it.type === 'waterway') {
        lyr.water = waterLayers[it.id];
        at = it.point;
      } else if (it.type === 'street') {
        lyr.casing = L.polyline(it.lines, { color: '#8b93a1', weight: 10, lineCap: 'round' }).addTo(map);
        lyr.line = L.polyline(it.lines, { color: '#ffffff', weight: 6, lineCap: 'round' }).addTo(map);
        [lyr.casing, lyr.line].forEach(l => l.on('click', () => focusField(it.id)));
        at = TT.labelPoint(it.lines);
        group.push(lyr.casing);
      } else {
        at = it.point;
      }
      lyr.pin = L.marker(at, {
        icon: L.divIcon({ className: `pin ${it.type}${it.required ? ' required' : ''}`, html: esc(it.num), iconSize: [30, 30] }),
        keyboard: false, riseOnHover: true
      }).addTo(map).on('click', () => focusField(it.id));
      if (it.type !== 'street') group.push(lyr.pin);
      state.layers[it.id] = lyr;
    });
    // With many items, hide pins until zoomed in so they don't pile up.
    if (items.length > 60) {
      const gate = () => map.getContainer().classList.toggle('hide-pins', map.getZoom() < 16);
      map.on('zoomend', gate); setTimeout(gate, 0);
    }
    const fg = L.featureGroup(group);
    if (group.length) map.fitBounds(fg.getBounds(), { padding: [30, 30] }); else map.setView([39.8, -98.6], 4);
  }

  function focusField(id) {
    const inp = document.querySelector(`#q-${CSS.escape(id)} input`);
    if (inp && !inp.disabled) { inp.focus(); inp.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else if (inp) { document.getElementById('q-' + id).scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  }

  function highlight(id, on) {
    const lyr = state.layers[id]; if (!lyr) return;
    const row = document.getElementById('q-' + id);
    if (row) row.classList.toggle('hl', on);
    const el = lyr.pin.getElement(); if (el) el.classList.toggle('hl', on);
    if (lyr.line) {
      lyr.line.setStyle({ color: on ? '#EFC11A' : resultColor(id) });
      lyr.casing.setStyle({ color: on ? '#000000' : '#8b93a1' });
      if (on) { lyr.casing.bringToFront(); lyr.line.bringToFront(); }
    }
    if (lyr.water) styleWater(lyr, on ? 'hl' : waterKind(id));
    if (on) lyr.pin.setZIndexOffset(1000); else lyr.pin.setZIndexOffset(0);
    if (on) {
      const ll = lyr.pin.getLatLng(), m = state.map;
      if (!m.getBounds().pad(-0.1).contains(ll)) m.panTo(ll);
    }
  }
  // Waterway styles: base (unanswered or answered), hl (being answered), right / wrong (after scoring)
  const WATER = {
    base: { poly: { color: '#2f7fc1', weight: 1.5, fillColor: '#a9d3f5', fillOpacity: 0.8 }, line: { color: '#2f7fc1', weight: 5, opacity: 0.9 } },
    hl: { poly: { color: '#000000', weight: 2.5, fillColor: '#EFC11A', fillOpacity: 0.85 }, line: { color: '#EFC11A', weight: 7, opacity: 1 } },
    right: { poly: { color: '#1e7a3c', weight: 2, fillColor: '#5cc27a', fillOpacity: 0.75 }, line: { color: '#5cc27a', weight: 6, opacity: 1 } },
    wrong: { poly: { color: '#CA0000', weight: 2, fillColor: '#ef7a72', fillOpacity: 0.75 }, line: { color: '#ef7a72', weight: 6, opacity: 1 } }
  };
  function waterKind(id) { return state.submitted ? (state.graded[id].correct ? 'right' : 'wrong') : 'base'; }
  function styleWater(lyr, kind) {
    lyr.water.eachLayer(l => l.setStyle(l instanceof L.Polygon ? WATER[kind].poly : WATER[kind].line));
  }
  // Mark a question answered/blank on the list, the map pin and the street line; update the counter.
  function setAnswered(id, yes) {
    const lyr = state.layers[id]; if (!lyr) return;
    lyr.answered = yes;
    const row = document.getElementById('q-' + id);
    if (row) row.classList.toggle('answered', yes);
    const el = lyr.pin.getElement(); if (el) el.classList.toggle('answered', yes);
    const focused = row && row.classList.contains('hl');
    if (lyr.line && !focused) lyr.line.setStyle({ color: resultColor(id) });
    updateProgress();
  }
  function updateProgress() {
    const el = $('progress'); if (!el || state.submitted) return;
    const n = Object.values(state.layers).filter(l => l.answered).length;
    const total = state.items.length;
    el.textContent = `${n} of ${total} answered`;
    el.classList.toggle('done', n === total);
  }
  function resultColor(id) {
    if (!state.submitted) return state.layers[id] && state.layers[id].answered ? '#0050A0' : '#ffffff';
    return state.graded[id].correct ? '#5cc27a' : '#ef7a72';
  }

  // ---------- Timer ----------
  function startTimer(secs) {
    const t = $('timer'); t.hidden = false;
    const end = Date.now() + secs * 1000;
    const tick = () => {
      const left = Math.max(0, Math.round((end - Date.now()) / 1000));
      t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      if (left <= 60) t.style.background = '#000';
      if (left === 0) { clearInterval(state.timer); submit(true); }
    };
    tick(); state.timer = setInterval(tick, 500);
  }

  // ---------- Submit & score ----------
  $('submitBtn').onclick = () => {
    const blanks = [...document.querySelectorAll('#questions input')].filter(i => !i.value.trim()).length;
    if (blanks && !confirm(`You have ${blanks} blank answer${blanks > 1 ? 's' : ''}. Submit anyway?`)) return;
    submit(false);
  };

  function submit(timedOut) {
    if (state.submitted) return;
    clearInterval(state.timer);
    state.finished = new Date();
    state.graded = {};
    let right = 0;
    state.items.forEach(it => {
      const inp = document.querySelector(`#q-${CSS.escape(it.id)} input`);
      const answer = inp.value;
      const g = TT.gradeAnswer(it, answer, S);
      state.graded[it.id] = Object.assign({ answer }, g);
      if (g.correct) right++;
    });
    state.submitted = true;
    state.right = right;
    state.pct = state.items.length ? Math.round(100 * right / state.items.length) : 0;
    state.timedOut = timedOut;
    showResults();
  }

  function showResults() {
    const reqItems = state.items.filter(i => i.required);
    const reqMissed = reqItems.filter(i => !state.graded[i.id].correct);
    const passed = state.pct >= S.passingScore && reqMissed.length === 0;
    state.passed = passed;
    // Mark each field
    state.items.forEach(it => {
      const g = state.graded[it.id];
      const row = document.getElementById('q-' + it.id);
      const inp = row.querySelector('input');
      inp.disabled = true;
      row.classList.remove('answered');
      row.classList.add(g.correct ? 'right' : 'wrong');
      row.querySelector('.mark').textContent = g.correct ? '✓' : '✗';
      if (!g.correct || g.note) {
        const a = document.createElement('div'); a.className = 'ans';
        a.style.cssText = 'flex-basis:100%;padding-left:42px';
        a.textContent = g.correct ? g.note : `Correct: ${it.name}`;
        row.style.flexWrap = 'wrap'; row.appendChild(a);
      }
      const lyr = state.layers[it.id];
      const el = lyr.pin.getElement(); if (el) { el.classList.remove('answered'); el.classList.add(g.correct ? 'right' : 'wrong'); }
      lyr.pin.bindTooltip(esc(it.name), { direction: 'top', offset: [0, -14] });
      if (lyr.line) { lyr.line.setStyle({ color: resultColor(it.id) }); lyr.line.bindTooltip(esc(it.name), { sticky: true }); }
      if (lyr.water) { styleWater(lyr, g.correct ? 'right' : 'wrong'); lyr.water.bindTooltip(esc(it.name), { sticky: true }); }
    });
    const mins = Math.round((state.finished - state.started) / 60000);
    const byType = ['street', 'waterway', 'school', 'landmark'].map(t => {
      const g = state.items.filter(i => i.type === t); if (!g.length) return '';
      const r = g.filter(i => state.graded[i.id].correct).length;
      return `<tr><td>${TT.TYPE_INFO[t].label}</td><td>${r} / ${g.length}</td></tr>`;
    }).join('') + (reqItems.length ? `<tr><td><strong>Required</strong> (must be 100%)</td><td><strong>${reqItems.length - reqMissed.length} / ${reqItems.length}</strong></td></tr>` : '');
    const why = !passed && reqMissed.length
      ? `<p class="fail-why">Failed: missed required ${reqMissed.map(i => `<strong>${esc(i.num)} ${esc(i.name)}</strong>`).join(', ')}.</p>` : '';
    const res = $('results');
    res.hidden = false;
    res.innerHTML = `
      <h2>Results</h2>
      <div><strong>${esc(state.name)}</strong> · ${esc(state.district.name)}</div>
      <div class="muted">${state.finished.toLocaleString()} · ${mins} min${state.timedOut ? ' · time expired' : ''}</div>
      <div class="score ${passed ? 'pass' : 'fail'}">${state.pct}%</div>
      <div>${state.right} of ${state.items.length} correct <span class="badge ${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'}</span>
        <span class="muted">(passing ${S.passingScore}%)</span></div>
      ${why}
      <table class="results">${byType}</table>
      <p class="muted">Missed items are red on the map. Hover a pin, street or waterway to see its name.</p>`;
    $('side').insertBefore(res, $('questions'));
    $('side').scrollTop = 0;
    $('actions').innerHTML = '';
    const mk = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; if (cls) b.className = cls; $('actions').appendChild(b); };
    mk('Print / save PDF', () => window.print());
    mk('Download CSV', downloadCsv);
    mk('Take another test', () => { window.removeEventListener('beforeunload', guard); location.reload(); }, 'primary');
  }

  function downloadCsv() {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = [
      ['Test', config.title], ['Name', state.name], ['District', state.district.name],
      ['Started', state.started.toISOString()], ['Finished', state.finished.toISOString()],
      ['Score', state.pct + '%'], ['Correct', `${state.right}/${state.items.length}`],
      ['Result', state.passed ? 'PASS' : 'FAIL'], [],
      ['#', 'Type', 'Required', 'Correct answer', 'Given answer', 'Result']
    ];
    state.items.forEach(it => {
      const g = state.graded[it.id];
      lines.push([it.num, it.type, it.required ? 'Yes' : '', it.name, g.answer, g.correct ? 'Correct' : 'Wrong']);
    });
    const csv = lines.map(r => r.map(q).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `territory-test_${state.name.replace(/\W+/g, '-')}_${state.finished.toISOString().slice(0, 10)}.csv`;
    a.click();
  }
})();
