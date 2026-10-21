# สมุดโทรศัพท์บุคลากร — Cloudflare Worker bridge (ชุดเตรียมเชื่อมต่อ v18)

ระบบนี้นำสถาปัตยกรรมของระบบอัปโหลดรูปบุคลากรมาประยุกต์:
GitHub Pages (`eirchard/phonebook`) → Cloudflare Worker → Google Apps Script Web App `/exec` → Google Sheets เดิม

**ข้อจำกัดสำคัญ:** Cloudflare ไม่สามารถเปิดหรือแก้ไข Apps Script Editor ที่ขึ้น 404 ให้ได้ และไม่ใช่เครื่องมือ Deploy `Code.gs`. ต้องมี Apps Script Web App `/exec` ที่เข้าถึงได้และใช้ Code.gs v17 ก่อน จึงจะใช้เมนูจัดการหน่วยงาน v17 ได้ครบ. เราไม่ได้ย้ายข้อมูลหรือสร้างชีตใหม่.

## สิ่งที่จัดเตรียมให้

- `cloudflare/phonebook-worker.js`: Worker แยกจากระบบอัปโหลดรูป, รองรับการอ่าน JSONP / บันทึก HTML form / ตรวจ status โดยไม่แก้ frontend transport จำนวนมาก
- `config.js`: กำหนด API กลาง โดยตั้งค่า `apiUrl` ว่างไว้เพื่อรักษาระบบเดิมจนกว่าทดสอบ Worker สำเร็จ
- `index.html` และ `admin.html`: รองรับ URL Worker ผ่าน config.js และยัง fallback ไป Apps Script URL เดิม
- `Code.gs`: ชุด v17 สำหรับสำรองและใช้ภายหลังเมื่อเข้าถึงโปรเจกต์ Apps Script ได้ (ไม่เคย push เข้า Apps Script ในขั้นตอนนี้)

## ติดตั้ง Worker ด้วยวิธีเดียวกับระบบรูปบุคลากร

1. เปิด https://dash.cloudflare.com/ ด้วยบัญชี Cloudflare ที่ดูแลระบบรูปบุคลากร
2. Workers & Pages → Create application → Create Worker → ตั้งชื่อ `phonebook-api` (แยกจาก `personnel-photo-api`)
3. Deploy จากนั้นเข้า Edit Code แล้ววางทั้งหมดจากไฟล์ `cloudflare/phonebook-worker.js` → Deploy/Save and Deploy
4. เปิด `https://phonebook-api.<subdomain>.workers.dev/health` ในเบราว์เซอร์โดย **ไม่ต้องเข้าสู่ระบบ Google**
5. **ผ่าน** เมื่อได้ HTTP 200 และ `"ok":true`, `"backendVersion":"v17"`, `"sheetAccessible":true`. ถ้า 503 / 404 / ข้อความชี้ว่ารุ่น Backend ไม่ตรง ให้หยุดไว้ก่อน **อย่า**เปลี่ยนหน้าเว็บหลัก เพราะ Cloudflare Worker ต้องพึ่ง Apps Script ที่ใช้งานได้
6. ส่งเฉพาะ Worker URL รูปแบบ `https://phonebook-api.<subdomain>.workers.dev` ให้ ChatGPT; เราจะเปลี่ยน `config.js` ให้ชี้ `https://phonebook-api.<subdomain>.workers.dev/api` ใน GitHub อัตโนมัติ
7. ทดสอบ `https://eirchard.github.io/phonebook/` ทั้งค้นหา เพิ่มรายชื่อ Login Admin จัดการฝ่ายงานและตรวจรายชื่อซ้ำ

หมายเหตุ: `https://script.google.com/home/projects/.../edit` (Script ID) ไม่ใช่ API URL; ต้องใช้ `/macros/s/.../exec` ซึ่งอยู่ในไฟล์ Worker นี้เป็นค่าเริ่มต้น ถ้าคุณเปลี่ยน deployment ใหม่ ให้แก้ Worker variable `PHONEBOOK_GAS_URL` เป็น URL ใหม่บน Dashboard (ไม่ใช่ Editor URL).

## ความปลอดภัยและการย้อนกลับ

- Worker จำกัดคำสั่ง GET เป็น `list`, `status`, `health`; คำสั่งแก้ไขใช้ POST และ backend ต้องตรวจ Admin session เอง
- ไม่มีรหัสผ่าน Google, OAuth token หรือรหัสผ่าน Admin ในไฟล์นี้ ไม่ควรใส่ข้อมูลลับลง GitHub
- `health` ทดสอบ **ทั้ง** Worker และ Apps Script v17 พร้อม Google Sheets ไม่ใช่ตรวจ Worker อย่างเดียว
- หลีกเลี่ยงการกดบันทึกซ้ำเมื่อเครือข่ายขัดข้อง; หน้าเว็บใช้ `requestId` สำหรับตรวจสถานะย้อนหลัง
- ถ้าระบบผ่าน Worker มีปัญหา ให้ตั้ง `apiUrl: ''` ใน `config.js` เพื่อกลับไปใช้ Apps Script URL เดิม โดยไม่ต้องเปลี่ยนข้อมูลใน Sheets
- Worker ไม่แก้ไข/อัปโหลด `Code.gs` หรือ Deploy โปรเจกต์ Google; การอัปเดต Apps Script ต้องมีสิทธิ์เข้าถึงโปรเจกต์และทำต่างหาก
