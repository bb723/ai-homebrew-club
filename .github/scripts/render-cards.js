/* Renders card.html for every upcoming meetup into cards/<event>.png (1080 x 1350), so the
   server can attach the card to roster notes and anyone can text aihomebrewclub.com/cards/<id>.png.
   Run by .github/workflows/render-cards.yml (daily, on dispatch, and when the card's design
   changes); also runs locally with CHROME_PATH pointing at a Chrome binary.
   A card is only re-rendered when the meetup's facts or the card's design changed, so the
   workflow commits rarely. Cards for meetups that are past or gone are removed.
   usage: node .github/scripts/render-cards.js   (env: CHROME_PATH, PORT, API_BASE) */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'cards');
const INDEX = path.join(OUT, 'index.json');
const PORT = parseInt(process.env.PORT, 10) || 8765;
const DESIGN_FILES = ['card.html', 'assets/site.css', 'assets/site.js', 'assets/config.js', 'assets/qrlib.js'];
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json' };

function apiBase() {
  if (process.env.API_BASE) return process.env.API_BASE;
  const cfg = fs.readFileSync(path.join(ROOT, 'assets', 'config.js'), 'utf8');
  const m = /API_BASE\s*=\s*'([^']+)'/.exec(cfg);
  if (!m) throw new Error('API_BASE not found in assets/config.js');
  return m[1];
}
function sha(s) { return crypto.createHash('sha1').update(s).digest('hex').slice(0, 16); }
function designHash() {
  /* line endings normalized, so a Windows checkout and the Linux runner agree on what changed */
  return sha(DESIGN_FILES.map(f => fs.readFileSync(path.join(ROOT, f))).map(b => b.toString('utf8').replace(/\r\n/g, '\n')).join('\n---\n'));
}
function eventHash(e, design) {
  return sha(design + '|' + JSON.stringify([e.id, e.city, e.title, e.when, e.sort_date, e.start_time, e.minutes, e.location, e.capacity]));
}
/* a static server for the repo, so card.html loads its assets the way the site does */
function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      let file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const puppeteer = require('puppeteer');
  const api = apiBase();
  const res = await fetch(api + '/events');
  if (!res.ok) throw new Error('calendar fetch failed: ' + res.status);
  const events = ((await res.json()).events || []).filter(e => e.status === 'upcoming' && /^[a-z0-9-]+$/.test(e.id));
  fs.mkdirSync(OUT, { recursive: true });
  let index = {};
  try { index = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch (err) { index = {}; }
  const design = designHash();
  const keep = new Set();
  const todo = [];
  for (const e of events) {
    keep.add(e.id);
    const hash = eventHash(e, design);
    const file = path.join(OUT, e.id + '.png');
    if (index[e.id] && index[e.id].hash === hash && fs.existsSync(file)) continue;
    todo.push({ e, hash, file });
  }
  let changed = false;
  for (const id of Object.keys(index)) {
    if (keep.has(id)) continue;
    const file = path.join(OUT, id + '.png');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    delete index[id];
    changed = true;
    console.log('removed', id, '(no longer upcoming)');
  }
  for (const f of fs.readdirSync(OUT)) {
    const id = f.replace(/\.png$/, '');
    if (f.endsWith('.png') && !keep.has(id)) { fs.unlinkSync(path.join(OUT, f)); changed = true; console.log('removed stray', f); }
  }
  if (todo.length) {
    const srv = await serve();
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 1 });
      for (const t of todo) {
        const url = 'http://127.0.0.1:' + PORT + '/card.html?event=' + encodeURIComponent(t.e.id);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.waitForSelector('#cTicket:not([hidden]), #cNone:not([hidden])', { timeout: 30000 });
        const painted = await page.evaluate(() => !document.getElementById('cTicket').hidden);
        if (!painted) { console.log('skipped', t.e.id, '(the card page could not paint it)'); continue; }
        await page.evaluate(() => document.fonts.ready);
        await new Promise(r => setTimeout(r, 300));
        await page.screenshot({ path: t.file, type: 'png', clip: { x: 0, y: 0, width: 1080, height: 1350 } });
        index[t.e.id] = { hash: t.hash, rendered: new Date().toISOString(), title: t.e.title, when: t.e.when };
        changed = true;
        console.log('rendered', t.e.id, Math.round(fs.statSync(t.file).size / 1024) + ' KB');
      }
    } finally {
      await browser.close();
      srv.close();
    }
  }
  if (changed) {
    const sorted = {};
    for (const k of Object.keys(index).sort()) sorted[k] = index[k];
    fs.writeFileSync(INDEX, JSON.stringify(sorted, null, 2) + '\n');
  }
  console.log(changed ? 'cards updated' : 'cards up to date');
})().catch(err => { console.error(err); process.exit(1); });
