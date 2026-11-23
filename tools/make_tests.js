// Generate data/tests.js: the citywide schools test plus one test per fire district.
// Run from the project folder:  node tools/make_tests.js
// District boundaries come from tools/districts.json ({"1": [ring, ...], ...}, rings of [lat, lng]).
const fs = require('fs');
global.window = global;
require('../js/common.js');
const load = (f, v) => { const s = fs.readFileSync(f, 'utf8'); return JSON.parse(s.slice(s.indexOf(`window.${v} = `) + `window.${v} = `.length).trim().replace(/;$/, '')); };
const BAYTOWN = load('data/baytown.js', 'BAYTOWN');
const districts = JSON.parse(fs.readFileSync('tools/districts.json', 'utf8'));

const cfg = {
  title: 'Baytown Fire Department – Territory Test',
  version: new Date().toISOString(),
  settings: { streetsPerTest: 30, passingScore: 80, timeLimitMinutes: 0, streetMatching: 'strict', allowTypos: false, basemap: 'none', cityContext: true },
  districts: []
};
const placed = new Set();
Object.keys(districts).sort().forEach(n => {
  const boundary = districts[n];
  const found = TT.baytownItems(BAYTOWN, boundary);
  const items = [];
  found.streets.forEach((s, i) => items.push(Object.assign({ id: `d${n}s${i + 1}`, type: 'street' }, s)));
  found.schools.forEach((s, i) => { placed.add(s.name); items.push(Object.assign({ id: `d${n}h${i + 1}`, type: 'school' }, s)); });
  cfg.districts.push({ id: `d${n}`, name: `District ${n} – Station ${n}`, boundary, items });
  console.log(`District ${n}: ${found.streets.length} streets (${found.streets.filter(s => s.review).length} need a name check), schools: ${found.schools.map(s => s.name).join(', ') || 'none'}`);
});
cfg.districts.push({
  // Citywide schools test: only schools inside a fire district (Highlands-area campuses etc. are not tested)
  id: 'schools', name: 'All Schools in BFD Districts (GCCISD + Baytown Christian Academy)', boundary: [],
  items: BAYTOWN.schools.filter(s => placed.has(s.name)).map((s, i) => ({ id: `sch${i + 1}`, type: 'school', name: s.name, aliases: s.aliases, point: s.point }))
});
console.log('Schools in no fire district (not tested):', BAYTOWN.schools.filter(s => !placed.has(s.name)).map(s => s.name).join(', '));
fs.writeFileSync('data/tests.js', '/* Territory test data. Rebuild with builder.html → Download tests.js, or node tools/make_tests.js. */\nwindow.TERRITORY_TESTS = ' + JSON.stringify(cfg) + ';\n');
console.log('data/tests.js', (fs.statSync('data/tests.js').size / 1024).toFixed(0), 'KB');
