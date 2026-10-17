import fs from 'node:fs';
import { Client } from 'colyseus.js';

// ---- config ----
const baseUrl = 'https://play.bindertowngame.com';
const CH = 10; // field boss channel (PvP)

// ชื่อจริงในเกม = title-case ของ mobType (ตรงกับฟังก์ชัน ae() ในโค้ด client)
function gameName(t) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
const MAP_LABELS = {
  bloomcrown_glade: 'Bloomcrown Glade',
  ancient_ruins: 'Ancient Ruins',
  cinder_eyrie: 'Cinder Eyrie',
  lotus_hollow: 'Lotus Hollow',
  duskgate_pass: 'Duskgate Pass',
  cloudspire_ruins: 'Cloudspire Ruins',
  aurora_hollow: 'Aurora Hollow',
  tempest_aerie: 'Tempest Aerie',
  opalweb_grotto: 'Opalweb Grotto',
  wardens_seat: "Warden's Seat",
};
function label(mobType, map) {
  return {
    id: mobType,
    name: gameName(mobType), // ชื่อจริงในเกม (อังกฤษ)
    map: MAP_LABELS[map] || map,
  };
}

// ---- identity: create a fresh GUEST (no credentials needed) ----
async function createGuest() {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(baseUrl + '/api/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'boss-countdown/1.0' },
        body: '{}',
      });
      const text = await r.text();
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + text.slice(0, 80));
      let d;
      try { d = JSON.parse(text); } catch { throw new Error('non-JSON: ' + text.slice(0, 80)); }
      if (!d || !d.account || !d.account.key) throw new Error('no key: ' + text.slice(0, 80));
      return { key: d.account.key, name: 'guest' };
    } catch (e) {
      lastErr = e;
      console.log(`guest attempt ${attempt}/5 failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw lastErr;
}

let identity;
try {
  identity = await createGuest();
  console.log('guest created:', identity.key.slice(0, 10) + '...');
} catch (e) {
  console.log('guest failed after retries:', e.message);
  // fallback to local config.json (for local dev only)
  if (fs.existsSync('config.json')) {
    const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    const r = await fetch(baseUrl + '/api/local/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    });
    const d = await r.json();
    identity = { key: d.account.key, name: cfg.username };
  } else {
    // ไม่มี fallback → ข้ามรอบนี้ (ไม่ให้ job fail + ไม่ส่งเมล)
    console.log('no fallback available — skipping this run (exit 0)');
    process.exit(0);
  }
}

const key = identity.key;
const name = identity.name;

const topoRes = await fetch(baseUrl + '/api/topology');
const topo = await topoRes.json();
const count = topo.count || 1;
const maps = topo.maps || [];

function shardFor(map, ch) {
  const idx = maps.indexOf(map);
  const s = (idx + Math.max(1, Math.floor(ch)) - 1) % count;
  return s > 0 ? `/s${s}` : '';
}

let worldBoss = null;      // {id,state,startAt,endsAt,nextAt,frac,engaged,fighters}
let worldBossLast = null;  // {at,seconds,fighters}

async function scanMap(map) {
  const shard = shardFor(map, CH);
  const client = new Client('wss://play.bindertowngame.com' + shard);
  let room;
  try {
    room = await Promise.race([
      client.joinOrCreate(`map_${map}_ch${CH}`, { name, gender: 'f', profile: key, autoChannel: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ]);
  } catch (e) { return null; }
  room.onMessage('server', (msg) => {
    const arr = Array.isArray(msg) ? msg : [msg];
    for (const m of arr) {
      if (m && m.type === 'worldBoss' && m.view) worldBoss = m.view;
      if (m && m.type === 'worldBossLast') worldBossLast = { at: m.at, seconds: m.seconds, fighters: m.fighters };
    }
  });
  await new Promise(r => setTimeout(r, 1200));
  const st = room.state;
  const worldTime = st.worldTime;
  const readAt = Date.now();
  const graves = [];
  try {
    for (const [id, g] of st.graves) {
      graves.push({
        mobType: g.mobType,
        level: g.level,
        killer: g.killer,
        remainingMs: Math.max(0, g.respawnAt - worldTime),
        intervalMs: Math.max(0, g.respawnAt - g.at),
        readAt,
      });
    }
  } catch (e) {}
  try { await room.leave(); } catch {}
  return { worldTime, graves };
}

// บอสทั้งหมดในเกม (mobType → แมพ + รอบเกิด + เลเวล)
const BOSS_DEFS = [
  // Field Boss (3 ชม.)
  { mobType: 'bloom_crowned_stag', map: 'bloomcrown_glade', intervalMs: 3 * 3600e3, level: 25 },
  { mobType: 'prism_shell_sovereign', map: 'ancient_ruins', intervalMs: 3 * 3600e3, level: 25 },
  { mobType: 'cinder_plume_roc', map: 'cinder_eyrie', intervalMs: 3 * 3600e3, level: 36 },
  { mobType: 'lotus_maw_matriarch', map: 'lotus_hollow', intervalMs: 3 * 3600e3, level: 40 },
  { mobType: 'aurora_antler_regent', map: 'aurora_hollow', intervalMs: 3 * 3600e3, level: 58 },
  { mobType: 'tempest_kite_empress', map: 'tempest_aerie', intervalMs: 3 * 3600e3, level: 70 },
  { mobType: 'opal_weaver_queen', map: 'opalweb_grotto', intervalMs: 3 * 3600e3, level: 80 },
  { mobType: 'vale_warden', map: 'wardens_seat', intervalMs: 3 * 3600e3, level: 99 },
  // Mini-boss (20 นาที)
  { mobType: 'dusk_herald', map: 'duskgate_pass', intervalMs: 20 * 60e3, level: 47 },
  { mobType: 'sky_sentinel', map: 'cloudspire_ruins', intervalMs: 20 * 60e3, level: 72 },
  { mobType: 'vale_keeper', map: 'ancient_ruins', intervalMs: 20 * 60e3, level: 22 },
];
const BOSS_MAPS = [...new Set(BOSS_DEFS.map((b) => b.map))];

console.log('scanning', BOSS_MAPS.length, 'maps for', BOSS_DEFS.length, 'bosses on ch', CH, '...');
const scannedAt = Date.now();

// สแกนแมพ → เก็บ graves แยกตามแมพ
const gravesByMap = {};
for (const map of BOSS_MAPS) {
  const r = await scanMap(map);
  if (!r) continue;
  gravesByMap[map] = {};
  for (const g of r.graves) gravesByMap[map][g.mobType] = g;
}

// สร้างรายการบอสครบทุกตัว (dead = มีหลุมศพ, alive = ยังไม่ตาย)
const bosses = [];
for (const def of BOSS_DEFS) {
  const g = gravesByMap[def.map] && gravesByMap[def.map][def.mobType];
  const base = {
    id: def.mobType,
    name: gameName(def.mobType),
    map: MAP_LABELS[def.map] || def.map,
    channel: CH,
    sprite: `https://play.bindertowngame.com/sprites/mob/${def.mobType}/idle/0.png`,
  };
  if (g) {
    bosses.push({
      ...base,
      state: 'dead',
      level: g.level || def.level,
      killer: g.killer || null,
      respawnAt: g.readAt + g.remainingMs, // เวลาจริง (Unix ms) ที่บอสจะเกิด
      intervalMs: g.intervalMs || def.intervalMs,
      remainingMs: g.remainingMs,
    });
  } else {
    bosses.push({ ...base, state: 'alive', level: def.level, killer: null, respawnAt: null, intervalMs: def.intervalMs, remainingMs: null });
  }
}
bosses.sort((a, b) => a.remainingMs - b.remainingMs);

const out = {
  scannedAt,
  generatedAt: new Date().toISOString(),
  count: bosses.length,
  bosses,
  worldBoss: worldBoss
    ? {
        id: worldBoss.id,
        state: worldBoss.state,
        startAt: worldBoss.startAt || 0,
        endsAt: worldBoss.endsAt || 0,
        nextAt: worldBoss.nextAt || 0,
        fighters: worldBoss.fighters || 0,
      }
    : null,
  worldBossLast: worldBossLast || null,
};
fs.writeFileSync('bosses.json', JSON.stringify(out, null, 2));
console.log('worldBoss:', JSON.stringify(out.worldBoss));
console.log('wrote bosses.json with', bosses.length, 'bosses');
for (const b of bosses) {
  const s = Math.floor(b.remainingMs / 1000);
  console.log(`  ${b.name} (${b.map}) LV${b.level} -> ${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`);
}
process.exit(0);
