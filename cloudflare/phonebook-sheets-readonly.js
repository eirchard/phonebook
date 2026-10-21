/**
 * Phonebook — Google Sheets direct-read diagnostic Worker, v19 (STAGING / READ ONLY).
 * This is NOT the production backend and does not replace the existing Worker yet.
 * Configure PHONEBOOK_GOOGLE_CREDENTIALS_JSON as an encrypted Cloudflare Worker secret;
 * never paste service-account credentials into a public GitHub repository.
 * Google Sheets must grant that service-account email Viewer access for read-only tests.
 * This Worker has intentionally NO write/admin endpoints. Do not switch production
 * config.js until a separately tested read/write admin backend has been deployed.
 */
const SPREADSHEET_ID = '1oUcCkUe6jzEZ5GttSc-xTwAhT_16-NqrqevShMwlRSo';
const ALLOWED_ORIGIN = 'https://eirchard.github.io';
const LIST_HEADERS = ['รหัส','ชื่อ','นามสกุล','เบอร์โทรศัพท์','ฝ่าย/แผนก','ตำแหน่ง','เผยแพร่','LINE ID'];
const UNIT_HEADERS = ['รหัส','ชื่อหน่วยงาน','รหัสสังกัด','ชนิด','ลำดับ','ใช้งาน'];
const CALLBACK_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/;
const textEncoder = new TextEncoder();
let cachedAuth = null;
const b64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode = value => b64Url(textEncoder.encode(typeof value==='string'?value:JSON.stringify(value)));
const safeJson = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
function headers(type, origin='') {
  return {
    'Content-Type':type,'Cache-Control':'no-store, max-age=0','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer','Vary':'Origin',
    ...(origin===ALLOWED_ORIGIN?{'Access-Control-Allow-Origin':ALLOWED_ORIGIN}:{})
  };
}
function respond(data,status=200,origin='',callback='') {
  const payload=safeJson(data);
  if(callback) return new Response(`${callback}(${payload});`,{status,headers:headers('application/javascript; charset=utf-8',origin)});
  return new Response(payload,{status,headers:headers('application/json; charset=utf-8',origin)});
}
function parsedCredential(env) {
  const raw=env.PHONEBOOK_GOOGLE_CREDENTIALS_JSON;
  if(!raw)throw new Error('ยังไม่ได้ตั้งค่า Cloudflare Secret สำหรับ Google Service Account');
  let key;
  try{key=JSON.parse(raw);}catch{throw new Error('รูปแบบ Secret Google Service Account ไม่ถูกต้อง');}
  if(key.type!=='service_account'||typeof key.client_email!=='string'||typeof key.private_key!=='string'||!key.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Secret ต้องเป็น Google Service Account JSON key ที่ถูกต้อง');
  }
  return key;
}
async function googleToken(env) {
  const cred=parsedCredential(env);
  if(cachedAuth&&cachedAuth.until>Date.now()+60000)return cachedAuth.token;
  const pem=cred.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const data=Uint8Array.from(atob(pem),x=>x.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',data,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const assertion=[encode({alg:'RS256',typ:'JWT'}),encode({iss:cred.client_email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})].join('.');
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,textEncoder.encode(assertion));
  const body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${assertion}.${b64Url(new Uint8Array(sig))}`});
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
  if(!response.ok)throw new Error(`Google OAuth ไม่อนุญาตให้เข้าใช้งาน (${response.status})`);
  const obj=await response.json();
  if(!obj.access_token||!Number.isFinite(Number(obj.expires_in)))throw new Error('Google OAuth ตอบกลับไม่ครบถ้วน');
  cachedAuth={token:obj.access_token,until:Date.now()+Math.min(3500,Number(obj.expires_in))*1000};
  return obj.access_token;
}
async function sheetRead(env,range){
  const token=await googleToken(env);
  const endpoint=`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(SPREADSHEET_ID)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`;
  const result=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`}});
  if(!result.ok){
    // Keep the public diagnostic free of private credentials, tokens, and raw Google errors.
    const googleError=await result.json().catch(()=>({}));
    const status=String(googleError?.error?.status||'').slice(0,60);
    const reason=String(googleError?.error?.errors?.[0]?.reason||'').slice(0,60);
    const disabled=/SERVICE_DISABLED|accessNotConfigured|API_DISABLED/i.test(status+' '+reason);
    const code=disabled?'SHEETS_API_DISABLED':
      result.status===403?'SHEETS_PERMISSION_DENIED':
      result.status===404?'SHEETS_NOT_FOUND':'SHEETS_API_ERROR';
    const message=disabled?'โปรเจกต์ Google Cloud ของ Service Account ยังไม่ได้เปิด Google Sheets API':
      result.status===403?'Google Sheets ตอบ HTTP 403: ตรวจการแชร์ให้ client_email ใน Secret และนโยบายการเข้าถึง':
      result.status===404?'Google Sheets ตอบ HTTP 404: ตรวจ Spreadsheet ID และสิทธิ์ของ Service Account':
      `Google Sheets API ตอบ HTTP ${result.status}`;
    const error=new Error(message);
    error.code=code;
    error.googleHttpStatus=result.status;
    error.googleStatus=/^[A-Z_]{2,60}$/.test(status)?status:undefined;
    throw error;
  }
  const obj=await result.json();return Array.isArray(obj.values)?obj.values:[];
}
function validate(headersActual,expected,tab){
  if(expected.some((h,i)=>headersActual[i]!==h))throw new Error(`หัวคอลัมน์ชีต ${tab} ไม่ตรงกับที่ระบบกำหนด`);
}
function isTrue(x){return x===true||String(x||'').toUpperCase()==='TRUE';}
async function schemaHealth(env){
  const [h1,h2]=await Promise.all([sheetRead(env,"'รายชื่อ'!A1:H1"),sheetRead(env,"'หน่วยงาน'!A1:F1")]);
  validate(h1[0]||[],LIST_HEADERS,'รายชื่อ');validate(h2[0]||[],UNIT_HEADERS,'หน่วยงาน');
  return {ok:true,backendVersion:'google-sheets-direct-readonly-v19',sheetAccessible:true,readOnly:true,
          message:'Worker อ่านโครงสร้าง Google Sheets โดยตรงได้ (ยังไม่ได้เปิดระบบเขียนข้อมูล)'};
}
async function publicList(env){
  const [people,units]=await Promise.all([sheetRead(env,"'รายชื่อ'!A1:H"),sheetRead(env,"'หน่วยงาน'!A1:F")]);
  validate(people[0]||[],LIST_HEADERS,'รายชื่อ');validate(units[0]||[],UNIT_HEADERS,'หน่วยงาน');
  const contacts=people.slice(1).filter(r=>String(r[1]||'').trim()&&String(r[2]||'').trim()&&isTrue(r[6]))
    .map((r,i)=>({id:String(r[0]||`row-${i+2}`),firstName:String(r[1]||'').trim(),lastName:String(r[2]||'').trim(),phone:String(r[3]||''),
      department:String(r[4]||''),position:String(r[5]||''),lineId:String(r[7]||'')}));
  const nodes=units.slice(1).filter(r=>String(r[0]||'').trim()).map(r=>({id:String(r[0]),name:String(r[1]||''),
    parentId:String(r[2]||''),type:String(r[3]||''),sort:Number(r[4])||0,enabled:isTrue(r[5])}));
  return {ok:true,count:contacts.length,contacts,units:nodes,settings:{organizationName:'วิทยาลัยการอาชีพนครยะลา',pageSize:12,accent:'#17636d',allowSubmissions:false},updatedAt:new Date().toISOString()};
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);const origin=request.headers.get('Origin')||'';
    if(!['/health','/api'].includes(url.pathname))return respond({ok:false,message:'ไม่พบเส้นทาง'},404,origin);
    if(request.method!=='GET')return respond({ok:false,pending:false,message:'Worker ทดสอบนี้อ่านข้อมูลอย่างเดียว ยังไม่เปิดแก้ไขข้อมูล'},405,origin);
    const callback=url.searchParams.get('callback')||'';
    if(callback&&!CALLBACK_PATTERN.test(callback))return respond({ok:false,message:'รูปแบบ callback ไม่ถูกต้อง'},400,origin);
    const action=url.pathname==='/health'?'health':url.searchParams.get('action')||'list';
    if(!['list','health'].includes(action))return respond({ok:false,pending:false,message:'Worker อ่านอย่างเดียว ไม่รองรับคำสั่งนี้'},503,origin,callback);
    try {return respond(action==='health'?await schemaHealth(env):await publicList(env),200,origin,callback);}
    catch(err){return respond({ok:false,sheetAccessible:false,readOnly:true,
      errorCode:err.code||'SHEETS_DIAGNOSTIC_ERROR',
      ...(err.googleHttpStatus?{googleHttpStatus:err.googleHttpStatus}:{}),
      ...(err.googleStatus?{googleStatus:err.googleStatus}:{}),
      message:err.message||'ระบบติดต่อ Google Sheets ไม่สำเร็จ'},503,origin,callback);}
  }
};
