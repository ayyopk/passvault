import { APP_VERSION } from './version.js';
import { emptyVault, normalizeVault, contentSnapshot, addDraft, updateItem, completeDraft, removeItem } from './model.js';
import { encryptVault, decryptVault } from './crypto.js';
import { readEncryptedFile, readLegacyFile, legacyImportMessage } from './import.js';
import { searchItems } from './search.js';
import { isReadonlyDevice, MOBILE_BREAKPOINT, createBackgroundLock } from './platform.js';
import { exportFilename, prepareExport, acknowledgeExport } from './export.js';
let vault=null,selectedId=null,currentFolder="all",dirty=false,unlockPayload=null,masterKeyPassword="",currentVaultName="尚未命名";
const readonlyMode=isReadonlyDevice(navigator);
let baseline=null,sessionEpoch=0,exportBusy=false,exportPending=null,revealTimer=null,backupLabel="已開啟既有備份";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const escapeHTML=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const iconText=t=>(t||"?").trim().slice(0,1).toUpperCase();
function highlightMatch(text,q){
  const base=String(text??"");
  if(!q) return escapeHTML(base||"未命名");
  const safe=escapeHTML(base);
  const escapedQ=q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return safe.replace(new RegExp(escapedQ,'gi'),m=>`<mark>${m}</mark>`);
}

function applyVersion(){
  document.title=`PassVault ${APP_VERSION}`;
  const loginVersion=$("#loginVersion"),appVersion=$("#appVersion");
  if(loginVersion)loginVersion.textContent=`v${APP_VERSION}`;
  if(appVersion)appVersion.textContent=`v${APP_VERSION}`;
  $("#releaseVersion").textContent=`PassVault v${APP_VERSION}`;
}
const compactQuery=window.matchMedia(`(max-width:${MOBILE_BREAKPOINT}px)`);
function applyLayout(){document.body.classList.toggle("compact-layout",readonlyMode||compactQuery.matches)}
applyLayout();compactQuery.addEventListener("change",applyLayout);
applyVersion();

function setMsg(msg,type=""){
  const el=$("#loginMsg"); el.textContent=msg; el.className="small "+(type==="bad"?"danger-text":type==="good"?"good-text":"");
}
function showApp(){
  selectedId=null;currentFolder="all";$("#searchInput").value="";
  $("#layout").classList.remove("show-folders","show-detail");
  $("#login").classList.add("hidden");$("#app").classList.remove("hidden");
  applyVersion();
  $("#modeLabel").textContent=readonlyMode?"手機唯讀":"電腦編輯";
  $("#addBtn").classList.toggle("hidden",readonlyMode);$("#saveBtn").classList.toggle("hidden",readonlyMode);
  if(readonlyMode){
    selectedId=null;
    currentFolder="all";
    $("#searchInput").value="";
    mobileTab("folders");
  }
  render();
}
function lockApp(){
  sessionEpoch++;
  backgroundLock.reset();
  clearTimeout(revealTimer);revealTimer=null;
  vault=null;selectedId=null;masterKeyPassword="";unlockPayload=null;dirty=false;baseline=null;currentVaultName="尚未命名";
  exportPending=null;closeModal();$("#modalCard").replaceChildren();
  for(const id of ["#items","#folders","#detailBody"]) $(id).replaceChildren();
  for(const id of ["#masterPassword","#searchInput","#vaultFile","#legacyFile"]) $(id).value="";
  $("#app").classList.add("hidden");$("#login").classList.remove("hidden");$("#unlockBox").classList.add("hidden");
  setMsg("");
}
function refreshDirty(){dirty=!!vault&&(baseline===null||contentSnapshot(vault)!==baseline)}
function render(){
  if(!vault)return;
  refreshDirty();
  renderFolders();renderItems();renderDetail();renderVaultStatus();
  const q=$("#searchInput").value.trim();
  const total=vault.items.filter(i=>!i.isDraft).length;
  $("#countStatus").textContent=q
    ? `找到 ${filteredItems().length} 筆結果${dirty&&!readonlyMode?" · 尚未匯出":""}`
    : `${filteredItems().length} / ${total} 筆${dirty&&!readonlyMode?" · 尚未匯出":""}`;
}
function renderVaultStatus(){
  const name=$("#vaultFileName"),updated=$("#vaultUpdatedAt"),state=$("#backupState");
  if(!name||!updated||!state||!vault)return;
  name.textContent=currentVaultName||"尚未命名";
  updated.textContent=vault.updatedAt?new Date(vault.updatedAt).toLocaleString():"—";
  const hasDraft=vault.items.some(i=>i.isDraft);
  if(hasDraft){state.textContent="有未完成草稿";state.className="unsaved";}
  else if(dirty){state.textContent="尚未匯出";state.className="unsaved";}
  else{state.textContent=backupLabel;state.className="saved";}
}
function filteredItems(){return searchItems(vault,currentFolder,$("#searchInput").value)}
function renderFolders(){
  const completed=vault.items.filter(i=>!i.isDraft);
  const counts=Object.create(null),pending=Object.create(null);
  completed.forEach(i=>{
    counts[i.folderId]=(counts[i.folderId]||0)+1;
    if(i.pendingBackup)pending[i.folderId]=true;
  });
  const totalPending=completed.some(i=>i.pendingBackup);
  let html=`<button class="folder ${currentFolder==="all"?"active":""} ${totalPending?"has-new":""}" data-folder="all"><span>所有項目</span><small>${completed.length}</small></button>`;
  vault.folders.forEach(f=>html+=`<button class="folder ${currentFolder===f.id?"active":""} ${pending[f.id]?"has-new":""}" data-folder="${escapeHTML(f.id)}"><span>${escapeHTML(f.name)}${pending[f.id]?` <b class="pending-dot">NEW</b>`:""}</span><small>${counts[f.id]||0}</small></button>`);
  $("#folders").innerHTML=html;
  $$("#folders .folder").forEach(b=>b.onclick=()=>{currentFolder=b.dataset.folder;mobileTab("list");render()});
}
function renderItems(){
  const arr=filteredItems();
  const q=$("#searchInput").value.trim();
  $("#items").innerHTML=arr.length?arr.map(i=>{
    const subText=i.account||i.notes||"尚未填寫帳號";
    return `<div class="item ${selectedId===i.id?"active":""} ${i.pendingBackup?"is-new-unsaved":""}" data-id="${escapeHTML(i.id)}">
      <div class="icon">${escapeHTML(iconText(i.title))}</div>
      <div class="item-main">
        <div class="item-title">${highlightMatch(i.title||"未命名",q)}${i.pendingBackup?` <span class="pending-item-label">新增</span>`:""}</div>
        <div class="item-sub">${highlightMatch(subText,q)}</div>
      </div>
    </div>`;
  }).join("")
    :`<div class="detail-empty">找不到符合條件的項目</div>`;
  $$("#items .item").forEach(el=>el.onclick=()=>{selectedId=el.dataset.id;mobileTab("detail");render()});
}
function renderDetail(){
  const box=$("#detailBody"),i=vault.items.find(x=>x.id===selectedId);
  if(!i){box.innerHTML='<div class="detail-empty">選擇一筆帳號<br>即可查看詳細內容</div>';return}
  if(readonlyMode){renderReadonly(box,i);return}
  renderEdit(box,i);
}
function renderReadonly(box,i){
  box.innerHTML=`<div class="detail-title-row"><div class="detail-title">${escapeHTML(i.title||"未命名")}</div></div>
    ${viewField("帳號",i.account,"account",true)}
    ${viewField("密碼","••••••••••••","password",true,true)}
    ${viewField("備註",i.notes,"notes",false)}
    <div class="meta">最後更新：${new Date(i.updatedAt).toLocaleString()}<br>資料只在本機瀏覽器記憶體解密顯示。</div>`;
  bindViewButtons(i);
}
function viewField(label,value,key,copyable,reveal=false){
  return `<div class="field"><label>${label}</label><div class="value-row"><div class="value ${key==="password"?"mono":""}" id="val-${key}">${escapeHTML(value||"—")}</div>
  ${reveal?`<button class="icon-btn" data-action="reveal" title="顯示">👁</button>`:""}
  ${copyable?`<button class="icon-btn" data-copy="${key}" title="複製">⧉</button>`:""}</div></div>`;
}
function bindViewButtons(i){
  $$("[data-copy]").forEach(b=>b.onclick=()=>copyText(i[b.dataset.copy]||""));
  const r=$('[data-action="reveal"]');if(r)r.onclick=()=>{
    const el=$("#val-password");el.textContent=i.password||"—";clearTimeout(revealTimer);revealTimer=setTimeout(()=>{el.textContent="••••••••••••"},12000);
  };
}
function renderEdit(box,i){
  const opts=vault.folders.map(f=>`<option value="${escapeHTML(f.id)}" ${i.folderId===f.id?"selected":""}>${escapeHTML(f.name)}</option>`).join("");
  box.innerHTML=`<div class="detail-title-row"><input class="edit-input" data-field="title" value="${escapeHTML(i.title)}" placeholder="標題">
    ${i.isDraft?"":`<button class="icon-btn" id="deleteBtn" title="刪除">✕</button>`}</div>
    ${i.isDraft?`<div class="draft-note"><b>新增帳密尚未完成</b><br>填寫內容並選擇分類後，請按下方「✓ 完成新增」。</div>`:""}
    <div class="field"><label>分類</label><select class="edit-select" data-field="folderId">${opts}</select></div>
    ${editField("帳號","account",i.account)}
    ${editField("密碼","password",i.password,true)}
    <div class="field"><label>備註</label><textarea class="edit-textarea" data-field="notes">${escapeHTML(i.notes)}</textarea></div>
    ${i.isDraft?`<div class="draft-actions">
      <button class="draft-cancel" id="cancelDraftBtn">取消</button>
      <button class="draft-complete" id="completeBtn"><span style="font-size:21px">✓</span> 完成新增</button>
    </div>`:`<div class="meta">建立：${new Date(i.createdAt).toLocaleString()}<br>最後更新：${new Date(i.updatedAt).toLocaleString()}</div>`}`;
  $$("[data-field]").forEach(el=>el.oninput=()=>{
    if(readonlyMode||!vault)return;updateItem(vault,i,el.dataset.field,el.value);refreshDirty();renderItems();renderFolders();renderVaultStatus();
    const q=$("#searchInput").value.trim();
    const total=vault.items.filter(x=>!x.isDraft).length;
    $("#countStatus").textContent=q?`找到 ${filteredItems().length} 筆結果${dirty?" · 尚未匯出":""}`:`${filteredItems().length} / ${total} 筆${dirty?" · 尚未匯出":""}`;
  });
  if(i.isDraft){
    $("#completeBtn").onclick=()=>{
      if(readonlyMode||!vault)return;
      try{completeDraft(vault,i)}catch(e){alert(e.message);return}
      currentFolder=i.folderId;
      selectedId=null;
      dirty=true;
      render();
      toast("新增完成，尚未匯出備份");
    };
    $("#cancelDraftBtn").onclick=()=>{
      if(!confirm("確定取消這筆新增資料嗎？"))return;
      if(readonlyMode||!vault)return;removeItem(vault,i.id);
      selectedId=null;
      render();
    };
  }else{
    $("#deleteBtn").onclick=()=>{if(readonlyMode||!vault||!confirm("確定刪除這筆帳密？"))return;removeItem(vault,i.id);selectedId=null;render()};
  }
  $$("[data-copy]").forEach(b=>b.onclick=()=>copyText(i[b.dataset.copy]||""));
  $$("[data-toggle-password]").forEach(button=>{
    button.onclick=()=>{
      const row=button.closest(".value-row");
      const input=row?.querySelector('input[data-field="password"]');
      if(!input)return;
      const willShow=input.type==="password";
      input.type=willShow?"text":"password";
      button.setAttribute("aria-label",willShow?"隱藏密碼":"顯示密碼");
      button.title=willShow?"隱藏密碼":"顯示密碼";
    };
  });
}
function editField(label,key,value,password=false){
  return `<div class="field"><label>${label}</label><div class="value-row"><input ${password?'type="password"':'type="text"'} class="edit-input ${password?"mono":""}" data-field="${key}" value="${escapeHTML(value)}">
  ${password?`<button class="icon-btn" data-toggle-password="${key}" title="顯示／隱藏">👁</button>`:""}
  <button class="icon-btn" data-copy="${key}">⧉</button></div></div>`;
}
async function copyText(text){
  if(!text)return;try{await navigator.clipboard.writeText(text);toast("已複製")}catch{toast("瀏覽器無法使用剪貼簿")}
}
function toast(msg){
  let t=document.getElementById("floatingToast");
  if(!t){t=document.createElement("div");t.id="floatingToast";t.className="floating-toast";document.body.appendChild(t)}
  t.textContent=msg;t.classList.add("show");clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove("show"),1800);
}
function mobileTab(tab){
  if(!readonlyMode&&innerWidth>MOBILE_BREAKPOINT)return;
  const l=$("#layout");l.classList.remove("show-folders","show-detail");
  if(tab==="folders")l.classList.add("show-folders");if(tab==="detail")l.classList.add("show-detail");
  $$(".mobile-tabbar button").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
}
function openModal(html){$("#modalCard").innerHTML=html;$("#modal").classList.remove("hidden")}
function closeModal(){exportPending=null;$("#modal").classList.add("hidden");$("#modalCard").replaceChildren()}
function addItem(){
  if(readonlyMode||!vault)return;
  const folder=currentFolder==="all"?(vault.folders[0]?.id||""):currentFolder;
  const i=addDraft(vault,folder);
  selectedId=i.id;
  mobileTab("detail");render();
  setTimeout(()=>document.querySelector('[data-field="title"]')?.focus(),0);
}
async function exportVault(){
  if(readonlyMode||!vault||exportBusy||exportPending)return;
  if(vault.items.some(i=>i.isDraft)){alert("請先完成或取消草稿。");return}
  if(!masterKeyPassword){
    openModal(`<h2>設定主密碼</h2><p class="small">請輸入至少 10 個字元。主密碼不會儲存在檔案中。</p>
    <input id="newPass" class="edit-input" type="password" placeholder="主密碼">
    <input id="newPass2" class="edit-input" type="password" placeholder="再次輸入" style="margin-top:10px">
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button id="confirmExport" class="btn primary">加密並匯出</button></div>`);
    $("#confirmExport").onclick=async()=>{
      const a=$("#newPass").value,b=$("#newPass2").value;if(a.length<10)return alert("主密碼至少 10 個字元");if(a!==b)return alert("兩次密碼不一致");
      masterKeyPassword=a;closeModal();await doExport();
    };return;
  }
  await doExport();
}
async function doExport(){
  if(readonlyMode||!vault||exportBusy||exportPending)return;
  exportBusy=true;$("#saveBtn").disabled=true;
  const session=sessionEpoch;
  let fileHandle=null;
  try{
    const filename=exportFilename();
    if(typeof window.showSaveFilePicker==="function"){
      fileHandle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:"PassVault 加密密碼庫",accept:{"application/json":[".pvault"]}}]});
    }
    if(session!==sessionEpoch||!vault)return;
    const exported=prepareExport(vault);
    const payload=await encryptVault(exported.data,masterKeyPassword);
    if(session!==sessionEpoch||!vault)return;
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    if(fileHandle){
      const stream=await fileHandle.createWritable();
      try{await stream.write(blob);await stream.close()}catch(e){try{await stream.abort()}catch{}throw e}
      if(session===sessionEpoch&&vault)finishExport(exported,fileHandle.name||filename);
    }else{
      const a=document.createElement("a"),url=URL.createObjectURL(blob);
      a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      exportPending={exported,filename,session};
      openModal('<h2>確認下載結果</h2><p class="small">已啟動下載。請先確認加密檔案已儲存；接著仍須手動放入 iCloud Drive。</p><div class="modal-actions"><button class="btn" id="downloadFailed">未儲存／取消</button><button class="btn primary" id="downloadSaved">已儲存下載檔</button></div>');
      $("#downloadFailed").onclick=()=>{exportPending=null;closeModal();render()};
      $("#downloadSaved").onclick=()=>{
        const pending=exportPending;exportPending=null;closeModal();
        if(pending&&vault&&pending.session===sessionEpoch)finishExport(pending.exported,pending.filename);
      };
    }
  }catch(e){if(session===sessionEpoch&&vault){render();toast(e.name==="AbortError"?"已取消匯出，尚未備份提示保留":"匯出失敗，尚未備份提示保留")}}
  finally{exportBusy=false;$("#saveBtn").disabled=false}
}
function finishExport(exported,filename){
  acknowledgeExport(vault,exported);baseline=exported.snapshot;currentVaultName=filename;backupLabel="已確認匯出";render();
  toast(dirty?"已匯出；之後的修改仍未備份":"已確認匯出；請手動放入 iCloud");
}
async function handleVaultFile(file){
  const session=++sessionEpoch;unlockPayload=null;$("#unlockBox").classList.remove("hidden");$("#masterPassword").value="";
  try{
    const payload=await readEncryptedFile(file);
    if(session!==sessionEpoch)return;unlockPayload=payload;
    currentVaultName=file.name;
    $("#unlockBox").classList.remove("hidden");setMsg(`已選擇：${file.name}`,"good");$("#masterPassword").focus();
  }catch{if(session===sessionEpoch){unlockPayload=null;setMsg("這不是有效或支援的 .pvault 檔案","bad")}}
}
async function handleLegacyFile(file){
  const session=++sessionEpoch;unlockPayload=null;
  closeModal();$("#unlockBox").classList.add("hidden");setMsg("正在讀取舊版 HTML…");
  try{
    const {converted,oldCount}=await readLegacyFile(file);if(session!==sessionEpoch)return;
    currentVaultName=file.name;
    const newCount=converted.items.length;
    openModal(`<h2>HTML 匯入分析</h2><div class="report">舊版帳密：${oldCount} 筆<br>新版帳密：${newCount} 筆<br>分類：${converted.folders.length} 個<br>遺失：${Math.max(0,oldCount-newCount)} 筆</div>
    <p class="small">原始 HTML 不會被修改。確認後只會在瀏覽器記憶體中開啟，之後請匯出新的加密 .pvault。</p>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">取消</button><button id="acceptLegacy" class="btn primary">確認轉換並開啟</button></div>`);
    $("#acceptLegacy").onclick=()=>{vault=converted;baseline=null;masterKeyPassword="";dirty=true;closeModal();showApp()};
  }catch(error){if(session===sessionEpoch)setMsg(legacyImportMessage(error),"bad")}
}
$("#vaultFile").onchange=e=>{const file=e.target.files[0];e.target.value="";if(file)handleVaultFile(file)};
$("#legacyFile").onchange=e=>{const file=e.target.files[0];e.target.value="";if(file)handleLegacyFile(file)};
$("#unlockBtn").onclick=async()=>{
  const p=$("#masterPassword").value;if(!p)return setMsg("請輸入主密碼","bad");
  const session=++sessionEpoch,payload=unlockPayload;
  try{const decoded=normalizeVault(await decryptVault(payload,p));if(session!==sessionEpoch)return;vault=decoded;baseline=contentSnapshot(vault);backupLabel="已開啟既有備份";masterKeyPassword=readonlyMode?"":p;$("#masterPassword").value="";unlockPayload=null;dirty=false;showApp()}
  catch{if(session===sessionEpoch)setMsg("主密碼錯誤，或檔案結構不完整／已損毀","bad")}
};
$("#masterPassword").onkeydown=e=>e.key==="Enter"&&$("#unlockBtn").click();
$("#newVaultBtn").onclick=()=>{if(readonlyMode)return;sessionEpoch++;baseline=null;vault=emptyVault();masterKeyPassword="";currentVaultName="新的密碼庫";dirty=true;showApp()};
$("#searchInput").oninput=()=>{ if(readonlyMode) mobileTab("list"); render(); };
$("#backToFoldersBtn").onclick=()=>{
  $("#searchInput").value="";
  currentFolder="all";
  selectedId=null;
  mobileTab("folders");
  render();
};
$("#allFilter").onclick=()=>{currentFolder="all";render()};
$("#addBtn").onclick=addItem;$("#saveBtn").onclick=exportVault;$("#lockBtn").onclick=()=>{if((dirty||vault?.items.some(i=>i.isDraft))&&!confirm("尚未匯出最新修改，仍要鎖定嗎？"))return;lockApp()};
$$(".mobile-tabbar button").forEach(b=>b.onclick=()=>mobileTab(b.dataset.tab));
$("#modal").onclick=e=>{if(e.target===$("#modal")){exportPending=null;closeModal()}};
const backgroundLock=createBackgroundLock({lock:lockApp,active:()=>readonlyMode&&!!vault});
document.addEventListener("visibilitychange",()=>{document.hidden?backgroundLock.hide():backgroundLock.resume()});
window.addEventListener("pagehide",()=>backgroundLock.hide());
window.addEventListener("pageshow",()=>backgroundLock.resume());
window.addEventListener("focus",()=>{if(!document.hidden)backgroundLock.resume()});
window.addEventListener("beforeunload",e=>{if((dirty||vault?.items.some(i=>i.isDraft))&&!readonlyMode){e.preventDefault();e.returnValue=""}});
window.closeModal=closeModal;

$("#newVaultBtn").classList.toggle("hidden",readonlyMode);
$("#startupNotice").classList.add("hidden");
