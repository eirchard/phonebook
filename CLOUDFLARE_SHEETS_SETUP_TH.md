# สมุดโทรศัพท์ v19 — ทดสอบ Cloudflare อ่าน Google Sheets โดยตรง (ยังไม่เปิดใช้จริง)

## ข้อมูลที่ตรวจยืนยันแล้ว

- Spreadsheet ID: `1oUcCkUe6jzEZ5GttSc-xTwAhT_16-NqrqevShMwlRSo`
- ชีต **รายชื่อ**: หัวคอลัมน์ `รหัส, ชื่อ, นามสกุล, เบอร์โทรศัพท์, ฝ่าย/แผนก, ตำแหน่ง, เผยแพร่, LINE ID`
- ชีต **หน่วยงาน**: หัวคอลัมน์ `รหัส, ชื่อหน่วยงาน, รหัสสังกัด, ชนิด, ลำดับ, ใช้งาน`
- ยืนยันการอ่านผ่าน Google Drive ของ ChatGPT ได้แล้ว แต่ **Cloudflare ยังไม่ได้รับสิทธิ์อ่านข้อมูล**

## เรื่องสำคัญก่อนติดตั้ง

ไฟล์ `cloudflare/phonebook-sheets-readonly.js` เป็น **Worker ทดสอบสำหรับอ่านข้อมูลเท่านั้น** ไม่ใช่ระบบหลังบ้านเต็มรูปแบบ, ไม่รองรับการเพิ่ม/แก้ไข/ลบ และไม่ควรแทนที่ Worker ตัวจริงที่กำลังใช้งานหรือเปิดใน `config.js` จนกว่าระบบอ่าน–เขียนพร้อมและทดสอบครบแล้ว

โปรดสร้าง Worker ใหม่ชื่อ `phonebook-sheets-test` (ไม่เขียนทับ `phonebook-api`) และไม่เปลี่ยนค่า `config.js` ใน GitHub

## 1. สร้าง Google Service Account

1. ไป `https://console.cloud.google.com/` ด้วยบัญชี Google ที่จัดการโปรเจกต์ได้
2. เลือกหรือสร้างโปรเจกต์สำหรับสมุดโทรศัพท์
3. ไป **APIs & Services → Library** แล้วเปิดใช้ **Google Sheets API**
4. ไป **IAM & Admin → Service Accounts → Create Service Account** ตั้งชื่อ เช่น `phonebook-cloudflare-reader`
5. กดสร้าง และจดอีเมลที่ลงท้ายด้วย `.iam.gserviceaccount.com`
6. เข้า Service Account → **Keys → Add key → Create new key → JSON** และเก็บไฟล์ JSON อย่างปลอดภัยในเครื่องของคุณ

⚠️ ห้ามส่งไฟล์ JSON key หรือเนื้อหาคีย์เข้าแชต, อีเมล, หรือ GitHub เพราะเป็นข้อมูลสำหรับเข้าสู่ระบบ Google API

## 2. แชร์ Google Sheets ให้ Service Account

เปิดชีต `https://docs.google.com/spreadsheets/d/1oUcCkUe6jzEZ5GttSc-xTwAhT_16-NqrqevShMwlRSo/edit` → **แชร์** → ใส่อีเมลของ Service Account ที่สร้าง → ให้สิทธิ์ **ผู้มีสิทธิ์อ่าน (Viewer)** สำหรับขั้นทดสอบเท่านั้น

**หมายเหตุ:** แชร์ให้ `eirchard49@gmail.com` ก่อนหน้านี้ไม่ได้เท่ากับแชร์ให้ Service Account

## 3. ตั้งค่า Cloudflare Worker ทดสอบ

1. Cloudflare Dashboard → Workers & Pages → Create → Worker ตั้งชื่อ `phonebook-sheets-test` (แยกจาก Worker ปัจจุบัน)
2. เข้า Edit code แล้วแทนโค้ดทั้งหมดด้วยไฟล์ `cloudflare/phonebook-sheets-readonly.js` จาก GitHub จากนั้น Deploy
3. ไปที่ Settings → Variables and Secrets (บางหน้าจะเรียก Variables) → Add → ชื่อ `PHONEBOOK_GOOGLE_CREDENTIALS_JSON` → ประเภท **Secret / Encrypt** → วาง **เนื้อหาไฟล์ JSON** ที่ได้มาจากขั้นตอน 1 (อย่าใช้ Plaintext Variable)
4. Save แล้ว Deploy อีกครั้งหาก Dashboard ขอให้เผยแพร่การตั้งค่า
5. เปิด `https://phonebook-sheets-test.<subdomain>.workers.dev/health` ต้องแสดง `"ok": true`, `"backendVersion": "google-sheets-direct-readonly-v19"`, `"sheetAccessible": true`
6. เปิด `/api?action=list` เพื่อทดสอบอ่านรายชื่อที่เผยแพร่; อย่าเผยแพร่ภาพข้อมูลบุคลากรส่วนตัวในแชต

## 4. ขั้นต่อไป

หลัง `/health` ผ่านแล้ว จึงค่อยพัฒนาและทดสอบ API สำหรับเพิ่ม/แก้ไข/ลบและระบบ Admin ให้ครบ ก่อนสลับ `config.js` บน GitHub ไปใช้ Worker ใหม่ การเขียนข้อมูลต้องมี Service Account **Editor** และมาตรการรักษาความปลอดภัยของ Worker เพิ่มเติม ห้ามเปิดสิทธิ์เขียนให้ผู้ใช้ทั่วไป

GitHub ชุดเดิม `eirchard/phonebook` และ Cloudflare Worker `phonebook-api` เดิมยังคงเหมือนเดิม และไม่มีการลบหรือแก้ข้อมูลในชีตจากขั้นตอนเตรียมนี้
