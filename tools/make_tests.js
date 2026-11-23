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
// The name without its street type ("Garth Road" -> "Garth", "Egret Canal North" stays as is).
const TYPE_WORDS = new Set(['Street', 'Avenue', 'Road', 'Drive', 'Lane', 'Court', 'Circle', 'Boulevard', 'Way', 'Trail', 'Place',
  'Parkway', 'Creek', 'Cove', 'Bend', 'Loop', 'View', 'Highway', 'Terrace', 'Square', 'Crossing', 'Point', 'Run', 'Pass', 'Trace',
  'Hollow', 'Glen', 'Ridge', 'Landing', 'Plaza', 'Causeway', 'Expressway']);
const DIR_WORDS = new Set(['North', 'South', 'East', 'West']);
const NO_TYPELESS = new Set(['Grand Parkway', 'Interstate 10', 'Highway 146', 'Business Highway 146', 'Spur 330']);
function withoutType(name) {
  if (NO_TYPELESS.has(name) || /^FM \d/.test(name)) return null;
  const w = name.split(' ');
  let end = w.length;
  if (end > 2 && DIR_WORDS.has(w[end - 1]) && TYPE_WORDS.has(w[end - 2])) end -= 1; // "Christina Loop North"
  const i = end - 1;
  if (i < 1 || !TYPE_WORDS.has(w[i])) return null;
  const base = w.slice(0, i).concat(w.slice(end)).join(' ');
  if (DIR_WORDS.has(base) || /^(North|South|East|West)$/.test(base)) return null;
  return base;
}

const placed = new Set();
const shared = [];
Object.keys(districts).sort().forEach(n => {
  const boundary = districts[n];
  const found = TT.baytownItems(BAYTOWN, boundary);
  const items = [];
  // Count bases per district so streets that would share a typeless answer can be reported
  const baseCount = {};
  found.streets.forEach(s => { const b = withoutType(s.name); if (b) baseCount[b] = (baseCount[b] || 0) + 1; });
  found.streets.forEach((s, i) => {
    const b = withoutType(s.name);
    if (b && !s.aliases.some(a => TT.normalize(a) === TT.normalize(b))) s.aliases = s.aliases.concat(b);
    if (b && baseCount[b] > 1) shared.push(`District ${n}: "${b}" → ${s.name}`);
    const it = Object.assign({ id: `d${n}s${i + 1}`, type: 'street' }, s);
    const metres = (s.inLen || 0) * 111000;
    delete it.major; delete it.inLen;
    if (s.major && metres >= 300 && !s.review) it.required = true; // arterials: always asked, must be correct
    if (s.review) it.include = false; // e.g. streets the city still marks as proposed
    items.push(it);
  });
  found.schools.forEach((s, i) => { placed.add(s.name); items.push(Object.assign({ id: `d${n}h${i + 1}`, type: 'school' }, s)); });
  cfg.districts.push({ id: `d${n}`, name: `District ${n} – Station ${n}`, boundary, items });
  console.log(`  required: ${items.filter(i => i.required).map(i => i.name).join(', ')}`);
  console.log(`District ${n}: ${found.streets.length} streets (${found.streets.filter(s => s.review).length} flagged), schools: ${found.schools.map(s => s.name).join(', ') || 'none'}`);
});
cfg.districts.push({
  // Citywide schools test: only schools inside a fire district (Highlands-area campuses etc. are not tested)
  id: 'schools', name: 'All Schools in BFD Districts (GCCISD + Baytown Christian Academy)', boundary: [],
  items: BAYTOWN.schools.filter(s => placed.has(s.name)).map((s, i) => ({ id: `sch${i + 1}`, type: 'school', name: s.name, aliases: s.aliases, point: s.point }))
});
console.log('Schools in no fire district (not tested):', BAYTOWN.schools.filter(s => !placed.has(s.name)).map(s => s.name).join(', '));
fs.writeFileSync('data/tests.js', '/* Territory test data. Rebuild with builder.html → Download tests.js, or node tools/make_tests.js. */\nwindow.TERRITORY_TESTS = ' + JSON.stringify(cfg) + ';\n');
console.log('data/tests.js', (fs.statSync('data/tests.js').size / 1024).toFixed(0), 'KB');
if (shared.length) {
  console.log(`\nTypeless answers shared by more than one street in the same district (${shared.length}):`);
  shared.forEach(l => console.log('  ' + l));
}
