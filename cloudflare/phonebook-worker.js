/**
 * Phonebook Cloudflare Worker bridge — compatible with Phonebook v17 browser transport.
 * GitHub Pages: https://eirchard.github.io/phonebook/
 * The Google Apps Script deployment remains the backend and the Google Sheet stays unchanged.
 * Do NOT put passwords, Google OAuth tokens, or administrator sessions in this file.
 * You may override the existing deployment URL using Worker environment variable
 * PHONEBOOK_GAS_URL (non-secret URL); never set it to the Apps Script editor URL.
 */
const PAGE_ORIGIN = 'https://eirchard.github.io';
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbzbkJsy5Qs8oVvckvRYxYNJLDDUQLHp9BOZYi6orFVODLKg33_0aHrPp5Jwuxeu8ob2/exec';
const GET_ACTIONS = new Set(['list', 'status', 'health']);
const POST_ACTIONS = new Set([
  'submit', 'adminLogin', 'adminLogout', 'adminDashboard', 'adminAccounts',
  'adminUserCreate', 'adminUserToggle', 'adminUserRole', 'adminUserReset',
  'adminUnits', 'adminUnitSave', 'adminUnitDelete', 'adminAdd', 'adminUpdate',
  'adminPublish', 'adminDelete', 'adminSettings', 'adminChangePassword'
]);
const REQUEST_ID_RE = /^[a-f0-9]{32}$/;
const CALLBACK_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/;
const UPSTREAM_RE = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/;
const MAX_POST_BYTES = 128 * 1024;
const MAX_RESPONSE_CHARS = 5 * 1024 * 1024;

function responseHeaders(contentType, origin) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin',
    ...(origin === PAGE_ORIGIN ? {'Access-Control-Allow-Origin': PAGE_ORIGIN} : {})
  };
}
function safeStringify(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
function sendJSON(data, code=200, origin='') {
  return new Response(safeStringify(data), {status:code, headers:responseHeaders('application/json; charset=utf-8', origin)});
}
function sendJSONP(data, callback, code=200, origin='') {
  if(!callback) return sendJSON(data,code,origin);
  // JSONP callback is restricted to an identifier: no expressions, member access or brackets.
  return new Response(callback+'('+safeStringify(data)+');', {
    status:code, headers:responseHeaders('application/javascript; charset=utf-8', origin)
  });
}
function appUrl(env) {
  const candidate=String(env.PHONEBOOK_GAS_URL || DEFAULT_GAS_URL).trim();
  return UPSTREAM_RE.test(candidate)?candidate:null;
}
async function upstreamJSON(endpoint, query) {
  const url=new URL(endpoint);
  for(const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
  const reply=await fetch(url.toString(), {method:'GET', redirect:'follow', headers:{Accept:'application/json'}, signal:AbortSignal.timeout(20000)});
  const raw=await reply.text();
  if(!reply.ok || raw.length>MAX_RESPONSE_CHARS)throw new Error('Apps Script ไม่สามารถส่งข้อมูลได้');
  try {
    const parsed=JSON.parse(raw);
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed))throw new Error('Invalid payload');
    return parsed;
  } catch {throw new Error('Apps Script ไม่ได้ส่ง JSON กรุณาตรวจสอบ Web App Deployment');}
}
async function handleGET(request, env, url) {
  const callback=url.searchParams.get('callback')||'';
  const origin=request.headers.get('Origin')||'';
  if(callback&&!CALLBACK_RE.test(callback))return sendJSON({ok:false,message:'ชื่อ callback ไม่ถูกต้อง'},400,origin);
  const action=url.pathname==='/health'?'health':(url.searchParams.get('action')||'list');
  if(!GET_ACTIONS.has(action))return sendJSONP({ok:false,message:'ไม่รองรับคำสั่ง'},callback,400,origin);
  const endpoint=appUrl(env);
  if(!endpoint)return sendJSONP({ok:false,message:'ยังไม่ได้ตั้งค่า Apps Script Web App URL'},callback,503,origin);
  const query={action};
  if(action==='status'){
    const id=url.searchParams.get('requestId')||'';
    if(!REQUEST_ID_RE.test(id))return sendJSONP({ok:false,pending:false,message:'requestId ไม่ถูกต้อง'},callback,400,origin);
    query.requestId=id;
  }
  try{
    const payload=await upstreamJSON(endpoint,query);
    if(url.pathname==='/health') {
      const compatible=payload.ok===true && payload.version==='v17' && payload.sheetAccessible===true;
      return sendJSON({ok:compatible,worker:'phonebook-cloudflare-v1',backendReachable:true,
        backendVersion:payload.version||'unknown',sheetAccessible:payload.sheetAccessible===true,
        message:compatible?'Cloudflare เชื่อมต่อ Apps Script v17 และ Google Sheets ได้':
          'Worker ใช้งานได้ แต่ Apps Script ยังไม่พร้อม/ไม่ใช่ v17 กรุณาตรวจ Deployment'},compatible?200:503,origin);
    }
    return sendJSONP(payload,callback,200,origin);
  } catch(e){
    const message=e?.name==='TimeoutError'?'Apps Script ตอบกลับช้าเกินไป':'Cloudflare ติดต่อ Apps Script ไม่สำเร็จ หรือ Web App ตอบกลับไม่ถูกต้อง';
    const error={ok:false,pending:false,message};
    return sendJSONP(error,callback,502,origin);
  }
}
async function handlePOST(request, env) {
  const origin=request.headers.get('Origin')||'';
  if(origin!==PAGE_ORIGIN)return sendJSON({ok:false,message:'Origin ไม่ได้รับอนุญาต'},403,origin);
  const endpoint=appUrl(env);
  if(!endpoint)return sendJSON({ok:false,message:'ยังไม่ได้ตั้งค่า Apps Script Web App URL'},503,origin);
  const type=(request.headers.get('Content-Type')||'').toLowerCase();
  if(!type.startsWith('application/x-www-form-urlencoded'))return sendJSON({ok:false,message:'ต้องส่งข้อมูลแบบ HTML form'},415,origin);
  const size=Number(request.headers.get('Content-Length')||0);
  if(size>MAX_POST_BYTES)return sendJSON({ok:false,message:'ข้อมูลใหญ่เกินกำหนด'},413,origin);
  const raw=await request.text();
  if(raw.length>MAX_POST_BYTES)return sendJSON({ok:false,message:'ข้อมูลใหญ่เกินกำหนด'},413,origin);
  const fields=new URLSearchParams(raw);
  const action=fields.get('action')||'';
  const requestId=fields.get('requestId')||'';
  if(!POST_ACTIONS.has(action) || !REQUEST_ID_RE.test(requestId))return sendJSON({ok:false,message:'คำสั่งหรือ requestId ไม่ถูกต้อง'},400,origin);
  try {
    const upstream=await fetch(endpoint,{method:'POST',redirect:'follow',
      headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'text/plain, text/html'},
      body:raw,signal:AbortSignal.timeout(100000)});
    const body=await upstream.text();
    if(!upstream.ok || body.length>MAX_RESPONSE_CHARS ||
       !(body.trim()==='RECEIVED'||(body.includes('phonebook-v12')&&body.includes('postMessage')))){
      return sendJSON({ok:false,message:'Apps Script ไม่ตอบรับคำขอ กรุณาตรวจสอบ Deployment'},502,origin);
    }
    // Only confirms receipt at the gateway. The browser MUST continue polling
    // GET /api?action=status&requestId=... before claiming a save/login succeeded.
    return new Response('<!doctype html><html lang="th"><meta charset="utf-8"><title>รับคำขอแล้ว</title><body>กำลังตรวจสอบผลกับ Google Sheets...</body></html>',{
      status:200,headers:responseHeaders('text/html; charset=utf-8',origin)
    });
  } catch {
    return sendJSON({ok:false,message:'ติดต่อ Apps Script ไม่สำเร็จ กรุณาตรวจสถานะก่อนส่งซ้ำ'},502,origin);
  }
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(!['/api','/health'].includes(url.pathname))return sendJSON({ok:false,message:'ไม่พบเส้นทาง'},404);
    const origin=request.headers.get('Origin')||'';
    if(request.method==='OPTIONS'){
      if(url.pathname!=='/api' || origin!==PAGE_ORIGIN)return sendJSON({ok:false,message:'ไม่อนุญาต'},403,origin);
      return new Response(null,{status:204,headers:{...responseHeaders('text/plain',origin),
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
    }
    if(request.method==='GET')return handleGET(request,env,url);
    if(request.method==='POST'&&url.pathname==='/api')return handlePOST(request,env);
    return sendJSON({ok:false,message:'ไม่รองรับ HTTP method'},405,origin);
  }
};
