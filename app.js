const CFG=window.SWITCHCARE_CONFIG||{};
const CYCLE=Number(CFG.CYCLE_MONTHS||6);
const REMIND=Number(CFG.REMIND_DAYS||30);
const RAW_KEY=String(CFG.SUPABASE_PUBLISHABLE_KEY||CFG.SUPABASE_ANON_KEY||"").trim();
/* Be defensive if an earlier setup accidentally pasted the publishable prefix twice. */
const CLEAN_KEY=RAW_KEY.replace(/^sb_publishable_sb_publishable_/,"sb_publishable_");
const HAS_DB=!!(CFG.SUPABASE_URL&&CLEAN_KEY&&window.supabase);
const DB=HAS_DB?window.supabase.createClient(CFG.SUPABASE_URL,CLEAN_KEY,{
  auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
}):null;
let page="dashboard",devices=[],session=null,auditRows=[];

const today=()=>new Date().toISOString().slice(0,10);
const fmt=d=>d?new Date(d+"T00:00:00").toLocaleDateString("zh-TW"):"-";
const diffDays=(a,b)=>Math.ceil((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000);
const addMonths=(d,m)=>{const x=new Date(d+"T00:00:00");x.setMonth(x.getMonth()+m);return x.toISOString().slice(0,10)};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function requireReady(){if(!HAS_DB)return "尚未連接 Supabase。請先設定 config.js。";if(!session)return "尚未登入，請先登入系統。";return ""}

async function boot(){
  if(!HAS_DB){renderSetup();return}
  const {data,error}=await DB.auth.getSession();
  if(error){renderAuthError("讀取登入狀態失敗："+error.message);return}
  session=data.session;
  if(!session){renderLogin();return}
  renderLayout();
  await refresh();
}
async function signIn(){
  const email=document.getElementById("loginEmail").value.trim();
  const password=document.getElementById("loginPassword").value;
  const err=document.getElementById("loginError");
  const btn=document.getElementById("loginBtn");
  err.style.display="none";
  if(!email||!password){showLoginError("請輸入 Email 與密碼。");return}
  btn.disabled=true;btn.textContent="登入中…";
  try{
    const {data,error}=await DB.auth.signInWithPassword({email,password});
    if(error){
      showLoginError("登入失敗："+error.message);
      return;
    }
    if(!data?.session){
      showLoginError("Supabase 沒有回傳有效 Session。請確認帳號與密碼設定。");
      return;
    }
    session=data.session;
    renderLayout();
    await refresh();
  }catch(e){
    console.error(e);
    showLoginError("登入程式發生錯誤："+(e?.message||e));
  }finally{
    if(document.getElementById("loginBtn")){document.getElementById("loginBtn").disabled=false;document.getElementById("loginBtn").textContent="登入系統";}
  }
}
function showLoginError(msg){
  const e=document.getElementById("loginError");
  if(e){e.textContent=msg;e.style.display="block";}
}
async function signOut(){await DB.auth.signOut();session=null;renderLogin()}
function renderSetup(){document.getElementById("app").innerHTML=`<div class="auth-wrap"><div class="auth-card"><h1>SWITCHCARE</h1><div class="sub">台電自動線路開關生命週期管理系統</div><div class="notice warning"><b>尚未設定正式資料庫</b><br>目前故意不顯示可儲存的設備表單，避免使用者輸入後才發現資料無法寫入。</div><p class="muted">請在 GitHub 的 config.js 填入 Supabase Project URL 與 Publishable Key (sb_publishable_...)，並執行 database/schema.sql。</p></div></div>`}
function renderAuthError(msg){document.getElementById("app").innerHTML=`<div class="auth-wrap"><div class="auth-card"><h1>SWITCHCARE</h1><div class="sub">資料庫連線設定異常</div><div class="auth-error" style="display:block">${esc(msg)}</div><p class="muted">請檢查 config.js 與 Supabase 設定。</p></div></div>`}
function renderLogin(){
  document.getElementById("app").innerHTML=`<div class="auth-wrap"><div class="auth-card">
    <h1>SWITCHCARE</h1><div class="sub">台電自動線路開關生命週期管理系統</div>
    <label>Email</label><input id="loginEmail" type="email" autocomplete="username" placeholder="your@email.com">
    <label>密碼</label><input id="loginPassword" type="password" autocomplete="current-password" onkeydown="if(event.key==="Enter")signIn()">
    <div id="loginError" class="auth-error" style="display:none"></div>
    <button id="loginBtn" class="btn" type="button" onclick="signIn()">登入系統</button>
  </div></div>`;
}
function closeModal(){document.getElementById("modal")?.remove()}
function openUsage(mode,ids){if(!ids.length)return alert("沒有可操作的設備。");const list=ids.map(id=>devices.find(x=>x.id===id)).filter(Boolean);document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>${mode==="issue"?"領用／出庫":"退庫／重新入庫"}</h2><button class="close" type="button" onclick="closeModal()">×</button></div><div class="form-grid"><div class="full"><label>設備</label><select id="uid">${list.map(x=>`<option value="${x.id}">${esc(x.taipower_no)}｜${esc(x.material_no)}｜${esc(x.type)}</option>`).join("")}</select></div><div><label>${mode==="issue"?"領用日期":"退庫日期"} *</label><input id="ud" type="date" value="${today()}"></div><div><label>單號</label><input id="un"></div><div class="full"><label>備註</label><textarea id="unote"></textarea></div></div><div class="notice ${mode==="return"?"warning":""}">${mode==="issue"?"領用後立即停止6個月充電倒數。":"退庫後視同重新入庫，從退庫日重新起算6個月。"}</div><div class="page-actions"><button class="btn secondary" type="button" onclick="closeModal()">取消</button><button class="btn ${mode==="return"?"success":""}" type="button" onclick="saveUsage('${mode}')">確認</button></div></div></div>`) }
async function saveUsage(mode){const id=document.getElementById("uid").value,d=document.getElementById("ud").value,no=document.getElementById("un").value.trim(),note=document.getElementById("unote").value.trim();if(!d)return alert("日期不可空白。");const fn=mode==="issue"?"issue_switch":"return_switch";const {error}=await DB.rpc(fn,{p_switch_id:id,p_event_date:d,p_document_no:no||null,p_note:note||null});if(error)return alert(error.message);closeModal();await refresh()}
function openCharge(id){document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>送檢充電</h2><button class="close" onclick="closeModal()">×</button></div><div class="form-grid"><div><label>送檢日期 *</label><input id="cd" type="date" value="${today()}"></div><div><label>充電移撥單號 *</label><input id="cn"></div><div class="full"><label>備註</label><textarea id="cnote"></textarea></div></div><div id="chargeMsg" class="notice" style="display:none"></div><div class="page-actions"><button class="btn secondary" onclick="closeModal()">取消</button><button class="btn" onclick="saveCharge('${id}')">確認</button></div></div></div>`)}
async function saveCharge(id){const d=document.getElementById("cd").value,no=document.getElementById("cn").value.trim(),note=document.getElementById("cnote").value.trim();if(!d||!no)return alert("送檢日期與移撥單號不可空白。");const {error}=await DB.rpc("send_switch_for_charge",{p_switch_id:id,p_event_date:d,p_transfer_no:no,p_note:note||null});if(error)return alert(error.message);closeModal();await refresh()}
function completeCharge(id){document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>登錄充電完成</h2><button class="close" onclick="closeModal()">×</button></div><div class="form-grid"><div><label>實際完成日期 *</label><input id="ccd" type="date" value="${today()}"></div><div><label>移撥單號</label><input id="ccn"></div><div class="full"><label>備註</label><textarea id="ccnote"></textarea></div></div><div class="notice">完成後：上次充電日＝實際完成日；下次充電日＝完成日＋6個月。</div><div class="page-actions"><button class="btn secondary" onclick="closeModal()">取消</button><button class="btn success" onclick="finishCharge('${id}')">確認完成</button></div></div></div>`)}
async function finishCharge(id){const d=document.getElementById("ccd").value,no=document.getElementById("ccn").value.trim(),note=document.getElementById("ccnote").value.trim();if(!d)return alert("完成日期不可空白。");const {error}=await DB.rpc("complete_switch_charge",{p_switch_id:id,p_event_date:d,p_transfer_no:no||null,p_note:note||null});if(error)return alert(error.message);closeModal();await refresh()}
function detail(id){const x=devices.find(z=>z.id===id);if(!x)return;const s=stateOf(x);document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>設備詳細資料</h2><button class="close" onclick="closeModal()">×</button></div><div class="form-grid"><div><b>料號</b><br>${esc(x.material_no)}</div><div><b>台電編號</b><br>${esc(x.taipower_no)}</div><div class="full"><b>型式</b><br>${esc(x.type)}</div><div><b>評價</b><br>${esc(x.rating_type)}</div><div><b>狀態</b><br><span class="badge ${s.cls}">${s.label}</span></div><div><b>入帳日期</b><br>${fmt(x.entry_date)}</div><div><b>週期起算</b><br>${fmt(x.cycle_start_date)}</div><div><b>下次充電</b><br>${fmt(x.next_charge_date)}</div><div><b>倉庫／儲位</b><br>${esc(x.warehouse||"-")} / ${esc(x.location||"-")}</div><div><b>單號</b><br>${esc(x.transfer_no||x.issue_no||"-")}</div></div><div class="page-actions"><button class="btn secondary" onclick="closeModal();openDevice(devices.find(z=>z.id==='${x.id}'))">編輯</button>${x.state==="在庫"&&["逾期","即將到期"].includes(s.label)?`<button class="btn" onclick="closeModal();openCharge('${x.id}')">送檢</button>`:""}${["送檢充電","充電中"].includes(x.state)?`<button class="btn success" onclick="closeModal();completeCharge('${x.id}')">完成充電</button>`:""}${x.state==="領用中"?`<button class="btn success" onclick="closeModal();openUsage('return',['${x.id}'])">退庫</button>`:`<button class="btn danger" onclick="closeModal();openUsage('issue',['${x.id}'])">領用／出庫</button>`}</div></div></div>`)}
function report(k){let head=[],rows=[];if(k==="overdue"){head=["料號","台電編號","型式","下次充電","逾期天數"];rows=devices.filter(x=>stateOf(x).label==="逾期").map(x=>[x.material_no,x.taipower_no,x.type,x.next_charge_date,Math.abs(stateOf(x).days)])}else if(k==="soon"){head=["料號","台電編號","型式","下次充電","剩餘天數"];rows=devices.filter(x=>stateOf(x).label==="即將到期").map(x=>[x.material_no,x.taipower_no,x.type,x.next_charge_date,stateOf(x).days])}else{head=["料號","台電編號","型式","領用日期","領用單號"];rows=devices.filter(x=>x.state==="領用中").map(x=>[x.material_no,x.taipower_no,x.type,x.issue_date,x.issue_no])}download(head,rows,"SwitchCare_"+k+"_"+today()+".csv")}
function exportCSV(){download(["料號","型式","台電編號","評價","倉庫","儲位","入帳日期","狀態","週期起算日","上次充電日","下次充電日","領用日期","退庫日期","領用單號","充電移撥單號"],devices.map(x=>[x.material_no,x.type,x.taipower_no,x.rating_type,x.warehouse,x.location,x.entry_date,x.state,x.cycle_start_date,x.last_charge_date,x.next_charge_date,x.issue_date,x.return_date,x.issue_no,x.transfer_no]),"SwitchCare_設備主檔_"+today()+".csv")}
function download(head,rows,name){const q=v=>`"${String(v??"").replace(/"/g,'""')}"`,csv="\uFEFF"+[head,...rows].map(r=>r.map(q).join(",")).join("\r\n"),a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));a.download=name;a.click()}
function batchSend(){const list=devices.filter(x=>["逾期","即將到期"].includes(stateOf(x).label));if(!list.length)return alert("目前沒有可送檢設備。");document.body.insertAdjacentHTML("beforeend",`<div class="modal" id="modal"><div class="modal-box"><div class="modal-head"><h2>批次送檢</h2><button class="close" onclick="closeModal()">×</button></div><div class="form-grid"><div><label>送檢日期</label><input id="bd" type="date" value="${today()}"></div></div>${table(list,true)}<div class="page-actions"><button class="btn secondary" onclick="closeModal()">取消</button><button class="btn" onclick="batchSave(${JSON.stringify(list.map(x=>x.id))})">確認</button></div></div></div>`)}
async function batchSave(ids){const d=document.getElementById("bd").value;if(!d)return alert("日期不可空白。");for(const id of ids){const {error}=await DB.rpc("send_switch_for_charge",{p_switch_id:id,p_event_date:d,p_transfer_no:null,p_note:"批次送檢"});if(error)return alert(error.message)}closeModal();await refresh()}
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});document.addEventListener("click",e=>{if(e.target?.id==="modal")closeModal()});
if(DB){DB.auth.onAuthStateChange((_event,s)=>{session=s})}
boot();
