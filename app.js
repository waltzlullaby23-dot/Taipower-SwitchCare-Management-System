/* SwitchCare Enterprise v8
   Stable rebuild:
   - Direct Supabase REST API with ASCII-safe request headers
   - No supabase-js Auth dependency
   - One naming convention for cycle/reminder variables
   - Token refresh support
   - Dedicated charge_records / usage_records / audit_log
   - All business mutations use RPC functions
*/
const CFG = window.SWITCHCARE_CONFIG || {};
const cleanText = v => String(v ?? "").replace(/^\uFEFF/, "").trim();
const SUPABASE_URL = cleanText(CFG.SUPABASE_URL).replace(/\/+$/, "");
let SUPABASE_KEY = cleanText(CFG.SUPABASE_PUBLISHABLE_KEY || CFG.SUPABASE_ANON_KEY);
SUPABASE_KEY = SUPABASE_KEY.replace(/^["']|["']$/g, "");
SUPABASE_KEY = SUPABASE_KEY.replace(/^sb_publishable_sb_publishable_/i, "sb_publishable_");
const CYCLE_MONTHS = Number(CFG.CYCLE_MONTHS || 6);
const REMIND_DAYS = Number(CFG.REMIND_DAYS || 30);
const SESSION_KEY = cleanText(CFG.SESSION_STORAGE_KEY || "switchcare_session_v10");
const CONFIG_OK = /^https:\/\/[^\s]+\.supabase\.co$/i.test(SUPABASE_URL)
  && /^sb_publishable_[A-Za-z0-9_\-.]+$/.test(SUPABASE_KEY);

let session = null;
let devices = [];
let auditRows = [];
let chargeRows = [];
let usageRows = [];
let page = "dashboard";
let busy = false;
let refreshTimer = null;

function errText(e){ return String(e?.message || e?.error_description || e?.msg || e || "未知錯誤"); }
function today(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDate(s){ const [y,m,d]=String(s).split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
function fmt(s){ return s ? parseDate(s).toLocaleDateString("zh-TW",{timeZone:"Asia/Taipei"}) : "-"; }
function addMonths(dateStr, months){
  const d=parseDate(dateStr), targetDay=d.getUTCDate();
  const out=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+months,1));
  const last=new Date(Date.UTC(out.getUTCFullYear(),out.getUTCMonth()+1,0)).getUTCDate();
  out.setUTCDate(Math.min(targetDay,last));
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth()+1).padStart(2,"0")}-${String(out.getUTCDate()).padStart(2,"0")}`;
}
function dayDiff(from,to){ return Math.round((parseDate(to)-parseDate(from))/86400000); }
function esc(s){ return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
function validEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function saveSession(s){
  session=s;
  if(s){
    localStorage.setItem(SESSION_KEY,JSON.stringify(s));
  }else{
    localStorage.removeItem(SESSION_KEY);
  }
}
function loadSession(){
  try{
    const s=localStorage.getItem(SESSION_KEY);
    return s?JSON.parse(s):null;
  }catch{return null}
}

function asciiHeader(v){
  const s=String(v??"");
  for(let i=0;i<s.length;i++){ if(s.charCodeAt(i)>255) throw new Error("HTTP Header 含有非 Latin-1 字元。"); }
  return s;
}

async function api(path,options={}){
  if(!SUPABASE_URL||!SUPABASE_KEY) throw new Error("Supabase 設定未完成。");
  const headers=new Headers();
  headers.set("apikey",asciiHeader(SUPABASE_KEY));
  if(session?.access_token) headers.set("Authorization",asciiHeader("Bearer "+session.access_token));
  headers.set("Accept","application/json");
  headers.set("Content-Type","application/json");
  if(options.headers) for(const [k,v] of Object.entries(options.headers)) headers.set(k,asciiHeader(v));

  const response=await fetch(SUPABASE_URL+path,{...options,headers});
  const text=await response.text();
  let body=null;
  try{body=text?JSON.parse(text):null}catch{body=text}
  if(response.status===401 && session?.refresh_token && !options._retried){
    const renewed=await refreshSession();
    if(renewed) return api(path,{...options,_retried:true});
  }
  if(!response.ok){
    throw new Error(body?.message||body?.msg||body?.error_description||body?.error||text||`HTTP ${response.status}`);
  }
  return body;
}

async function refreshSession(){
  if(!session?.refresh_token) return false;
  try{
    const body=await fetch(SUPABASE_URL+"/auth/v1/token?grant_type=refresh_token",{
      method:"POST",
      headers:{
        "apikey":asciiHeader(SUPABASE_KEY),
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body:JSON.stringify({refresh_token:session.refresh_token})
    });
    const text=await body.text();
    let json=null;try{json=text?JSON.parse(text):null}catch{}
    if(!body.ok||!json?.access_token) return false;
    saveSession(json);
    return true;
  }catch{return false}
}

async function boot(){
  render();
  if(!CONFIG_OK){renderSetup();return;}
  session=loadSession();
  if(session?.access_token){
    if(session.expires_at && Number(session.expires_at)*1000 < Date.now()+60000){
      await refreshSession();
    }
    if(session?.access_token){
      renderLayout();
      await refreshAll();
      startRefreshTimer();
      return;
    }
  }
  renderLogin();
}
function startRefreshTimer(){
  clearInterval(refreshTimer);
  refreshTimer=setInterval(async()=>{
    if(session?.refresh_token){
      const ok=await refreshSession();
      if(!ok){saveSession(null);clearInterval(refreshTimer);renderLogin();}
    }
  },45*60*1000);
}

function renderSetup(){
  document.getElementById("app").innerHTML=`<div class="auth-wrap"><div class="auth-card">
  <h1>SWITCHCARE</h1><div class="sub">台電自動線路開關生命週期管理系統</div>
  <div class="notice warning"><b>Supabase 設定未完成</b><br>請在 GitHub 的 config.js 填入目前 Project 的 Publishable Key（sb_publishable_...）。</div>
  <div class="diagnostic">Project URL：${esc(SUPABASE_URL||"(空白)")}
Key格式：${SUPABASE_KEY.startsWith("sb_publishable_")?"正確":"未設定／格式錯誤"}</div>
  </div></div>`;
}
function renderLogin(){
  document.getElementById("app").innerHTML=`<div class="auth-wrap"><div class="auth-card">
  <h1>SWITCHCARE</h1><div class="sub">台電自動線路開關生命週期管理系統</div>
  <label>Email</label><input id="loginEmail" type="email" autocomplete="username" placeholder="Email">
  <label>密碼</label><input id="loginPassword" type="password" autocomplete="current-password" placeholder="密碼">
  <div id="loginError" class="auth-error" style="display:none"></div>
  <button id="loginBtn" class="btn" type="button">登入系統</button>
  </div></div>`;
  document.getElementById("loginBtn").onclick=signIn;
  document.getElementById("loginPassword").addEventListener("keydown",e=>{if(e.key==="Enter")signIn()});
}
function showLoginError(msg){const e=document.getElementById("loginError");if(e){e.textContent=msg;e.style.display="block";}}
async function signIn(){
  if(!CONFIG_OK){showLoginError("Supabase 設定未完成。");return;}
  const email=(document.getElementById("loginEmail")?.value||"").trim();
  const password=document.getElementById("loginPassword")?.value||"";
  if(!validEmail(email))return showLoginError("Email 格式不正確。");
  if(!password)return showLoginError("請輸入密碼。");
  const btn=document.getElementById("loginBtn");
  btn.disabled=true;btn.textContent="登入中…";
  try{
    const body=await api("/auth/v1/token?grant_type=password",{
      method:"POST",
      headers:{"X-Client-Info":"switchcare-v8"},
      body:JSON.stringify({email,password})
    });
    if(!body?.access_token)throw new Error("Supabase 未回傳登入 Token。");
    saveSession(body);
    renderLayout();
    await refreshAll();
    startRefreshTimer();
  }catch(e){showLoginError("登入失敗："+errText(e));}
  finally{if(document.getElementById("loginBtn")){btn.disabled=false;btn.textContent="登入系統";}}
}
async function signOut(){
  try{if(session?.access_token)await api("/auth/v1/logout",{method:"POST"});}catch{}
  saveSession(null);devices=[];auditRows=[];chargeRows=[];usageRows=[];
  clearInterval(refreshTimer);renderLogin();
}

function nav(p,t){return `<button type="button" class="${page===p?"active":""}" onclick="go('${p}')">${t}</button>`;}
function pageTitle(){return({dashboard:"充電管理總覽",switches:"開關設備主檔",charging:"充電與週期管理",usage:"領用／退庫管理",history:"生命週期紀錄",reports:"報表與稽核",settings:"系統設定"})[page]||"SwitchCare";}
function go(p){page=p;renderLayout();render();}
function renderLayout(){
  document.getElementById("app").innerHTML=`<div class="app">
  <aside class="sidebar"><div class="brand">SWITCHCARE<br>台電自動線路開關管理系統<small>Enterprise v8｜生命週期・充電・稽核</small></div>
  <nav class="nav">${nav("dashboard","儀表板")}${nav("switches","開關設備主檔")}${nav("charging","充電與週期管理")}${nav("usage","領用／退庫管理")}${nav("history","生命週期紀錄")}${nav("reports","報表與稽核")}${nav("settings","系統設定")}</nav></aside>
  <main class="main"><div class="topbar"><div><h1>${pageTitle()}</h1><span class="muted">在庫計時・領用停止・退庫重新起算6個月</span></div>
  <div style="display:flex;align-items:center;gap:10px">${page!=="settings"?`<button class="btn" type="button" onclick="openDevice()">＋ 新增開關</button>`:""}<span class="userbar">${esc(session?.user?.email||"")}</span><button class="btn secondary small" type="button" onclick="signOut()">登出</button></div></div><div id="content"></div></main></div>`;
}
async function refreshAll(){
  try{
    const body=await api("/rest/v1/switches?select=*&order=taipower_no.asc",{headers:{"Accept-Profile":"public"}});
    devices=body||[];
    render();
  }catch(e){
    const c=document.getElementById("content");
    if(c)c.innerHTML=`<div class="panel"><div class="notice danger"><b>資料庫查詢失敗</b><br>${esc(errText(e))}</div><div class="diagnostic">URL：${esc(SUPABASE_URL)}
Key：${SUPABASE_KEY.startsWith("sb_publishable_")?"Publishable Key 格式正確":"格式錯誤"}
登入：${esc(session?.user?.email||"")}</div></div>`;
  }
}

function statusOf(x){
  if(x.state==="領用中")return{label:"領用中",cls:"gray",days:null};
  if(x.state==="送檢充電")return{label:"送檢充電",cls:"info",days:null};
  if(x.state==="充電中")return{label:"充電中",cls:"info",days:null};
  if(!x.next_charge_date)return{label:"待建週期",cls:"gray",days:null};
  const d=dayDiff(today(),x.next_charge_date);
  return d<0?{label:"逾期",cls:"danger",days:d}:d<=REMIND_DAYS?{label:"即將到期",cls:"warning",days:d}:{label:"正常",cls:"normal",days:d};
}

function card(t,n,c=""){return`<div class="card ${c}"><div class="label">${t}</div><div class="num">${n}</div></div>`;}
function deviceTable(list,showDays=false){
  return`<div class="table-wrap"><table><thead><tr><th>料號</th><th>台電編號</th><th>型式</th><th>評價</th><th>狀態</th><th>週期起算</th><th>下次充電</th><th>單號</th><th>操作</th></tr></thead><tbody>
  ${list.map(x=>{const s=statusOf(x);return`<tr><td>${esc(x.material_no)}</td><td>${esc(x.taipower_no)}</td><td>${esc(x.type)}</td><td>${esc(x.rating_type)}</td><td><span class="badge ${s.cls}">${s.label}</span></td><td>${fmt(x.cycle_start_date)}</td><td>${fmt(x.next_charge_date)}${showDays&&s.days!==null?`<br><span class="muted">${s.days<0?"逾期 "+Math.abs(s.days)+" 天":"剩 "+s.days+" 天"}</span>`:""}</td><td>${esc(x.transfer_no||x.issue_no||"-")}</td><td><button class="btn small secondary" type="button" onclick="detail('${x.id}')">查看</button></td></tr>`}).join("")}
  </tbody></table></div>`;
}

function dashboard(){
  const stock=devices.filter(x=>x.state!=="領用中"),issued=devices.filter(x=>x.state==="領用中"),soon=stock.filter(x=>statusOf(x).label==="即將到期"),over=stock.filter(x=>statusOf(x).label==="逾期"),proc=devices.filter(x=>["送檢充電","充電中"].includes(x.state));
  document.getElementById("content").innerHTML=`<div class="cards">${card("設備總數",devices.length)}${card("目前在庫",stock.length,"success")}${card("領用中",issued.length)}${card("30天內到期",soon.length,"warning")}${card("逾期",over.length,"danger")}${card("送檢／充電",proc.length,"info")}</div>
  <div class="panel"><h2>核心業務規則</h2><div class="kpi-mini"><div>在庫週期<b>${CYCLE_MONTHS}個月</b></div><div>提前預警<b>${REMIND_DAYS}天</b></div><div>領用期間<b>停止計時</b></div><div>退庫<b>重新起算6個月</b></div></div></div>
  <div class="panel"><h2>逾期設備</h2>${over.length?deviceTable(over,true):'<div class="empty">目前沒有逾期設備</div>'}</div>`;
}
function switchesPage(){
  document.getElementById("content").innerHTML=`<div class="panel"><div class="toolbar"><input id="sq" placeholder="搜尋料號／台電編號／型式／單號" oninput="filterDevices()"><select id="ss" onchange="filterDevices()"><option value="">全部狀態</option><option>正常</option><option>即將到期</option><option>逾期</option><option>領用中</option><option>送檢充電</option><option>充電中</option></select><button class="btn secondary" type="button" onclick="exportCSV()">匯出CSV</button></div><div id="dt">${deviceTable(devices)}</div></div>`;
}
function filterDevices(){
  const q=(document.getElementById("sq").value||"").toLowerCase(),s=document.getElementById("ss").value;
  document.getElementById("dt").innerHTML=deviceTable(devices.filter(x=>(!q||[x.material_no,x.taipower_no,x.type,x.issue_no,x.transfer_no].join(" ").toLowerCase().includes(q))&&(!s||statusOf(x).label===s)));
}
function chargingPage(){
  const l=devices.filter(x=>x.state!=="領用中"&&["即將到期","逾期","送檢充電","充電中"].includes(statusOf(x).label));
  document.getElementById("content").innerHTML=`<div class="notice">只有在庫設備計算6個月週期。領用停止倒數；退庫後由退庫日重新起算。</div><div class="panel"><div class="toolbar"><button class="btn" type="button" onclick="batchSend()">批次送檢</button></div>${l.length?deviceTable(l,true):'<div class="empty">目前沒有需要處理的設備</div>'}</div>`;
}
function usagePage(){
  const i=devices.filter(x=>x.state==="領用中"),s=devices.filter(x=>x.state!=="領用中");
  document.getElementById("content").innerHTML=`<div class="notice">領用中的開關不需要充電倒數。退庫後視同剛入庫，退庫日重新起算6個月。</div><div class="panel"><h2>目前領用中（${i.length}）</h2>${i.length?deviceTable(i):'<div class="empty">目前沒有領用中的設備</div>'}</div><div class="panel"><div class="toolbar"><button class="btn" type="button" onclick="openUsage('issue',${JSON.stringify(s.map(x=>x.id))})">領用／出庫</button><button class="btn success" type="button" onclick="openUsage('return',${JSON.stringify(i.map(x=>x.id))})">退庫／重新入庫</button></div></div>`;
}
async function historyPage(){
  document.getElementById("content").innerHTML=`<div class="panel"><div class="toolbar"><input id="hq" placeholder="搜尋事件／台電編號／料號／單號" oninput="filterHistory()"></div><div id="ht"><div class="empty">載入中…</div></div></div>`;
  try{auditRows=await api("/rest/v1/audit_log?select=*&order=event_at.desc&limit=1000",{headers:{"Accept-Profile":"public"}})||[];renderHistoryRows(auditRows);}
  catch(e){document.getElementById("ht").innerHTML=`<div class="notice danger">${esc(errText(e))}</div>`;}
}
function renderHistoryRows(rows){document.getElementById("ht").innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>事件</th><th>台電編號</th><th>料號</th><th>單號</th><th>操作者</th><th>備註</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${new Date(r.event_at).toLocaleString("zh-TW")}</td><td>${esc(r.event_type)}</td><td>${esc(r.taipower_no||"-")}</td><td>${esc(r.material_no||"-")}</td><td>${esc(r.document_no||"-")}</td><td>${esc(r.actor_email||"-")}</td><td>${esc(r.note||"-")}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty">尚無歷史紀錄</div>';}
function filterHistory(){const q=(document.getElementById("hq").value||"").toLowerCase();renderHistoryRows(auditRows.filter(r=>[r.event_type,r.taipower_no,r.material_no,r.document_no,r.actor_email,r.note].join(" ").toLowerCase().includes(q)));}

function openDevice(x=null){
  const v=x||{material_no:"",taipower_no:"",type:"",rating_type:"新品",warehouse:"",location:"",entry_date:today(),remark:""};
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>${x?"編輯":"新增"}開關設備</h2><button class="close" type="button" onclick="closeModal()">×</button></div>
  <div class="form form-grid"><div><label>開關料號（10位）*</label><input id="fm" maxlength="10" value="${esc(v.material_no)}"></div><div><label>台電編號 *</label><input id="ft" value="${esc(v.taipower_no)}"></div>
  <div class="full"><label>型式 *</label><input id="fy" value="${esc(v.type)}"></div><div><label>評價類型</label><select id="fr"><option ${v.rating_type==="新品"?"selected":""}>新品</option><option ${v.rating_type==="舊品"?"selected":""}>舊品</option></select></div>
  <div><label>入帳日期 *</label><input id="fe" type="date" value="${v.entry_date||today()}"></div><div><label>倉庫</label><input id="fw" value="${esc(v.warehouse||"")}"></div>
  <div><label>儲位</label><input id="fl" value="${esc(v.location||"")}"></div><div class="full"><label>備註</label><textarea id="fn">${esc(v.remark||"")}</textarea></div></div>
  <div id="formMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn" id="saveDeviceBtn" type="button" onclick="saveDevice('${x?.id||""}')">儲存</button></div></div></div>`);
}
async function saveDevice(id){
  if(busy)return;busy=true;
  const btn=document.getElementById("saveDeviceBtn");if(btn){btn.disabled=true;btn.textContent="儲存中…";}
  try{
    const materialNo=document.getElementById("fm").value.trim(),taipowerNo=document.getElementById("ft").value.trim(),type=document.getElementById("fy").value.trim(),entryDate=document.getElementById("fe").value;
    const ratingType=document.getElementById("fr").value,warehouse=document.getElementById("fw").value.trim(),location=document.getElementById("fl").value.trim(),remark=document.getElementById("fn").value.trim();
    if(!/^\d{10}$/.test(materialNo))throw new Error("開關料號必須為10位數字。");
    if(!taipowerNo||!type||!entryDate)throw new Error("請完整填寫必填欄位。");
    let body;
    if(id){
      body={p_switch_id:id,p_material_no:materialNo,p_taipower_no:taipowerNo,p_type:type,p_rating_type:ratingType,p_warehouse:warehouse||null,p_location:location||null,p_entry_date:entryDate,p_remark:remark||null};
      await api("/rest/v1/rpc/update_switch_master",{method:"POST",headers:{"Accept-Profile":"public"},body:JSON.stringify(body)});
    }else{
      body={p_material_no:materialNo,p_taipower_no:taipowerNo,p_type:type,p_rating_type:ratingType,p_warehouse:warehouse||null,p_location:location||null,p_entry_date:entryDate,p_remark:remark||null};
      await api("/rest/v1/rpc/create_switch",{method:"POST",headers:{"Accept-Profile":"public"},body:JSON.stringify(body)});
    }
    closeModal();await refreshAll();
  }catch(e){const m=document.getElementById("formMsg");if(m){m.textContent="儲存失敗："+errText(e);m.style.display="block";}}
  finally{busy=false;const b=document.getElementById("saveDeviceBtn");if(b){b.disabled=false;b.textContent="儲存";}}
}

function openUsage(mode,ids){
  if(!ids.length)return alert(mode==="issue"?"目前沒有可領用設備。":"目前沒有領用中的設備。");
  const list=ids.map(id=>devices.find(x=>x.id===id)).filter(Boolean);
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>${mode==="issue"?"領用／出庫":"退庫／重新入庫"}</h2><button class="close" type="button" onclick="closeModal()">×</button></div>
  <div class="form-grid"><div class="full"><label>設備</label><select id="uid">${list.map(x=>`<option value="${x.id}">${esc(x.taipower_no)}｜${esc(x.material_no)}｜${esc(x.type)}</option>`).join("")}</select></div>
  <div><label>日期 *</label><input id="ud" type="date" value="${today()}"></div><div><label>單號</label><input id="un" placeholder="ERP／領用單號"></div>
  <div class="full"><label>備註</label><textarea id="unote"></textarea></div></div><div class="notice">${mode==="issue"?"領用後停止6個月充電倒數。":"退庫後視同重新入庫，退庫日重新起算6個月。"}</div>
  <div id="usageMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn" type="button" onclick="saveUsage('${mode}')">確認</button></div></div></div>`);
}
async function saveUsage(mode){
  const id=document.getElementById("uid").value,date=document.getElementById("ud").value,no=document.getElementById("un").value.trim(),note=document.getElementById("unote").value.trim();
  try{
    const fn=mode==="issue"?"issue_switch":"return_switch";
    await api("/rest/v1/rpc/"+fn,{method:"POST",headers:{"Accept-Profile":"public"},body:JSON.stringify({p_switch_id:id,p_event_date:date,p_document_no:no||null,p_note:note||null})});
    closeModal();await refreshAll();
  }catch(e){const m=document.getElementById("usageMsg");if(m){m.textContent="操作失敗："+errText(e);m.style.display="block";}}
}

function batchSend(){
  const l=devices.filter(x=>["逾期","即將到期"].includes(statusOf(x).label));
  if(!l.length)return alert("目前沒有可批次送檢的設備。");
  const date=prompt("送檢日期 YYYY-MM-DD",today());if(!date)return;
  const no=prompt("共同ERP充電移撥單號（可留空）","")||null;
  Promise.all(l.map(x=>api("/rest/v1/rpc/send_switch_for_charge",{method:"POST",headers:{"Accept-Profile":"public"},body:JSON.stringify({p_switch_id:x.id,p_event_date:date,p_transfer_no:no,p_note:"批次送檢"})}))).then(refreshAll).catch(e=>alert("批次送檢失敗："+errText(e)));
}
function openCharge(id){
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>送檢充電</h2><button class="close" type="button" onclick="closeModal()">×</button></div>
  <div class="form-grid"><div><label>送檢日期 *</label><input id="cd" type="date" value="${today()}"></div><div><label>充電移撥單號 *</label><input id="cn"></div><div class="full"><label>備註</label><textarea id="cnote"></textarea></div></div>
  <div id="chargeMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn" type="button" onclick="saveCharge('${id}')">確認送檢</button></div></div></div>`);
}
async function saveCharge(id){
  const date=document.getElementById("cd").value,no=document.getElementById("cn").value.trim(),note=document.getElementById("cnote").value.trim();
  if(!date||!no){showChargeMsg("送檢日期與充電移撥單號不可空白。");return;}
  try{await api("/rest/v1/rpc/send_switch_for_charge",{method:"POST",headers:{"Accept-Profile":"public"},body:JSON.stringify({p_switch_id:id,p_event_date:date,p_transfer_no:no,p_note:note||null})});closeModal();await refreshAll();}
  catch(e){showChargeMsg("送檢失敗："+errText(e));}
}
function showChargeMsg(m){const e=document.getElementById("chargeMsg");if(e){e.textContent=m;e.style.display="block";}}

function completeCharge(id){
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>登錄充電完成</h2><button class="close" type="button" onclick="closeModal()">×</button></div>
  <div class="form-grid"><div><label>實際完成充電日 *</label><input id="ccd" type="date" value="${today()}"></div><div><label>移撥單號</label><input id="ccn"></div><div class="full"><label>充電備註</label><textarea id="ccnote"></textarea></div></div>
  <div class="notice">完成後：本次充電紀錄結案；下一次充電日＝實際完成日＋6個月。</div><div id="completeMsg" class="notice danger" style="display:none"></div>
  <div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn success" type="button" onclick="finishCharge('${id}')">確認完成</button></div></div></div>`);
}
async function finishCharge(id){
  const date=document.getElementById("ccd").value,no=document.getElementById("ccn").value.trim(),note=document.getElementById("ccnote").value.trim();
  if(!date){showCompleteMsg("完成日期不可空白。");return;}
  try{await api("/rest/v1/rpc/complete_switch_charge",{method:"POST",headers:{"Accept-Profile":"public"},body:JSON.stringify({p_switch_id:id,p_event_date:date,p_transfer_no:no||null,p_note:note||null})});closeModal();await refreshAll();}
  catch(e){showCompleteMsg("完成充電失敗："+errText(e));}
}
function showCompleteMsg(m){const e=document.getElementById("completeMsg");if(e){e.textContent=m;e.style.display="block";}}

async function detail(id){
  const x=devices.find(z=>z.id===id);if(!x)return;
  let h=[],c=[],u=[];
  try{
    [h,c,u]=await Promise.all([
      api("/rest/v1/audit_log?select=*&switch_id=eq."+encodeURIComponent(id)+"&order=event_at.asc",{headers:{"Accept-Profile":"public"}}),
      api("/rest/v1/charge_records?select=*&switch_id=eq."+encodeURIComponent(id)+"&order=cycle_no.asc",{headers:{"Accept-Profile":"public"}}),
      api("/rest/v1/usage_records?select=*&switch_id=eq."+encodeURIComponent(id)+"&order=issue_date.asc",{headers:{"Accept-Profile":"public"}})
    ]);
  }catch(e){return alert("讀取設備履歷失敗："+errText(e));}
  const s=statusOf(x);
  document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>設備完整生命履歷</h2><button class="close" type="button" onclick="closeModal()">×</button></div>
  <div class="form-grid"><div><b>料號</b><br>${esc(x.material_no)}</div><div><b>台電編號</b><br>${esc(x.taipower_no)}</div><div class="full"><b>型式</b><br>${esc(x.type)}</div><div><b>評價</b><br>${esc(x.rating_type)}</div><div><b>狀態</b><br><span class="badge ${s.cls}">${s.label}</span></div><div><b>入帳日期</b><br>${fmt(x.entry_date)}</div><div><b>目前週期起算</b><br>${fmt(x.cycle_start_date)}</div><div><b>下次充電</b><br>${fmt(x.next_charge_date)}</div><div><b>倉庫／儲位</b><br>${esc(x.warehouse||"-")} / ${esc(x.location||"-")}</div></div>
  <div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal();openDevice(devices.find(z=>z.id==='${x.id}'))">編輯</button>${x.state==="在庫"&&["逾期","即將到期"].includes(s.label)?`<button class="btn" type="button" onclick="closeModal();openCharge('${x.id}')">送檢充電</button>`:""}${["送檢充電","充電中"].includes(x.state)?`<button class="btn success" type="button" onclick="closeModal();completeCharge('${x.id}')">完成充電</button>`:""}${x.state==="領用中"?`<button class="btn success" type="button" onclick="closeModal();openUsage('return',['${x.id}'])">退庫</button>`:`<button class="btn danger" type="button" onclick="closeModal();openUsage('issue',['${x.id}'])">領用／出庫</button>`}</div>
  <div class="section-grid"><div class="panel"><h3>充電履歷</h3>${chargeRowsTable(c)}</div><div class="panel"><h3>領用履歷</h3>${usageRowsTable(u)}</div><div class="panel"><h3>稽核履歷</h3>${auditTimeline(h)}</div></div>
  </div></div>`);
}
function chargeRowsTable(r){return r?.length?`<div class="table-wrap"><table style="min-width:650px"><thead><tr><th>週期</th><th>應充電日</th><th>送檢日</th><th>移撥單號</th><th>完成日</th><th>狀態</th></tr></thead><tbody>${r.map(x=>`<tr><td>${x.cycle_no}</td><td>${fmt(x.due_date)}</td><td>${fmt(x.send_date)}</td><td>${esc(x.transfer_no||"-")}</td><td>${fmt(x.completed_date)}</td><td>${esc(x.status)}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty">尚無充電紀錄</div>'}
function usageRowsTable(r){return r?.length?`<div class="table-wrap"><table style="min-width:650px"><thead><tr><th>領用日</th><th>單號</th><th>退庫日</th><th>狀態</th></tr></thead><tbody>${r.map(x=>`<tr><td>${fmt(x.issue_date)}</td><td>${esc(x.issue_no||"-")}</td><td>${fmt(x.return_date)}</td><td>${esc(x.status)}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty">尚無領用紀錄</div>'}
function auditTimeline(r){return r?.length?`<div class="timeline">${r.map(x=>`<div class="timeline-item"><div class="timeline-title">${esc(x.event_type)}　${new Date(x.event_at).toLocaleString("zh-TW")}</div><div class="timeline-meta">單號：${esc(x.document_no||"—")}　操作者：${esc(x.actor_email||"—")}</div><div class="timeline-note">${esc(x.note||"")}</div></div>`).join("")}</div>`:'<div class="empty">尚無稽核紀錄</div>'}

function reportsPage(){
  const stock=devices.filter(x=>x.state!=="領用中"),over=stock.filter(x=>statusOf(x).label==="逾期"),soon=stock.filter(x=>statusOf(x).label==="即將到期"),issued=devices.filter(x=>x.state==="領用中");
  document.getElementById("content").innerHTML=`<div class="panel"><h2>報表中心</h2><div class="toolbar"><button class="btn" type="button" onclick="report('overdue')">逾期清冊</button><button class="btn secondary" type="button" onclick="report('soon')">30天到期清冊</button><button class="btn secondary" type="button" onclick="report('issued')">領用中清冊</button><button class="btn secondary" type="button" onclick="exportCSV()">設備主檔</button></div><p class="muted">在庫 ${stock.length}；逾期 ${over.length}；30天內到期 ${soon.length}；領用中 ${issued.length}。</p></div>
  <div class="panel"><h2>資料完整性</h2><div class="notice success">所有業務異動均以資料庫交易處理；充電、領用、退庫、送檢及充電完成均保留專用紀錄與 Audit Log。</div></div>`;
}
function report(k){
  let h=[],r=[];
  if(k==="overdue"){h=["料號","台電編號","型式","下次充電","逾期天數"];r=devices.filter(x=>statusOf(x).label==="逾期").map(x=>[x.material_no,x.taipower_no,x.type,x.next_charge_date,Math.abs(statusOf(x).days)])}
  else if(k==="soon"){h=["料號","台電編號","型式","下次充電","剩餘天數"];r=devices.filter(x=>statusOf(x).label==="即將到期").map(x=>[x.material_no,x.taipower_no,x.type,x.next_charge_date,statusOf(x).days])}
  else{h=["料號","台電編號","型式","領用日期","領用單號"];r=devices.filter(x=>x.state==="領用中").map(x=>[x.material_no,x.taipower_no,x.type,x.issue_date,x.issue_no])}
  downloadCSV(h,r,"SwitchCare_"+k+"_"+today()+".csv");
}
function exportCSV(){downloadCSV(["料號","型式","台電編號","評價","倉庫","儲位","入帳日期","狀態","週期起算日","上次充電","下次充電","領用日期","退庫日期","領用單號","充電移撥單號"],devices.map(x=>[x.material_no,x.type,x.taipower_no,x.rating_type,x.warehouse,x.location,x.entry_date,x.state,x.cycle_start_date,x.last_charge_date,x.next_charge_date,x.issue_date,x.return_date,x.issue_no,x.transfer_no]),"SwitchCare_設備主檔_"+today()+".csv")}
function downloadCSV(head,rows,name){const q=v=>`"${String(v??"").replace(/"/g,'""')}"`,csv="\uFEFF"+[head,...rows].map(r=>r.map(q).join(",")).join("\r\n"),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=name;a.click();}

function settingsPage(){document.getElementById("content").innerHTML=`<div class="panel"><h2>連線診斷</h2><div class="diagnostic">Project URL：${esc(SUPABASE_URL)}
Key格式：${SUPABASE_KEY.startsWith("sb_publishable_")?"Publishable Key 正確":"錯誤"}
登入者：${esc(session?.user?.email||"")}
Token：${session?.access_token?"已取得":"未取得"}</div><div class="toolbar" style="margin-top:12px"><button class="btn secondary" type="button" onclick="testDB()">測試資料庫</button><button class="btn secondary" type="button" onclick="forceRefresh()">重新整理資料</button></div><div id="dbTest" class="muted"></div></div>
<div class="panel"><h2>資料保存架構</h2><p>設備主檔＋充電紀錄＋領用紀錄＋Audit Log。一般使用者不直接刪除設備；正式停用應以「停用」狀態保存歷史。</p><div class="notice warning">資料庫的長期保存能力仍取決於 Supabase 方案的備份／PITR 設定；正式企業環境應配置第二份備份與災難復原。</div></div>`}
async function testDB(){const e=document.getElementById("dbTest");if(!e)return;e.textContent="測試中…";try{const d=await api("/rest/v1/switches?select=id&limit=1",{headers:{"Accept-Profile":"public"}});e.textContent="資料庫連線成功。switches 可查詢。"}catch(x){e.textContent="失敗："+errText(x);}}
async function forceRefresh(){await refreshAll();alert("資料已重新整理。");}

function render(){if(!document.getElementById("content"))return;if(page==="dashboard")dashboard();else if(page==="switches")switchesPage();else if(page==="charging")chargingPage();else if(page==="usage")usagePage();else if(page==="history")historyPage();else if(page==="reports")reportsPage();else if(page==="settings")settingsPage();}
function closeModal(){document.getElementById("modal")?.remove();}
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal();});
document.addEventListener("click",e=>{if(e.target?.id==="modal")closeModal();});
boot();
