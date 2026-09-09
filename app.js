/* SwitchCare Enterprise v6 - clean rebuild */
const CFG = window.SWITCHCARE_CONFIG || {};
const CYCLE_MONTHS = Number(CFG.CYCLE_MONTHS || 6);
const REMIND_DAYS = Number(CFG.REMIND_DAYS || 30);
const RAW_KEY = String(CFG.SUPABASE_PUBLISHABLE_KEY || CFG.SUPABASE_ANON_KEY || "").trim();
const CLEAN_KEY = RAW_KEY.replace(/^sb_publishable_sb_publishable_/, "sb_publishable_");
const HAS_CONFIG = !!(CFG.SUPABASE_URL && CLEAN_KEY && window.supabase);
const SUPABASE = HAS_CONFIG ? window.supabase.createClient(CFG.SUPABASE_URL, CLEAN_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

let page = "dashboard";
let devices = [];
let session = null;
let auditRows = [];
let busy = false;

const today = () => new Date().toISOString().slice(0, 10);
const fmt = d => d ? new Date(d + "T00:00:00").toLocaleDateString("zh-TW") : "-";
const addMonths = (date, months) => { const d = new Date(date + "T00:00:00"); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0,10); };
const dayDiff = (a, b) => Math.ceil((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[m]));
const errText = e => String(e?.message || e?.error_description || e || "未知錯誤");

function statusOf(x) {
  if (x.state === "領用中") return { label:"領用中", cls:"gray", days:null };
  if (x.state === "送檢充電") return { label:"送檢充電", cls:"info", days:null };
  if (x.state === "充電中") return { label:"充電中", cls:"info", days:null };
  if (!x.next_charge_date) return { label:"待建週期", cls:"gray", days:null };
  const d = dayDiff(today(), x.next_charge_date);
  if (d < 0) return { label:"逾期", cls:"danger", days:d };
  if (d <= REMIND_DAYS) return { label:"即將到期", cls:"warning", days:d };
  return { label:"正常", cls:"normal", days:d };
}

function nav(p,t){ return `<button class="${page===p?"active":""}" type="button" onclick="go('${p}')">${t}</button>`; }
function pageTitle(){ return ({dashboard:"充電管理總覽",switches:"開關設備主檔",charging:"充電與週期管理",usage:"領用／退庫管理",history:"生命週期紀錄",reports:"報表與稽核",settings:"系統設定"})[page] || "SwitchCare"; }
function go(p){ page=p; renderLayout(); render(); }
function card(t,n,c=""){ return `<div class="card ${c}"><div class="label">${t}</div><div class="num">${n}</div></div>`; }

async function boot(){
  if(!HAS_CONFIG){ renderSetup(); return; }
  try{
    const {data,error} = await SUPABASE.auth.getSession();
    if(error){ renderAuthError("讀取 Session 失敗："+errText(error)); return; }
    session = data?.session || null;
    if(session){ renderLayout(); await refresh(); }
    else renderLogin();
  }catch(e){ renderAuthError("初始化失敗："+errText(e)); }
}

function renderSetup(){
  document.getElementById("app").innerHTML = `<div class="auth-wrap"><div class="auth-card">
  <h1>SWITCHCARE</h1><div class="sub">台電自動線路開關生命週期管理系統</div>
  <div class="notice warning"><b>尚未設定資料庫</b><br>請在 GitHub 的 config.js 填入 Supabase Project URL 與 <b>sb_publishable_...</b> Publishable Key。</div>
  <p class="muted">本版不啟用 LocalStorage，未設定資料庫時不會提供假資料，避免誤以為已永久保存。</p>
  </div></div>`;
}
function renderAuthError(msg){
  document.getElementById("app").innerHTML = `<div class="auth-wrap"><div class="auth-card">
  <h1>SWITCHCARE</h1><div class="sub">系統初始化失敗</div>
  <div class="auth-error" style="display:block">${esc(msg)}</div>
  <p class="muted">請檢查 config.js、Supabase Project URL、Publishable Key，以及 database/schema.sql。</p>
  </div></div>`;
}
function renderLogin(){
  document.getElementById("app").innerHTML = `<div class="auth-wrap"><div class="auth-card">
  <h1>SWITCHCARE</h1><div class="sub">台電自動線路開關生命週期管理系統</div>
  <label>Email</label><input id="loginEmail" type="email" autocomplete="username" placeholder="your@email.com">
  <label>密碼</label><input id="loginPassword" type="password" autocomplete="current-password" placeholder="輸入密碼">
  <div id="loginError" class="auth-error" style="display:none"></div>
  <button id="loginBtn" class="btn" type="button" onclick="signIn()">登入系統</button>
  </div></div>`;
  document.getElementById("loginPassword").addEventListener("keydown", e=>{ if(e.key==="Enter") signIn(); });
}
function showLoginError(msg){ const el=document.getElementById("loginError"); if(el){el.textContent=msg;el.style.display="block";} }

async function signIn(){
  if(!SUPABASE){showLoginError("Supabase 尚未設定。");return;}
  const email=(document.getElementById("loginEmail")?.value||"").trim();
  const password=document.getElementById("loginPassword")?.value||"";
  const btn=document.getElementById("loginBtn");
  if(!email||!password){showLoginError("請輸入 Email 與密碼。");return;}
  btn.disabled=true;btn.textContent="登入中…";
  try{
    const {data,error}=await SUPABASE.auth.signInWithPassword({email,password});
    if(error){showLoginError("登入失敗："+errText(error));return;}
    if(!data?.session){showLoginError("Supabase 沒有回傳登入 Session。");return;}
    session=data.session;
    renderLayout();
    await refresh();
  }catch(e){console.error(e);showLoginError("登入程式錯誤："+errText(e));}
  finally{const b=document.getElementById("loginBtn");if(b){b.disabled=false;b.textContent="登入系統";}}
}
async function signOut(){ try{await SUPABASE.auth.signOut();}finally{session=null;devices=[];renderLogin();} }

function renderLayout(){
  document.getElementById("app").innerHTML = `<div class="app">
  <aside class="sidebar"><div class="brand">SWITCHCARE<br>台電自動線路開關管理系統<small>企業版｜生命週期・資料庫・稽核</small></div>
  <nav class="nav">${nav("dashboard","儀表板")}${nav("switches","開關設備主檔")}${nav("charging","充電與週期管理")}${nav("usage","領用／退庫管理")}${nav("history","生命週期紀錄")}${nav("reports","報表與稽核")}${nav("settings","系統設定")}</nav></aside>
  <main class="main"><div class="topbar"><div><h1>${pageTitle()}</h1><span class="muted">在庫計時・領用停止・退庫重新起算6個月</span></div>
  <div style="display:flex;align-items:center;gap:10px">${page!=="settings"?`<button class="btn" type="button" onclick="openDevice()">＋ 新增開關</button>`:""}<span class="userbar">${esc(session?.user?.email||"")}</span><button class="btn secondary small" type="button" onclick="signOut()">登出</button></div></div>
  <div id="content"></div></main></div>`;
}
async function refresh(){
  if(!SUPABASE || !session){renderLogin();return;}
  const {data,error}=await SUPABASE.from("switches").select("*").order("taipower_no");
  if(error){document.getElementById("content").innerHTML=`<div class="panel"><div class="notice danger"><b>登入成功，但資料庫查詢失敗</b><br>${esc(errText(error))}</div><div class="diagnostic">Project URL：${esc(CFG.SUPABASE_URL)}\nKey：${CLEAN_KEY.startsWith("sb_publishable_")?"Publishable Key 格式正確":"Key 格式異常"}\nUser：${esc(session.user?.email||"")}</div></div>`;return;}
  devices=data||[];render();
}

function render(){
 if(!document.getElementById("content"))return;
 if(page==="dashboard")dashboard();
 else if(page==="switches")switchesPage();
 else if(page==="charging")chargingPage();
 else if(page==="usage")usagePage();
 else if(page==="history")historyPage();
 else if(page==="reports")reportsPage();
 else if(page==="settings")settingsPage();
}

function dashboard(){
 const stock=devices.filter(x=>x.state!=="領用中"), issued=devices.filter(x=>x.state==="領用中"), soon=stock.filter(x=>statusOf(x).label==="即將到期"), overdue=stock.filter(x=>statusOf(x).label==="逾期"), proc=devices.filter(x=>["送檢充電","充電中"].includes(x.state));
 document.getElementById("content").innerHTML=`<div class="cards">${card("設備總數",devices.length)}${card("目前在庫",stock.length,"success")}${card("領用中",issued.length)}${card("30天內到期",soon.length,"warning")}${card("逾期",overdue.length,"danger")}${card("送檢／充電",proc.length,"info")}</div>
 <div class="panel"><h2>業務規則</h2><div class="kpi-mini"><div>在庫週期<b>6個月</b></div><div>提前預警<b>30天</b></div><div>領用期間<b>停止計時</b></div><div>退庫<b>重新起算6個月</b></div></div></div>
 <div class="panel"><h2>逾期設備</h2>${overdue.length?deviceTable(overdue,true):'<div class="empty">目前沒有逾期設備</div>'}</div>`;
}
function deviceTable(list,showDays=false){
 return `<div class="table-wrap"><table><thead><tr><th>料號</th><th>台電編號</th><th>型式</th><th>評價</th><th>狀態</th><th>週期起算</th><th>下次充電</th><th>單號</th><th>操作</th></tr></thead><tbody>${list.map(x=>{const s=statusOf(x);return `<tr><td>${esc(x.material_no)}</td><td>${esc(x.taipower_no)}</td><td>${esc(x.type)}</td><td>${esc(x.rating_type)}</td><td><span class="badge ${s.cls}">${s.label}</span></td><td>${fmt(x.cycle_start_date)}</td><td>${fmt(x.next_charge_date)}${showDays&&s.days!==null?`<br><span class="muted">${s.days<0?"逾期 "+Math.abs(s.days)+" 天":"剩 "+s.days+" 天"}</span>`:""}</td><td>${esc(x.transfer_no||x.issue_no||"-")}</td><td><button class="btn small secondary" type="button" onclick="detail('${x.id}')">查看</button></td></tr>`}).join("")}</tbody></table></div>`;
}
function switchesPage(){
 document.getElementById("content").innerHTML=`<div class="panel"><div class="toolbar"><input id="sq" placeholder="搜尋料號／台電編號／型式／單號" oninput="filterDevices()"><select id="ss" onchange="filterDevices()"><option value="">全部狀態</option><option>正常</option><option>即將到期</option><option>逾期</option><option>領用中</option><option>送檢充電</option><option>充電中</option></select><button class="btn secondary" type="button" onclick="exportCSV()">匯出CSV</button></div><div id="dt">${deviceTable(devices)}</div></div>`;
}
function filterDevices(){
 const q=(document.getElementById("sq").value||"").toLowerCase(),s=document.getElementById("ss").value;
 document.getElementById("dt").innerHTML=deviceTable(devices.filter(x=>(!q||[x.material_no,x.taipower_no,x.type,x.issue_no,x.transfer_no].join(" ").toLowerCase().includes(q))&&(!s||statusOf(x).label===s)));
}
function chargingPage(){
 const list=devices.filter(x=>x.state!=="領用中"&&["即將到期","逾期","送檢充電","充電中"].includes(statusOf(x).label));
 document.getElementById("content").innerHTML=`<div class="notice">只有在庫設備進行6個月充電倒數。領用後停止計時；退庫後從退庫日重新起算。</div><div class="panel"><div class="toolbar"><button class="btn" type="button" onclick="batchSend()">批次送檢</button></div>${list.length?deviceTable(list,true):'<div class="empty">目前沒有需要處理的設備</div>'}</div>`;
}
function usagePage(){
 const issued=devices.filter(x=>x.state==="領用中"), stock=devices.filter(x=>x.state!=="領用中");
 document.getElementById("content").innerHTML=`<div class="notice">領用中的開關不需要紀錄充電。退庫後視同剛入庫，退庫日重新起算6個月。</div><div class="panel"><h2>領用中（${issued.length}）</h2>${issued.length?deviceTable(issued):'<div class="empty">目前沒有領用中的設備</div>'}</div><div class="panel"><div class="toolbar"><button class="btn" type="button" onclick="openUsage('issue',${JSON.stringify(stock.map(x=>x.id))})">領用／出庫</button><button class="btn success" type="button" onclick="openUsage('return',${JSON.stringify(issued.map(x=>x.id))})">退庫／重新入庫</button></div></div>`;
}
async function historyPage(){
 document.getElementById("content").innerHTML=`<div class="panel"><div class="toolbar"><input id="hq" placeholder="搜尋台電編號／料號／事件／單號" oninput="filterHistory()"></div><div id="ht"><div class="empty">載入中…</div></div></div>`;
 const {data,error}=await SUPABASE.from("audit_log").select("*").order("event_at",{ascending:false}).limit(1000);
 if(error){document.getElementById("ht").innerHTML=`<div class="notice danger">${esc(errText(error))}</div>`;return;}
 auditRows=data||[];renderHistoryRows(auditRows);
}
function renderHistoryRows(rows){document.getElementById("ht").innerHTML=rows.length?`<div class="table-wrap"><table><thead><tr><th>時間</th><th>事件</th><th>設備</th><th>料號</th><th>單號</th><th>操作者</th><th>備註</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${new Date(r.event_at).toLocaleString("zh-TW")}</td><td>${esc(r.event_type)}</td><td>${esc(r.taipower_no||"-")}</td><td>${esc(r.material_no||"-")}</td><td>${esc(r.document_no||"-")}</td><td>${esc(r.actor_email||"-")}</td><td>${esc(r.note||"-")}</td></tr>`).join("")}</tbody></table></div>`:'<div class="empty">尚無紀錄</div>'}
function filterHistory(){const q=(document.getElementById("hq").value||"").toLowerCase();renderHistoryRows(auditRows.filter(r=>[r.event_type,r.taipower_no,r.material_no,r.document_no,r.actor_email,r.note].join(" ").toLowerCase().includes(q)))}

function openDevice(x=null){
 const v=x||{material_no:"",taipower_no:"",type:"",rating_type:"新品",warehouse:"",location:"",entry_date:today(),remark:""};
 document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>${x?"編輯":"新增"}開關設備</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="form form-grid"><div><label>開關料號（10位）*</label><input id="fm" maxlength="10" value="${esc(v.material_no)}"></div><div><label>台電編號 *</label><input id="ft" value="${esc(v.taipower_no)}"></div><div class="full"><label>型式 *</label><input id="fy" value="${esc(v.type)}"></div><div><label>評價類型</label><select id="fr"><option ${v.rating_type==="新品"?"selected":""}>新品</option><option ${v.rating_type==="舊品"?"selected":""}>舊品</option></select></div><div><label>入帳日期 *</label><input id="fe" type="date" value="${v.entry_date||today()}"></div><div><label>倉庫</label><input id="fw" value="${esc(v.warehouse||"")}"></div><div><label>儲位</label><input id="fl" value="${esc(v.location||"")}"></div><div class="full"><label>備註</label><textarea id="fn">${esc(v.remark||"")}</textarea></div></div><div id="formMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn" id="saveDeviceBtn" type="button" onclick="saveDevice('${x?.id||""}')">儲存</button></div></div></div>`);
}
function formError(msg){const e=document.getElementById("formMsg");if(e){e.textContent=msg;e.style.display="block"}}
async function saveDevice(id){
 if(busy)return;busy=true;const btn=document.getElementById("saveDeviceBtn");if(btn){btn.disabled=true;btn.textContent="儲存中…"}
 try{
  const m=document.getElementById("fm").value.trim(),t=document.getElementById("ft").value.trim(),type=document.getElementById("fy").value.trim(),e=document.getElementById("fe").value;
  if(!/^\d{10}$/.test(m))throw new Error("料號必須為10位數字。");
  if(!t||!type||!e)throw new Error("請完整填寫必填欄位。");
  const row={material_no:m,taipower_no:t,type,rating_type:document.getElementById("fr").value,warehouse:document.getElementById("fw").value.trim(),location:document.getElementById("fl").value.trim(),entry_date:e,remark:document.getElementById("fn").value.trim()};
  let res;
  if(id) res=await SUPABASE.from("switches").update(row).eq("id",id).select().single();
  else res=await SUPABASE.from("switches").insert({...row,state:"在庫",cycle_start_date:e,next_charge_date:addMonths(e,CYCLE_MONTHS)}).select().single();
  if(res.error)throw res.error;
  closeModal();await refresh();
 }catch(e){console.error(e);formError("儲存失敗："+errText(e));}
 finally{busy=false;const b=document.getElementById("saveDeviceBtn");if(b){b.disabled=false;b.textContent="儲存";}}
}

function openUsage(mode,ids){
 if(!ids.length)return alert("目前沒有可操作的設備。");
 const list=ids.map(id=>devices.find(x=>x.id===id)).filter(Boolean);
 document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>${mode==="issue"?"領用／出庫":"退庫／重新入庫"}</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="form-grid"><div class="full"><label>設備</label><select id="uid">${list.map(x=>`<option value="${x.id}">${esc(x.taipower_no)}｜${esc(x.material_no)}｜${esc(x.type)}</option>`).join("")}</select></div><div><label>${mode==="issue"?"領用日期":"退庫日期"} *</label><input id="ud" type="date" value="${today()}"></div><div><label>單號</label><input id="un"></div><div class="full"><label>備註</label><textarea id="unote"></textarea></div></div><div class="notice ${mode==="return"?"warning":""}">${mode==="issue"?"領用後立即停止6個月充電倒數。":"退庫後視同重新入庫，退庫日重新起算6個月。"}</div><div id="usageMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn ${mode==="return"?"success":""}" type="button" onclick="saveUsage('${mode}')">確認</button></div></div></div>`);
}
async function saveUsage(mode){
 const d=document.getElementById("ud").value,no=document.getElementById("un").value.trim(),note=document.getElementById("unote").value.trim(),id=document.getElementById("uid").value;
 if(!d)return showUsageMsg("日期不可空白。");
 try{
  const fn=mode==="issue"?"issue_switch":"return_switch";
  const {error}=await SUPABASE.rpc(fn,{p_switch_id:id,p_event_date:d,p_document_no:no||null,p_note:note||null});
  if(error)throw error;closeModal();await refresh();
 }catch(e){showUsageMsg("操作失敗："+errText(e))}
}
function showUsageMsg(msg){const e=document.getElementById("usageMsg");if(e){e.textContent=msg;e.style.display="block"}}

function openCharge(id){
 document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>送檢充電</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="form-grid"><div><label>送檢日期 *</label><input id="cd" type="date" value="${today()}"></div><div><label>充電移撥單號 *</label><input id="cn"></div><div class="full"><label>備註</label><textarea id="cnote"></textarea></div></div><div id="chargeMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn" type="button" onclick="saveCharge('${id}')">確認送檢</button></div></div></div>`);
}
async function saveCharge(id){const d=document.getElementById("cd").value,no=document.getElementById("cn").value.trim(),note=document.getElementById("cnote").value.trim();if(!d||!no)return showChargeMsg("送檢日期與移撥單號不可空白。");try{const {error}=await SUPABASE.rpc("send_switch_for_charge",{p_switch_id:id,p_event_date:d,p_transfer_no:no,p_note:note||null});if(error)throw error;closeModal();await refresh()}catch(e){showChargeMsg("送檢失敗："+errText(e))}}
function showChargeMsg(msg){const e=document.getElementById("chargeMsg");if(e){e.textContent=msg;e.style.display="block"}}

function completeCharge(id){
 document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>登錄充電完成</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="form-grid"><div><label>實際完成充電日 *</label><input id="ccd" type="date" value="${today()}"></div><div><label>移撥單號</label><input id="ccn"></div><div class="full"><label>備註</label><textarea id="ccnote"></textarea></div></div><div class="notice">完成後重新以實際完成日期起算6個月。</div><div id="completeMsg" class="notice danger" style="display:none"></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn success" type="button" onclick="finishCharge('${id}')">確認完成</button></div></div></div>`);
}
async function finishCharge(id){const d=document.getElementById("ccd").value,no=document.getElementById("ccn").value.trim(),note=document.getElementById("ccnote").value.trim();if(!d)return showCompleteMsg("完成日期不可空白。");try{const {error}=await SUPABASE.rpc("complete_switch_charge",{p_switch_id:id,p_event_date:d,p_transfer_no:no||null,p_note:note||null});if(error)throw error;closeModal();await refresh()}catch(e){showCompleteMsg("完成充電失敗："+errText(e))}}
function showCompleteMsg(msg){const e=document.getElementById("completeMsg");if(e){e.textContent=msg;e.style.display="block"}}

function detail(id){
 const x=devices.find(z=>z.id===id);if(!x)return;const s=statusOf(x);
 document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>設備詳細資料</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="form-grid"><div><b>料號</b><br>${esc(x.material_no)}</div><div><b>台電編號</b><br>${esc(x.taipower_no)}</div><div class="full"><b>型式</b><br>${esc(x.type)}</div><div><b>評價</b><br>${esc(x.rating_type)}</div><div><b>狀態</b><br><span class="badge ${s.cls}">${s.label}</span></div><div><b>入帳日期</b><br>${fmt(x.entry_date)}</div><div><b>週期起算日</b><br>${fmt(x.cycle_start_date)}</div><div><b>下次充電</b><br>${fmt(x.next_charge_date)}</div><div><b>倉庫／儲位</b><br>${esc(x.warehouse||"-")} / ${esc(x.location||"-")}</div><div><b>單號</b><br>${esc(x.transfer_no||x.issue_no||"-")}</div></div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal();openDevice(devices.find(z=>z.id==='${x.id}'))">編輯</button>${x.state==="在庫"&&["逾期","即將到期"].includes(s.label)?`<button class="btn" type="button" onclick="closeModal();openCharge('${x.id}')">送檢充電</button>`:""}${["送檢充電","充電中"].includes(x.state)?`<button class="btn success" type="button" onclick="closeModal();completeCharge('${x.id}')">完成充電</button>`:""}${x.state==="領用中"?`<button class="btn success" type="button" onclick="closeModal();openUsage('return',['${x.id}'])">退庫</button>`:`<button class="btn danger" type="button" onclick="closeModal();openUsage('issue',['${x.id}'])">領用／出庫</button>`}</div><hr><h3>生命週期</h3>${x.history_html||'<div class="muted">詳細歷史請至「生命週期紀錄」查看。</div>'}</div></div>`);
}
function batchSend(){const list=devices.filter(x=>["逾期","即將到期"].includes(statusOf(x).label));if(!list.length)return alert("目前沒有可批次送檢的設備。");const date=prompt("請輸入送檢日期 YYYY-MM-DD",today());if(!date)return;Promise.all(list.map(x=>SUPABASE.rpc("send_switch_for_charge",{p_switch_id:x.id,p_event_date:date,p_transfer_no:null,p_note:"批次送檢"}))).then(results=>{const err=results.find(r=>r.error);if(err)alert("部分／全部送檢失敗："+errText(err.error));else refresh()})}
function closeModal(){document.getElementById("modal")?.remove()}
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
document.addEventListener("click",e=>{if(e.target?.id==="modal")closeModal()});

function settingsPage(){
 const keyOk=CLEAN_KEY.startsWith("sb_publishable_");
 document.getElementById("content").innerHTML=`<div class="panel"><h2>連線診斷</h2><p class="${HAS_CONFIG?"":"db-bad"}">${HAS_CONFIG?"已載入 Supabase 設定":"尚未載入 Supabase 設定"}</p><div class="diagnostic">Project URL：${esc(CFG.SUPABASE_URL||"(空白)")}
Key 格式：${keyOk?"sb_publishable_（正確）":"未設定或格式錯誤"}
目前使用者：${esc(session?.user?.email||"(未登入)")}</div></div><div class="panel"><h2>正式保存架構</h2><p>PostgreSQL 主檔＋audit_log 稽核紀錄＋RLS。一般流程不直接刪除設備，使用停用機制。</p><button class="btn secondary" type="button" onclick="testDB()">測試資料庫連線</button><div id="dbTest" class="muted" style="margin-top:10px"></div></div>`;
}
async function testDB(){const e=document.getElementById("dbTest");if(!SUPABASE||!session){e.textContent="尚未登入。";return}e.textContent="測試中…";const {data,error}=await SUPABASE.from("switches").select("id",{count:"exact",head:true});e.textContent=error?"失敗："+errText(error):"連線成功。switches 表可正常查詢。"}

function report(k){let head=[],rows=[];if(k==="overdue"){head=["料號","台電編號","型式","下次充電","逾期天數"];rows=devices.filter(x=>statusOf(x).label==="逾期").map(x=>[x.material_no,x.taipower_no,x.type,x.next_charge_date,Math.abs(statusOf(x).days)])}else if(k==="soon"){head=["料號","台電編號","型式","下次充電","剩餘天數"];rows=devices.filter(x=>statusOf(x).label==="即將到期").map(x=>[x.material_no,x.taipower_no,x.type,x.next_charge_date,statusOf(x).days])}else{head=["料號","台電編號","型式","領用日期","領用單號"];rows=devices.filter(x=>x.state==="領用中").map(x=>[x.material_no,x.taipower_no,x.type,x.issue_date,x.issue_no])}download(head,rows,"SwitchCare_"+k+"_"+today()+".csv")}
function exportCSV(){download(["料號","型式","台電編號","評價","倉庫","儲位","入帳日期","狀態","週期起算日","上次充電日","下次充電日","領用日期","退庫日期","領用單號","充電移撥單號"],devices.map(x=>[x.material_no,x.type,x.taipower_no,x.rating_type,x.warehouse,x.location,x.entry_date,x.state,x.cycle_start_date,x.last_charge_date,x.next_charge_date,x.issue_date,x.return_date,x.issue_no,x.transfer_no]),"SwitchCare_設備主檔_"+today()+".csv")}
function download(head,rows,name){const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const csv="\uFEFF"+[head,...rows].map(r=>r.map(q).join(",")).join("\r\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=name;a.click()}

if(SUPABASE){SUPABASE.auth.onAuthStateChange((event,s)=>{session=s;if(event==="SIGNED_OUT")renderLogin()})}
boot();
