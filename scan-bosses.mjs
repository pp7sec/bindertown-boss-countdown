import fs from 'node:fs';
import { Client } from 'colyseus.js';

// ---- config ----
const cfg = JSON.parse(fs.readFileSync('config.json','utf8'));
const baseUrl = 'https://play.bindertowngame.com';
const CH = 10; // field boss channel (PvP)

// human-readable Thai labels for bosses (fallback to title-case mobType)
const NAMES = {
  bloom_crowned_stag: 'กวางมงกุฎบุปผา',
  prism_shell_sovereign: 'จักรพรรดิกระดองปริซึม',
  cinder_plume_roc: 'ร็อคขนเพลิงถ่าน',
  lotus_maw_matriarch: 'มารดาอสูรปากบัว',
  dusk_herald: 'ผู้ประกาศสนธยา',
  aurora_antler_regent: 'ราชันเขากวางออโรร่า',
  tempest_kite_empress: 'จักรพรรดินีว่าวพายุ',
  opal_weaver_queen: 'ราชินีช่างทอโอปอล',
  vale_warden: 'ผู้พิทักษ์หุบผา',
};
const MAP_LABELS = {
  bloomcrown_glade: 'Bloomcrown Glade',
  ancient_ruins: 'Ancient Ruins',
  cinder_eyrie: 'Cinder Eyrie',
  lotus_hollow: 'Lotus Hollow',
  duskgate_pass: 'Duskgate Pass',
  aurora_hollow: 'Aurora Hollow',
  tempest_aerie: 'Tempest Aerie',
  opalweb_grotto: 'Opalweb Grotto',
  wardens_seat: "Warden's Seat",
};
function label(mobType, map) {
  return {
    id: mobType,
    th: NAMES[mobType] || mobType.split('_').map(w=>w[0].toUpperCase()+w.slice(1)).join(' '),
    map: MAP_LABELS[map] || map,
  };
}

// ---- auth ----
const jar = {};
function cookie(){ return Object.entries(jar).map(([k,v])=>k+'='+v).join('; '); }
async function api(m,p,b){
  const headers={'Content-Type':'application/json'};
  const c=cookie(); if(c) headers.Cookie=c;
  const r=await fetch(baseUrl+p,{method:m,headers,body:b?JSON.stringify(b):undefined});
  for(const sc of (r.headers.getSetCookie?r.headers.getSetCookie():[])){const mm=sc.match(/^([^=]+)=([^;]*)/);if(mm)jar[mm[1]]=mm[2];}
  return {ok:r.ok,data:await r.json().catch(()=>null)};
}

const lr = await api('POST','/api/local/login',{username:cfg.username,password:cfg.password});
const me = await api('GET','/api/me');
const key = me.data.account.key;
const name = (me.data.character && me.data.character.name) || cfg.username;

const topo = await api('GET','/api/topology');
const count = topo.data.count || 1;
const maps = topo.data.maps || [];

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
      client.joinOrCreate(`map_${map}_ch${CH}`, { name, gender:'f', profile:key, autoChannel:false }),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), 5000)),
    ]);
  } catch (e) { return null; }
  await new Promise(r=>setTimeout(r,1500));
  const st = room.state;
  const worldTime = st.worldTime;
  const graves = [];
  try { for (const [id,g] of st.graves) graves.push({ mobType:g.mobType, level:g.level, killer:g.killer, at:g.at, respawnAt:g.respawnAt }); } catch(e){}
  try { await room.leave(); } catch {}
  return { worldTime, graves };
}

console.log('scanning', maps.length, 'maps on ch', CH, '...');
const scannedAt = Date.now();
const bosses = [];
for (const map of maps) {
  const r = await scanMap(map);
  if (!r) continue;
  for (const g of r.graves) {
    const remainingMs = Math.max(0, g.respawnAt - r.worldTime);
    const intervalMs = Math.max(0, g.respawnAt - g.at);
    const L = label(g.mobType, map);
    bosses.push({
      id: L.id,
      name: L.th,
      map: L.map,
      level: g.level,
      killer: g.killer || null,
      remainingMs,
      intervalMs,
      channel: CH,
    });
  }
}
// sort by remaining time
bosses.sort((a,b)=>a.remainingMs-b.remainingMs);

const out = { scannedAt, generatedAt: new Date().toISOString(), count: bosses.length, bosses };
fs.writeFileSync('bosses.json', JSON.stringify(out, null, 2));
console.log('\nwrote bosses.json with', bosses.length, 'bosses:');
for (const b of bosses) {
  const s = Math.floor(b.remainingMs/1000);
  console.log(`  ${b.name} (${b.map}) LV${b.level} -> ${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m${s%60}s`);
}
process.exit(0);
