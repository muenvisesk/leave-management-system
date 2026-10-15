# Leave Management System

ระบบจัดการการลา เชื่อม Oracle Database schema `LEAVE`

## โครงสร้าง
- `server.js` = Backend Node.js + Express + Oracle
- `public/` = หน้าเว็บไซต์
- `.env` = ค่าการเชื่อมต่อ Oracle

## บัญชีทดสอบ
- Employee: `EMP001 / 1234`
- Supervisor: `EMP006 / 1234`
- Department Manager: `EMP007 / 1234`
- HR: `EMP008 / 1234`

> ใน schema ตัวอย่าง password_hash เป็น `CHANGE_ME_HASH` เพื่อการทดสอบเท่านั้น

## วิธีรัน
1. ติดตั้ง Node.js
2. เปิด Command Prompt ในโฟลเดอร์นี้
3. `npm install`
4. คัดลอก `.env.example` เป็น `.env`
5. ตรวจสอบ Oracle service `XEPDB1`
6. `node server.js`
7. เปิด `http://localhost:3000`
