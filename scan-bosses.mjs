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
  const r = await fetch(baseUrl + '/api/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const d = await r.json();
  if (!d || !d.account || !d.account.key) throw new Error('guest create failed: ' + JSON.stringify(d).slice(0, 200));
  return { key: d.account.key, name: 'guest' };
}

let identity;
try {
  identity = await createGuest();
  console.log('guest created:', identity.key.slice(0, 10) + '...');
} catch (e) {
  // fallback to local config.json (for local dev)
  console.log('guest failed, falling back to config.json:', e.message);
  const cfg = JSON.parse(fs.readFileSync('config.json', 'utf8'));
  const r = await fetch(baseUrl + '/api/local/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.username, password: cfg.password }),
  });
  const d = await r.json();
  identity = { key: d.account.key, name: cfg.username };
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
  room.onMessage('server', () => {}); // suppress warning
  await new Promise(r => setTimeout(r, 1200));
  const st = room.state;
  const worldTime = st.worldTime;
  const graves = [];
  try { for (const [id, g] of st.graves) graves.push({ mobType: g.mobType, level: g.level, killer: g.killer, at: g.at, respawnAt: g.respawnAt }); } catch (e) {}
  try { await room.leave(); } catch {}
  return { worldTime, graves };
}

// แมพที่มี Field Boss / gatekeeper (สแกนแค่กลุ่มนี้ → เร็ว ~20 วิ)
const BOSS_MAPS = [
  'bloomcrown_glade', 'ancient_ruins', 'cinder_eyrie', 'lotus_hollow',
  'duskgate_pass', 'cloudspire_ruins', 'aurora_hollow', 'tempest_aerie',
  'opalweb_grotto', 'wardens_seat',
];

console.log('scanning', BOSS_MAPS.length, 'boss maps on ch', CH, '...');
const scannedAt = Date.now();
const bosses = [];
for (const map of BOSS_MAPS) {
  const r = await scanMap(map);
  if (!r) continue;
  for (const g of r.graves) {
    const remainingMs = Math.max(0, g.respawnAt - r.worldTime);
    const intervalMs = Math.max(0, g.respawnAt - g.at);
    bosses.push({
      id: g.mobType,
      name: gameName(g.mobType),
      map: MAP_LABELS[map] || map,
      level: g.level,
      killer: g.killer || null,
      remainingMs,
      intervalMs,
      channel: CH,
      sprite: `https://play.bindertowngame.com/sprites/mob/${g.mobType}/idle/0.png`,
    });
  }
}
bosses.sort((a, b) => a.remainingMs - b.remainingMs);

const out = { scannedAt, generatedAt: new Date().toISOString(), count: bosses.length, bosses };
fs.writeFileSync('bosses.json', JSON.stringify(out, null, 2));
console.log('wrote bosses.json with', bosses.length, 'bosses');
for (const b of bosses) {
  const s = Math.floor(b.remainingMs / 1000);
  console.log(`  ${b.name} (${b.map}) LV${b.level} -> ${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`);
}
process.exit(0);
