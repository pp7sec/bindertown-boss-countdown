# 🐉 Binder Town · Boss Countdown

เว็บนับถอยหลังเวลาเกิด Field Boss ของเกม Binder Town (bindertowngame.com)

- แสดงบอสประจำแมพทั้งหมดที่กำลัง "รอเกิด" พร้อมเวลานับถอยหลังเรียลไทม์
- Field Boss เกิดเฉพาะ **Channel 10 (PvP)**
- ข้อมูลอ่านจาก WebSocket state ของเกม (Colyseus `state.graves`) — ไม่ใช่ API ทางการ

## หน้าตา
![screenshot](https://via.placeholder.com/760x400?text=Boss+Countdown)

## วิธีใช้

### 1. รันตัวเว็บ (ไม่ต้องมี backend)
เปิด `index.html` โดยตรง หรือใช้ static server:
```bash
npx serve .
```
เว็บอ่านไฟล์ `bosses.json` และนับถอยหลังในเบราว์เซอร์

### 2. อัปเดตข้อมูลบอส (scan ใหม่)
```bash
npm install
Copy-Item config.example.json config.json   # ใส่ username/password
npm run scan                                 # เขียน bosses.json ใหม่
```
สคริปต์ `scan-bosses.mjs` จะ login เข้าเกม แล้วเชื่อม Colyseus ไปทุกแมพ (Channel 10)
อ่าน `state.graves` + `state.worldTime` แล้วเขียน `bosses.json`

## หลักการ (reverse-engineered)
1. Login HTTP → ได้ account key
2. `GET /api/topology` → ได้จำนวน shard (20) + รายชื่อแมพ
3. คำนวณ shard: `shard = (mapIndex + channel - 1) % 20` → path `/s<N>`
4. เชื่อม `wss://play.bindertowngame.com/s<N>` เข้าห้อง `map_<map>_ch10`
5. อ่าน `state.graves` (mobType, level, killer, at, respawnAt) + `state.worldTime`
6. `remaining = respawnAt - worldTime`

## ไฟล์
- `index.html` / `style.css` / `app.js` — เว็บนับถอยหลัง (static)
- `bosses.json` — ข้อมูลบอส (scan มา)
- `scan-bosses.mjs` — scanner (Node + colyseus.js)

## หมายเหตุ
- ข้อมูล ณ เวลาที่ scan ครั้งล่าสุด (`scannedAt` ใน bosses.json) เว็บจะนับถอยหลังต่อจากตรงนั้น
- `worldTime` ของเกมเป็นเวลาของแต่ละ shard (ไม่ใช่เวลากลาง) แต่วิ่ง 1:1 กับเวลาจริง
- ใช้เพื่อการศึกษาเท่านั้น — อย่าใช้ในทางที่ผิด
