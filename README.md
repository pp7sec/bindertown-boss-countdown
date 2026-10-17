# 🐉 Binder Town · Boss Countdown

เว็บนับถอยหลังเวลาเกิด Field Boss ของเกม Binder Town (bindertowngame.com)

- แสดงบอสที่กำลัง "รอเกิด" แยกเป็น **Mini Boss (20 นาที)** และ **บอสใหญ่ (3 ชม.)**
- Field Boss เกิดเฉพาะ **Channel 10 (PvP)**
- ข้อมูลอ่านจาก WebSocket state ของเกม (Colyseus `state.graves`)

## สถาปัตยกรรม
```
[Updater: GitHub Actions]  --guest--> เกม  → scan → bosses.json → commit
                                                                   ↓
[ผู้ชมเว็บ]  <--------------- อ่าน bosses.json (static) ---------- GitHub Pages
```
- **ผู้ชม** อ่านแค่ `bosses.json` บน Pages → เร็ว ฟรี ไม่แตะเกม
- **Updater** ต่อเกมแค่ตัวเดียว โดยสร้าง **guest** สดทุกครั้ง → **ไม่ต้องมี credential/Secrets**

## หน้าตาเว็บ
เปิดดูที่ GitHub Pages: `https://<user>.github.io/<repo>/`

## ทำงานอัตโนมัติ
- GitHub Actions รัน `scan-bosses.mjs` ทุก **5 นาที** (cron) แล้ว commit `bosses.json` กลับ
- กดรัน manual ได้จากแท็บ **Actions → Scan bosses → Run workflow**
- เว็บ re-fetch `bosses.json` ทุก 60 วิ

## รันเองในเครื่อง (dev)
```bash
npm install
node scan-bosses.mjs     # สร้าง guest อัตโนมัติ + เขียน bosses.json
npx serve .              # เปิดเว็บดู
```
> ไม่ต้องมี `config.json` ก็ได้ (สคริปต์สร้าง guest เอง) — แต่ถ้าอยากใช้บัญชีตัวเอง
> ให้สร้าง `config.json` (`{"username":"...","password":"..."}`) เป็น fallback

## หลักการ (reverse-engineered)
1. `POST /api/guest` → ได้ guest key
2. `GET /api/topology` → จำนวน shard (20) + รายชื่อแมพ
3. `shard = (mapIndex + channel - 1) % 20` → path `/s<N>`
4. เชื่อม `wss://play.bindertowngame.com/s<N>` เข้าห้อง `map_<map>_ch10`
5. อ่าน `state.graves` (mobType, level, killer, at, respawnAt) + `state.worldTime`
6. `remaining = respawnAt - worldTime`

## หมายเหตุ
- `worldTime` เป็นเวลาของแต่ละ shard (ไม่ใช่เวลากลาง) แต่วิ่ง 1:1 กับเวลาจริง
- ใช้เพื่อการศึกษาเท่านั้น
