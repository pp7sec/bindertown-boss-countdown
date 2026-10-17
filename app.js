// Binder Town — Boss Countdown (static, reads bosses.json)
const APP = document.getElementById('app');
const UPDATED = document.getElementById('updated');

let data = null;

function fmt(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtLabel(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} ชม. ${m} น.`;
  if (m > 0) return `${m} น. ${sec} วิ`;
  return `${sec} วิ`;
}

// เวลาที่ผ่านไปตั้งแต่บอสเกิด (ตอนขึ้น "เกิดแล้ว")
function fmtAgo(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} ชม. ${m} นาที`;
  if (m > 0) return `${m} นาที`;
  return `${s} วินาที`;
}

function render() {
  if (!data || !data.bosses) {
    APP.innerHTML = '<div class="status">โหลดไม่สำเร็จ — ตรวจสอบ bosses.json</div>';
    return;
  }
  const now = Date.now();
  const elapsed = now - data.scannedAt;

  // compute remaining, sort soonest-first
  const list = data.bosses.map((b) => {
    const remain = b.remainingMs - elapsed;
    const pct = b.intervalMs > 0 ? Math.max(0, Math.min(100, (1 - remain / b.intervalMs) * 100)) : 0;
    return { ...b, remain, pct };
  }).sort((a, b) => a.remain - b.remain);

  // split into mini boss (20 min) vs big boss (3 h)
  const MINI_MS = 20 * 60 * 1000;
  const mini = list.filter((b) => b.intervalMs <= MINI_MS);
  const big = list.filter((b) => b.intervalMs > MINI_MS);

  const cardHtml = (b) => {
    const alive = b.remain <= 0;
    const soon = !alive && b.remain < 5 * 60 * 1000; // < 5 min
    const killer = b.killer ? `<b>ปราบโดย ${escapeHtml(b.killer)}</b> · ` : '';
    const timerCls = alive ? 'timer alive' : `timer${soon ? ' soon' : ''}`;
    const timerText = alive
      ? `เกิดแล้ว 🟢 <span class="unit">· ${fmtAgo(-b.remain)}</span>`
      : fmt(b.remain);
    const sprite = b.sprite || `https://play.bindertowngame.com/sprites/mob/${b.id}/idle/0.png`;
    return `
      <div class="card">
        <div class="top">
          <img class="sprite" src="${escapeHtml(sprite)}" alt="${escapeHtml(b.name)}" loading="lazy"
               onerror="this.style.visibility='hidden'">
          <span class="lv">Lv ${b.level}</span>
          <span class="name" title="${escapeHtml(b.id)}">${escapeHtml(b.name)}</span>
        </div>
        <div class="${timerCls}">${timerText}</div>
        <div class="meta">${killer}${escapeHtml(b.map)} · Ch${b.channel} · รอบเกิด ${fmtLabel(b.intervalMs)}</div>
        <div class="bar"><span style="width:${b.pct.toFixed(2)}%"></span></div>
      </div>`;
  };

  const secMini = mini.length
    ? `<section class="group"><h2 class="sec-title">🟣 Mini Boss <span>เกิดทุก 20 นาที</span></h2>${mini.map(cardHtml).join('')}</section>`
    : '';
  const secBig = big.length
    ? `<section class="group"><h2 class="sec-title">👑 บอสใหญ่ <span>เกิดทุก 3 ชั่วโมง</span></h2>${big.map(cardHtml).join('')}</section>`
    : '';

  APP.innerHTML = secMini + secBig;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

let lastLoadedAt = 0;

async function load() {
  try {
    const res = await fetch('bosses.json?t=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const fresh = await res.json();
    data = fresh;
    lastLoadedAt = Date.now();
    if (UPDATED) {
      const d = new Date(data.scannedAt);
      UPDATED.textContent = 'ข้อมูลล่าสุด: ' + d.toLocaleString('th-TH');
    }
    render();
  } catch (e) {
    // keep showing old data if we already have some; only show error on first load
    if (!data) {
      APP.innerHTML = '<div class="status">โหลดไม่สำเร็จ: ' + escapeHtml(e.message) + '</div>';
    } else if (UPDATED) {
      UPDATED.textContent = 'ข้อมูลล่าสุด: ' + new Date(data.scannedAt).toLocaleString('th-TH') + ' (อัปเดตใหม่ไม่สำเร็จ)';
    }
  }
}

// --- รอบอัปเดตอัตโนมัติ (ทุก 5 นาที ที่นาที 0,5,10,15,...) ---
const PERIOD = 5 * 60 * 1000;
function nextBoundary() {
  return (Math.floor(Date.now() / PERIOD) + 1) * PERIOD;
}
let nextUpd = nextBoundary();

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m} นาที ${String(sec).padStart(2, '0')} วินาที`;
}

function tickUpdate() {
  if (Date.now() >= nextUpd) {
    // ถึงรอบ → ดึงข้อมูลใหม่ แล้วตั้งรอบถัดไป
    load();
    nextUpd = nextBoundary();
  }
  const el = document.getElementById('next-upd');
  if (el) el.textContent = fmtCountdown(nextUpd - Date.now());
}

load();
setInterval(render, 1000);        // นับถอยหลังบอสติ๊กทุก 1 วิ
setInterval(tickUpdate, 1000);    // นับรอบอัปเดต + auto refresh ตอนครบ
setInterval(load, 60000);         // re-fetch สำรองทุก 60 วิ
