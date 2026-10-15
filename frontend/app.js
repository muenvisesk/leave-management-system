const user = JSON.parse(localStorage.getItem("user") || "null");
if (!user) window.location.href = "index.html";

const roleNames = {
  EMPLOYEE: "พนักงาน",
  SUPERVISOR: "หัวหน้างาน",
  DEPARTMENT_MANAGER: "หัวหน้าแผนก",
  HR: "ฝ่าย HR"
};

const pageTitles = {
  dashboard:"หน้าหลัก",
  leave:"ใบลาของฉัน",
  balance:"วันลาคงเหลือ",
  approval:"รายการรออนุมัติ",
  notifications:"การแจ้งเตือน",
  history:"ประวัติการลา",
  status:"ติดตามสถานะการลา",
  hr:"HR Dashboard",
  profile:"โปรไฟล์"
};

document.addEventListener("DOMContentLoaded", async () => {
  setupUser();
  setupNav();
  setupQuickMenu();
  document.getElementById("approvalDecisionForm").addEventListener("submit", submitApproval);
  document.getElementById("cancelLeaveForm").addEventListener("submit", submitCancelLeave);
  window.addEventListener("resize", () => {
    if (hrDataCache) renderHrChart(getHrFilteredRows());
  });
  if (user.ROLE === "HR") {
    showPage("hr");
  } else {
    await loadDashboard();
    await loadNotifications();
  }
});

function setupUser(){
  const fullName = `${user.FIRST_NAME || ""} ${user.LAST_NAME || ""}`.trim();
  document.getElementById("miniName").textContent = fullName || user.EMPLOYEE_CODE;
  document.getElementById("miniRole").textContent = roleNames[user.ROLE] || user.ROLE;
  document.getElementById("topUser").textContent = fullName || user.EMPLOYEE_CODE;
  document.getElementById("welcomeText").textContent = `สวัสดี, ${user.FIRST_NAME || user.EMPLOYEE_CODE} 👋`;
  document.getElementById("profileName").textContent = fullName || user.EMPLOYEE_CODE;
  document.getElementById("profileRole").textContent = roleNames[user.ROLE] || user.ROLE;
  document.getElementById("notificationButton").hidden = user.ROLE === "HR";

  const url = localStorage.getItem("profileImageUrl");
  if(url) setAvatar(url);
  else setInitialAvatar();
}

function setInitialAvatar(){
  const initial = (user.FIRST_NAME || user.EMPLOYEE_CODE || "U").charAt(0).toUpperCase();
  document.getElementById("miniAvatar").textContent = initial;
  document.getElementById("profileAvatar").textContent = initial;
}
function setAvatar(url){
  document.getElementById("miniAvatar").innerHTML = `<img src="${escapeAttr(url)}" onerror="this.parentElement.textContent='U'">`;
  document.getElementById("profileAvatar").innerHTML = `<img src="${escapeAttr(url)}" onerror="this.parentElement.textContent='U'">`;
  document.getElementById("imageUrl").value = url;
}
function escapeAttr(s){ return String(s).replace(/"/g,"&quot;"); }
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function setupNav(){
  const nav = document.getElementById("nav");
  let html = "";
  if(user.ROLE !== "HR"){
    html += `
      <button onclick="showPage('dashboard')">🏠 <span>หน้าหลัก</span></button>
      <button onclick="showPage('notifications')">🔔 <span>แจ้งเตือน</span></button>
    `;
  }
  html += `<button onclick="showPage('status')">🔎 <span>ติดตามสถานะ</span></button>`;
  if(user.ROLE === "EMPLOYEE"){
    html += `
      <button onclick="showPage('leave')">📝 <span>ใบลาของฉัน</span></button>
      <button onclick="showPage('balance')">📅 <span>วันลาคงเหลือ</span></button>
    `;
  }
  if(user.ROLE === "SUPERVISOR" || user.ROLE === "DEPARTMENT_MANAGER"){
    html += `<button onclick="showPage('approval')">✅ <span>อนุมัติการลา</span></button>`;
  }
  if(user.ROLE === "HR"){
    html += `<button onclick="showPage('hr')">📊 <span>HR Dashboard</span></button>`;
  }
  nav.innerHTML = html;
}

function setupQuickMenu(){
  const q = document.getElementById("quickMenu");
  if(user.ROLE === "EMPLOYEE"){
    q.innerHTML = `
      <button onclick="openLeaveModal()">📝 ยื่นใบลา</button>
      <button onclick="showPage('balance')">📅 ตรวจสอบวันลาคงเหลือ</button>
      <button onclick="showPage('status')">🔎 ติดตามสถานะใบลา</button>`;
  } else if(user.ROLE === "SUPERVISOR" || user.ROLE === "DEPARTMENT_MANAGER"){
    q.innerHTML = `<button onclick="showPage('approval')">✅ ตรวจสอบใบลารออนุมัติ</button><button onclick="showPage('notifications')">🔔 ดูการแจ้งเตือน</button>`;
  } else {
    q.innerHTML = `<button onclick="showPage('hr')">📊 ดู Dashboard</button>`;
  }
}

function normalizeLeaveText(value){
  const misspelled = "\u0e25\u0e32\u0e1e\u0e31\u0e01\u0e23\u0e49\u0e2d";
  const corrected = "\u0e25\u0e32\u0e1e\u0e31\u0e01\u0e23\u0e49\u0e2d\u0e19";
  return typeof value === "string" && value === misspelled ? corrected : value;
}

function normalizeLeaveData(value){
  if (Array.isArray(value)) return value.map(normalizeLeaveData);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeLeaveData(item)]));
  }
  return normalizeLeaveText(value);
}

async function api(url, options){
  const res = await fetch(url, options);
  const data = await res.json();
  if(!res.ok) throw new Error(data.message || "เกิดข้อผิดพลาด");
  return normalizeLeaveData(data);
}

function showPage(page){
  if((page === "leave" || page === "balance") && user.ROLE !== "EMPLOYEE") return;
  if(page === "history" && user.ROLE !== "EMPLOYEE") return;

  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  const el = document.getElementById(page === "dashboard" ? "dashboardPage" : page + "Page");
  if(el) el.classList.add("active");

  document.querySelectorAll(".nav button").forEach(b=>b.classList.remove("active"));
  const buttons = document.querySelectorAll(".nav button");
  buttons.forEach(b=>{
    if(b.textContent.includes(pageTitles[page])) b.classList.add("active");
  });
  document.getElementById("topTitle").textContent = pageTitles[page] || "ระบบจัดการการลา";

  if(page==="leave" || page==="history") loadLeaves();
  if(page==="balance") loadBalances();
  if(page==="status") loadStatus();
  if(page==="approval") loadApprovals();
  if(page==="notifications") loadNotifications();
  if(page==="hr") loadHR();
}

async function loadDashboard(){
  try{
    const data = await api(`/api/dashboard/${user.EMPLOYEE_ID}`);
    const isManager = user.ROLE === "SUPERVISOR" || user.ROLE === "DEPARTMENT_MANAGER";
    document.querySelector("#dashboardPage .grid-2 .card .card-title").textContent =
      isManager ? "รายการลาล่าสุดของพนักงาน" : "รายการลาล่าสุด";
    document.getElementById("stats").innerHTML = `
      <div class="stat"><div><div class="stat-label">${isManager ? "ใบลาของพนักงาน" : "ใบลาทั้งหมด"}</div><div class="stat-value">${data.stats.total}</div></div><div class="stat-icon">📄</div></div>
      <div class="stat"><div><div class="stat-label">${isManager ? "รออนุมัติจากคุณ" : "รออนุมัติ"}</div><div class="stat-value">${data.stats.pending}</div></div><div class="stat-icon">⏳</div></div>
      <div class="stat"><div><div class="stat-label">อนุมัติแล้ว</div><div class="stat-value">${data.stats.approved}</div></div><div class="stat-icon">✓</div></div>
      <div class="stat"><div><div class="stat-label">${isManager ? "พนักงานในความดูแล" : "วันลาคงเหลือ"}</div><div class="stat-value">${isManager ? data.stats.employeeCount : data.stats.remainingDays}</div></div><div class="stat-icon">${isManager ? "👥" : "📅"}</div></div>`;
    renderRecent(data.recent, isManager);
  }catch(err){ toast(err.message); }
}

function statusBadge(status){
  const map = {
    APPROVED:["approved","อนุมัติแล้ว"],
    REJECTED:["rejected","ไม่อนุมัติ"],
    CANCELLED:["cancelled","ยกเลิก"],
    PENDING_SUPERVISOR:["pending","รอหัวหน้างาน"],
    PENDING_DEPARTMENT_MANAGER:["manager","รอหัวหน้าแผนก"]
  };
  const [cls,label] = map[status] || ["pending",status];
  return `<span class="status ${cls}">${label}</span>`;
}
function fmtDate(v){
  if(!v) return "-";
  return new Date(v).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"});
}
function renderRecent(rows, isManager = false){
  if(!rows.length){document.getElementById("recentTable").innerHTML="<div class='notice'>ยังไม่มีรายการลา</div>";return;}
  const headers = isManager
    ? "<th>เลขที่</th><th>พนักงาน</th><th>ประเภท</th><th>วันที่ลา</th><th>สถานะ</th>"
    : "<th>เลขที่</th><th>ประเภท</th><th>วันที่</th><th>สถานะ</th>";
  document.getElementById("recentTable").innerHTML = `<table><thead><tr>${headers}</tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${escapeHtml(r.REQUEST_NO)}</td>${isManager ? `<td>${escapeHtml(r.EMPLOYEE_CODE)} ${escapeHtml(`${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim())}</td>` : ""}<td>${escapeHtml(r.LEAVE_TYPE_NAME)}</td><td>${fmtDate(r.START_DATE)}${isManager && r.END_DATE && String(r.END_DATE)!==String(r.START_DATE) ? " - " + fmtDate(r.END_DATE) : ""}</td><td>${statusBadge(r.STATUS)}</td></tr>`).join("")}
  </tbody></table>`;
}

function statusLabel(status){
  const map = {
    PENDING_SUPERVISOR: ["รอหัวหน้างาน", "pending"],
    PENDING_DEPARTMENT_MANAGER: ["รอหัวหน้าแผนก", "manager"],
    APPROVED: ["อนุมัติแล้ว", "approved"],
    REJECTED: ["ไม่อนุมัติ", "rejected"],
    CANCELLED: ["ยกเลิกแล้ว", "cancelled"]
  };
  return map[status] || [status || "-", "pending"];
}

function statusStepState(status, step){
  if(status === "APPROVED") return "done";
  if(status === "REJECTED" || status === "CANCELLED") return step === 1 ? "bad" : "muted";
  if(status === "PENDING_SUPERVISOR") {
    if(step === 1) return "done";
    if(step === 2) return "current";
    return "muted";
  }
  if(status === "PENDING_DEPARTMENT_MANAGER") {
    if(step === 1 || step === 2) return "done";
    if(step === 3) return "current";
    return "muted";
  }
  return "muted";
}

function statusStepText(status, step){
  if(status === "APPROVED") return "ดำเนินการเรียบร้อยแล้ว";
  if(status === "REJECTED") return step === 1 ? "ใบลาถูกไม่อนุมัติ" : "ไม่ดำเนินการ";
  if(status === "CANCELLED") return step === 1 ? "ยกเลิกใบลาแล้ว" : "ไม่ดำเนินการ";
  if(status === "PENDING_SUPERVISOR") {
    return step === 1 ? "ยื่นใบลาแล้ว" : "รอดำเนินการ";
  }
  if(status === "PENDING_DEPARTMENT_MANAGER") {
    if(step <= 2) return "อนุมัติแล้ว";
    if(step === 3) return "กำลังรอการตรวจสอบ";
    return "รอดำเนินการ";
  }
  return "รอดำเนินการ";
}

function renderStatusCard(r){
  const [label, cls] = statusLabel(r.STATUS);
  const employeeName = `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim();
  const steps = [
    ["1", "ยื่นใบลา"],
    ["2", "หัวหน้างาน"],
    ["3", "หัวหน้าแผนก"],
    ["4", "เสร็จสิ้น"]
  ];
  return `
    <div class="status-card status-${String(r.STATUS || "").toLowerCase()}">
      <div class="status-card-head">
        <div>
          <div class="status-request-no">${r.REQUEST_NO || "-"}</div>
          ${user.ROLE !== "EMPLOYEE" ? `<div class="status-meta">${r.EMPLOYEE_CODE || ""} ${employeeName}</div>` : ""}
          <div class="status-meta">${r.LEAVE_TYPE_NAME || "-"} • ${fmtDate(r.START_DATE)}${r.END_DATE && String(r.END_DATE)!==String(r.START_DATE) ? " - " + fmtDate(r.END_DATE) : ""} • ${r.LEAVE_DAYS || 0} วัน</div>
          ${r.REASON ? `<div class="status-meta"><strong>หมายเหตุ:</strong> ${escapeHtml(r.REASON)}</div>` : ""}
        </div>
        <span class="status ${cls}">${label}</span>
      </div>
      <div class="status-line"></div>
      <div class="status-steps">
        ${steps.map(([num,title],i)=>{
          const step=i+1, state=statusStepState(r.STATUS,step);
          return `<div class="status-step ${state}">
            <div class="status-circle">${num}</div>
            <div><div class="status-step-title">${title}</div><div class="status-step-text">${statusStepText(r.STATUS,step)}</div></div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

async function loadStatus(){
  const loading=document.getElementById("statusLoading");
  const empty=document.getElementById("statusEmpty");
  const list=document.getElementById("statusList");
  if(!loading || !empty || !list) return;
  const isEmployee = user.ROLE === "EMPLOYEE";
  document.querySelector("#statusPage .page-sub").textContent = isEmployee
    ? "ตรวจสอบขั้นตอนการอนุมัติใบลาของคุณ"
    : "ติดตามขั้นตอนใบลาของพนักงานในขอบเขตที่รับผิดชอบ";
  empty.textContent = isEmployee
    ? "ยังไม่มีรายการลา"
    : "ยังไม่มีรายการใบลาของพนักงานในขอบเขตที่รับผิดชอบ";
  loading.style.display="block";
  empty.style.display="none";
  list.innerHTML="";
  try{
    const rows=await api(`/api/leave/status?viewer_id=${encodeURIComponent(user.EMPLOYEE_ID)}`);
    loading.style.display="none";
    if(!rows.length){ empty.style.display="block"; return; }
    list.innerHTML=rows.map(renderStatusCard).join("");
  }catch(err){
    loading.style.display="none";
    list.innerHTML=`<div class="notice">ไม่สามารถโหลดสถานะการลาได้<br><small>${err.message}</small></div>`;
  }
}

async function loadLeaves(){
  try{
    const rows = await api(`/api/leave-requests/${user.EMPLOYEE_ID}`);
    const html = rows.length ? `<table><thead><tr><th>เลขที่</th><th>ประเภท</th><th>วันที่</th><th>วัน</th><th>หมายเหตุ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.REQUEST_NO}</td><td>${r.LEAVE_TYPE_NAME}</td><td>${fmtDate(r.START_DATE)} - ${fmtDate(r.END_DATE)}</td><td>${r.LEAVE_DAYS}</td><td>${r.REASON ? escapeHtml(r.REASON) : "-"}</td><td>${statusBadge(r.STATUS)}</td><td>${String(r.STATUS).startsWith("PENDING") ? `<button class="btn btn-red" onclick="cancelLeave(${r.LEAVE_REQUEST_ID})">ยกเลิก</button>` : "-"}</td></tr>`).join("")}
    </tbody></table>` : "<div class='notice'>ยังไม่มีรายการลา</div>";
    document.getElementById("leaveTable").innerHTML = html;
    document.getElementById("historyTable").innerHTML = html.replace(/<th>จัดการ<\/th>/,"").replace(/<td>\$\{.*?<\/td>/g,"");
  }catch(err){toast(err.message)}
}

async function loadBalances(){
  try{
    const rows = await api(`/api/balances/${user.EMPLOYEE_ID}`);
    const el = document.getElementById("balanceTable");
    if (!rows.length) {
      el.innerHTML = "<div class='notice'>ยังไม่มีข้อมูลวันลาคงเหลือในปีปัจจุบัน</div>";
      return;
    }
    el.innerHTML = `<table><thead><tr><th>ประเภทการลา</th><th>สิทธิ์ทั้งหมด</th><th>ใช้ไป</th><th>คงเหลือ</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.LEAVE_TYPE_NAME}</td><td>${r.ENTITLED_DAYS}</td><td>${r.USED_DAYS}</td><td><strong>${r.REMAINING_DAYS}</strong></td></tr>`).join("")}
    </tbody></table>`;
  }catch(err){toast(err.message)}
}

async function loadApprovals(){
  try{
    const rows = await api(`/api/approvals/${user.EMPLOYEE_ID}`);
    document.getElementById("approvalTable").innerHTML = rows.length ? `<table><thead><tr><th>เลขที่</th><th>พนักงาน</th><th>ประเภท</th><th>วันที่</th><th>วัน</th><th>หมายเหตุ</th><th>เอกสาร</th><th>จัดการ</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td>${r.REQUEST_NO}</td><td>${r.EMPLOYEE_CODE} ${r.FIRST_NAME} ${r.LAST_NAME}</td><td>${r.LEAVE_TYPE_NAME}</td><td>${fmtDate(r.START_DATE)} - ${fmtDate(r.END_DATE)}</td><td>${r.LEAVE_DAYS}</td><td>${r.REASON ? escapeHtml(r.REASON) : "-"}</td><td>${Number(r.DOCUMENT_COUNT) ? `<button class="btn btn-gray" onclick="openApprovalDocuments(${r.LEAVE_REQUEST_ID})">ดู ${r.DOCUMENT_COUNT} ไฟล์</button>` : "-"}</td><td><button class="btn btn-green" onclick="approve(${r.LEAVE_REQUEST_ID},'APPROVED')">อนุมัติ</button> <button class="btn btn-red" onclick="approve(${r.LEAVE_REQUEST_ID},'REJECTED')">ไม่อนุมัติ</button></td></tr>`).join("")}
    </tbody></table>` : "<div class='notice'>ไม่มีใบลาที่รอดำเนินการ</div>";
  }catch(err){toast(err.message)}
}

async function openApprovalDocuments(requestId){
  try{
    const documents = await api(`/api/approvals/${requestId}/documents?approverId=${encodeURIComponent(user.EMPLOYEE_ID)}`);
    const list = document.getElementById("approvalDocumentsList");
    list.replaceChildren();
    if(!documents.length){
      list.textContent = "ไม่มีเอกสารแนบ";
    }else{
      documents.forEach(file=>{
        const link = document.createElement("a");
        link.href = `/api/approvals/${requestId}/documents/${file.DOCUMENT_ID}?approverId=${encodeURIComponent(user.EMPLOYEE_ID)}`;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = file.FILE_NAME;
        list.appendChild(link);
      });
    }
    document.getElementById("documentsModal").classList.add("open");
  }catch(err){toast(err.message)}
}

let pendingApproval = null;

function approve(requestId, action){
  if(action !== "APPROVED" && action !== "REJECTED") return;
  pendingApproval = { requestId, action };
  const isRejection = action === "REJECTED";
  document.getElementById("approvalDecisionTitle").textContent =
    isRejection ? "ไม่อนุมัติใบลา" : "อนุมัติใบลา";
  document.getElementById("approvalCommentLabel").textContent =
    isRejection ? "เหตุผลที่ไม่อนุมัติ" : "หมายเหตุ (ถ้ามี)";
  const commentField = document.getElementById("approvalComment");
  commentField.value = "";
  commentField.required = isRejection;
  document.getElementById("approvalDecisionModal").classList.add("open");
  commentField.focus();
}

async function submitApproval(event){
  event.preventDefault();
  if(!pendingApproval) return;
  const { requestId, action } = pendingApproval;
  const comment = document.getElementById("approvalComment").value.trim();
  const submitButton = document.getElementById("approvalDecisionSubmit");
  submitButton.disabled = true;
  try{
    await api(`/api/approvals/${requestId}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({approverId:user.EMPLOYEE_ID,action,comment})
    });
    closeModal("approvalDecisionModal");
    pendingApproval = null;
    toast("บันทึกผลเรียบร้อย");
    await Promise.all([loadApprovals(), loadDashboard(), loadNotifications()]);
  }catch(err){toast(err.message)}
  finally{submitButton.disabled = false}
}

async function loadNotifications(){
  try{
    const rows = await api(`/api/notifications/${user.EMPLOYEE_ID}`);
    const unread = rows.filter(r=>r.IS_READ==="N").length;
    document.getElementById("unreadBadge").textContent = unread;
    document.getElementById("notificationList").innerHTML = rows.length ? rows.map(r=>`
      <div class="notification ${r.IS_READ==="N"?"unread":""}">
        <div class="avatar">🔔</div>
        <div style="flex:1"><h4>${r.TITLE}</h4><p>${r.MESSAGE_TEXT}</p><small>${fmtDate(r.CREATED_AT)}</small></div>
        ${r.IS_READ==="N"?`<button class="btn btn-blue" onclick="markRead(${r.NOTIFICATION_ID})">อ่าน</button>`:"<span class='status approved'>อ่านแล้ว</span>"}
      </div>`).join("") : "<div class='notice'>ไม่มีการแจ้งเตือน</div>";
  }catch(err){toast(err.message)}
}

async function markRead(id){
  try{await api(`/api/notifications/${id}/read`,{method:"PATCH"});loadNotifications()}catch(err){toast(err.message)}
}
async function markAllRead(){
  try{
    const rows = await api(`/api/notifications/${user.EMPLOYEE_ID}`);
    for(const r of rows) if(r.IS_READ==="N") await markRead(r.NOTIFICATION_ID);
    loadNotifications();
  }catch(err){toast(err.message)}
}

async function openLeaveModal(){
  try{
    const types = await api("/api/leave-types");
    document.getElementById("leaveType").innerHTML = types.map(t=>`<option value="${t.LEAVE_TYPE_ID}">${t.LEAVE_TYPE_NAME}</option>`).join("");
    document.getElementById("leaveModal").classList.add("open");
  }catch(err){toast(err.message)}
}
function closeModal(id){document.getElementById(id).classList.remove("open")}

let selectedLeaveFiles = [];
const maxLeaveFiles = 5;
const maxLeaveFileSize = 10 * 1024 * 1024;

function toggleAttachmentMenu(){
  const menu = document.getElementById("attachmentMenu");
  const button = document.getElementById("attachmentAddButton");
  menu.hidden = !menu.hidden;
  button.setAttribute("aria-expanded", String(!menu.hidden));
}

function chooseAttachmentSource(inputId){
  document.getElementById("attachmentMenu").hidden = true;
  document.getElementById("attachmentAddButton").setAttribute("aria-expanded", "false");
  document.getElementById(inputId).click();
}

function renderLeaveAttachments(){
  const list = document.getElementById("attachmentList");
  list.replaceChildren();
  selectedLeaveFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "attachment-item";
    const name = document.createElement("span");
    name.textContent = `${file.name} (${Math.max(1, Math.ceil(file.size / 1024))} KB)`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "attachment-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `นำ ${file.name} ออก`);
    remove.addEventListener("click", () => {
      selectedLeaveFiles.splice(index, 1);
      renderLeaveAttachments();
    });
    item.append(name, remove);
    list.appendChild(item);
  });
}

function addLeaveAttachments(event){
  for(const file of Array.from(event.target.files || [])){
    if(file.size > maxLeaveFileSize){
      toast(`${file.name} มีขนาดเกิน 10 MB`);
      continue;
    }
    if(selectedLeaveFiles.length >= maxLeaveFiles){
      toast("แนบไฟล์ได้ไม่เกิน 5 ไฟล์");
      break;
    }
    const alreadySelected = selectedLeaveFiles.some(selected =>
      selected.name === file.name && selected.size === file.size && selected.lastModified === file.lastModified
    );
    if(!alreadySelected) selectedLeaveFiles.push(file);
  }
  event.target.value = "";
  renderLeaveAttachments();
}

["photoInput", "fileInput", "cameraInput"].forEach(id => {
  document.getElementById(id).addEventListener("change", addLeaveAttachments);
});

document.getElementById("leaveForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const submitButton = e.submitter || document.querySelector("#leaveForm button[type='submit']");
  const submitLabel = submitButton.textContent;
  submitButton.disabled = true;
  submitButton.textContent = "กำลังส่ง...";
  try{
    const formData = new FormData();
    const fields = {
      employeeId: user.EMPLOYEE_ID,
      leaveTypeId: document.getElementById("leaveType").value,
      startDate: document.getElementById("startDate").value,
      endDate: document.getElementById("endDate").value,
      startTime: document.getElementById("startTime").value,
      endTime: document.getElementById("endTime").value,
      leaveDays: document.getElementById("leaveDays").value,
      reason: document.getElementById("reason").value
    };
    Object.entries(fields).forEach(([name, value]) => formData.append(name, value));
    selectedLeaveFiles.forEach(file => formData.append("documents", file, file.name));

    const data = await api("/api/leave-requests",{
      method:"POST",
      body:formData
    });
    closeModal("leaveModal");
    document.getElementById("leaveForm").reset();
    selectedLeaveFiles = [];
    renderLeaveAttachments();
    toast(`ส่งใบลา ${data.requestNo} สำเร็จ`);
    loadDashboard();
    loadLeaves();
  }catch(err){toast(err.message)}
  finally{
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
  }
});

let pendingCancellationId = null;

function cancelLeave(id){
  pendingCancellationId = id;
  document.getElementById("cancelLeaveReason").value = "ขอยกเลิกการลา";
  document.getElementById("cancelLeaveModal").classList.add("open");
  document.getElementById("cancelLeaveReason").focus();
}

async function submitCancelLeave(event){
  event.preventDefault();
  if(!pendingCancellationId) return;
  const requestId = pendingCancellationId;
  const reason = document.getElementById("cancelLeaveReason").value.trim() || "ขอยกเลิกการลา";
  const submitButton = document.getElementById("cancelLeaveSubmit");
  submitButton.disabled = true;
  try{
    await api(`/api/leave-requests/${requestId}/cancel`,{
      method:"PATCH",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({employeeId:user.EMPLOYEE_ID,reason})
    });
    closeModal("cancelLeaveModal");
    pendingCancellationId = null;
    toast("ยกเลิกใบลาแล้ว");
    await Promise.all([loadLeaves(), loadDashboard(), loadStatus()]);
  }catch(err){toast(err.message)}
  finally{submitButton.disabled = false}
}

let hrDataCache = null;
let hrFilters = { department: "ALL", employee: "ALL" };

function getHrFilteredRows() {
  if (!hrDataCache) return [];
  let rows = [...hrDataCache.rows];

  if (hrFilters.department !== "ALL") {
    rows = rows.filter(row => Number(row.DEPARTMENT_ID) === Number(hrFilters.department));
  }

  if (hrFilters.employee !== "ALL") {
    rows = rows.filter(row => Number(row.EMPLOYEE_ID) === Number(hrFilters.employee));
  }

  return rows;
}

function getHrFilteredBalances() {
  if (!hrDataCache) return [];
  let rows = [...hrDataCache.balances];

  if (hrFilters.department !== "ALL") {
    rows = rows.filter(row => Number(row.DEPARTMENT_ID) === Number(hrFilters.department));
  }

  if (hrFilters.employee !== "ALL") {
    rows = rows.filter(row => Number(row.EMPLOYEE_ID) === Number(hrFilters.employee));
  }

  return rows;
}

function populateHrFilters() {
  const employeeSelect = document.getElementById("hrEmployeeFilter");
  if (!employeeSelect || !hrDataCache) return;

  const employees = [...hrDataCache.employees].sort((a, b) => {
    const nameA = `${a.FIRST_NAME || ""} ${a.LAST_NAME || ""}`.trim();
    const nameB = `${b.FIRST_NAME || ""} ${b.LAST_NAME || ""}`.trim();
    return nameA.localeCompare(nameB, "th");
  });

  const employeeOptions = ["<option value='ALL'>ทั้งหมด</option>"];
  employees.forEach(emp => {
    employeeOptions.push(`<option value="${emp.EMPLOYEE_ID}">${emp.EMPLOYEE_CODE} - ${emp.FIRST_NAME || ""} ${emp.LAST_NAME || ""}</option>`);
  });
  employeeSelect.innerHTML = employeeOptions.join("");
  employeeSelect.value = hrFilters.employee;
}

function exportHrCsv(rows, filename = "hr_leave_report.csv") {
  const header = ["เลขที่ใบลา", "พนักงาน", "แผนก", "ประเภท", "วันที่เริ่ม", "วันที่สิ้นสุด", "จำนวนวัน", "สถานะ"];
  const csvRows = rows.map(row => {
    const employee = `${row.EMPLOYEE_CODE || ""} ${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim();
    const dep = row.DEPARTMENT_ID ?? "-";
    return [
      row.REQUEST_NO || "",
      employee,
      dep,
      row.LEAVE_TYPE_NAME || "",
      row.START_DATE ? new Date(row.START_DATE).toISOString().slice(0, 10) : "",
      row.END_DATE ? new Date(row.END_DATE).toISOString().slice(0, 10) : "",
      row.LEAVE_DAYS || 0,
      row.STATUS || ""
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });

  const csv = [header.join(","), ...csvRows].join("\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function exportHrExcel(){
  const params = new URLSearchParams({
    department: hrFilters.department,
    employee: hrFilters.employee
  });
  try{
    const response = await fetch(`/api/hr/export?${params}`);
    if(!response.ok){
      const error = await response.json();
      throw new Error(error.message || "ส่งออกไฟล์ Excel ไม่สำเร็จ");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hr_leave_report.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }catch(err){
    toast(err.message);
  }
}

function exportHrBalancesCsv(rows) {
  const header = ["รหัสพนักงาน", "พนักงาน", "แผนก", "ปี", "ประเภทการลา", "สิทธิ์ทั้งหมด", "ใช้ไป", "คงเหลือ"];
  const csvRows = rows.map(row => {
    const employee = `${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim();
    return [
      row.EMPLOYEE_CODE || "",
      employee,
      row.DEPARTMENT_ID ?? "-",
      row.LEAVE_YEAR || "",
      row.LEAVE_TYPE_NAME || "",
      row.ENTITLED_DAYS ?? 0,
      row.USED_DAYS ?? 0,
      row.REMAINING_DAYS ?? 0
    ].map(value => `"${String(value).replace(/"/g, '""')}"`).join(",");
  });

  const blob = new Blob(["\uFEFF", [header.join(","), ...csvRows].join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "hr_leave_balances.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

function renderHrChart(rows) {
  const canvas = document.getElementById("hrLeaveChart");
  if (!canvas || canvas.clientWidth === 0) return;

  const typeSummary = rows.reduce((acc, row) => {
    const key = normalizeLeaveText(row.LEAVE_TYPE_NAME) || "ไม่ระบุ";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const entries = Object.entries(typeSummary).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"));
  const width = canvas.clientWidth;
  const height = Math.max(250, entries.length * 58 + 92);
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdf8";
  ctx.fillRect(0, 0, width, height);

  if (!entries.length) {
    ctx.fillStyle = "#58677d";
    ctx.font = '14px Arial, "Noto Sans Thai", sans-serif';
    ctx.textAlign = "center";
    ctx.fillText("ไม่มีข้อมูลสำหรับแผนภูมิ", width / 2, height / 2);
    return;
  }

  const maxValue = Math.max(...entries.map(([, count]) => count), 1);
  const axisMax = Math.max(4, Math.ceil(maxValue / 4) * 4);
  const left = width < 480 ? 94 : 142;
  const right = 42;
  const top = 32;
  const bottom = 32;
  const chartWidth = Math.max(40, width - left - right);
  const rowHeight = (height - top - bottom) / entries.length;
  const colors = ["#806044", "#a17b54", "#b58f66", "#8c7258", "#c0a17a", "#6f5a48"];

  ctx.font = '11px Arial, "Noto Sans Thai", sans-serif';
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  for (let tick = 0; tick <= 4; tick++) {
    const x = left + chartWidth * tick / 4;
    ctx.strokeStyle = tick === 0 ? "#ddcfbd" : "#eee7dc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, top - 8);
    ctx.lineTo(x, height - bottom + 2);
    ctx.stroke();
    ctx.fillStyle = "#9a8976";
    ctx.fillText(String(Math.round(axisMax * tick / 4)), x, height - 13);
  }

  entries.forEach(([label, count], index) => {
    const centerY = top + rowHeight * (index + 0.5);
    const barHeight = Math.min(24, rowHeight * 0.52);
    const barWidth = chartWidth * count / axisMax;
    const color = colors[index % colors.length];

    ctx.textAlign = "right";
    ctx.fillStyle = "#514234";
    ctx.font = '12px Arial, "Noto Sans Thai", sans-serif';
    ctx.fillText(label, left - 12, centerY);

    ctx.fillStyle = "#f0e9df";
    drawRoundedRect(ctx, left, centerY - barHeight / 2, chartWidth, barHeight, barHeight / 2);
    const gradient = ctx.createLinearGradient(left, 0, left + Math.max(barWidth, 1), 0);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, `${color}cc`);
    ctx.fillStyle = gradient;
    drawRoundedRect(ctx, left, centerY - barHeight / 2, Math.max(barWidth, 4), barHeight, barHeight / 2);

    ctx.textAlign = "left";
    ctx.fillStyle = "#514234";
    ctx.font = 'bold 12px Arial, "Noto Sans Thai", sans-serif';
    ctx.fillText(String(count), left + barWidth + 9, centerY);
  });
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, safeRadius);
  ctx.fill();
}

async function loadHR(){
  try{
    const [s, rows, employees, balances] = await Promise.all([
      api("/api/hr/summary"),
      api("/api/hr/requests"),
      api("/api/hr/employees"),
      api("/api/hr/balances")
    ]);

    hrDataCache = { summary: s, rows, employees, balances };
    populateHrFilters();

    const render = () => {
      const filteredRows = getHrFilteredRows();
      const pending = filteredRows.filter(r => String(r.STATUS).startsWith("PENDING")).length;
      const approved = filteredRows.filter(r => r.STATUS === "APPROVED").length;
      const rejected = filteredRows.filter(r => r.STATUS === "REJECTED").length;
      const cancelled = filteredRows.filter(r => r.STATUS === "CANCELLED").length;
      const total = filteredRows.length || 1;

      const typeSummary = filteredRows.reduce((acc, row) => {
        const key = row.LEAVE_TYPE_NAME || "ไม่ระบุ";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      const monthSummary = filteredRows.reduce((acc, row) => {
        const date = new Date(row.START_DATE);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      const peakMonth = Object.entries(monthSummary).sort((a, b) => b[1] - a[1])[0];
      const peakMonthText = peakMonth ? `${peakMonth[0]} (${peakMonth[1]} รายการ)` : "ไม่มีข้อมูล";

      document.getElementById("hrStats").innerHTML = `
        <div class="stat"><div><div class="stat-label">พนักงาน</div><div class="stat-value">${filteredRows.length ? new Set(filteredRows.map(r => r.EMPLOYEE_ID)).size : 0}</div></div><div class="stat-icon">👥</div></div>
        <div class="stat"><div><div class="stat-label">รออนุมัติ</div><div class="stat-value">${pending}</div></div><div class="stat-icon">⏳</div></div>
        <div class="stat"><div><div class="stat-label">อนุมัติแล้ว</div><div class="stat-value">${approved}</div></div><div class="stat-icon">✓</div></div>
        <div class="stat"><div><div class="stat-label">ไม่อนุมัติ</div><div class="stat-value">${rejected}</div></div><div class="stat-icon">✕</div></div>`;

      document.getElementById("hrSummaryPanel").innerHTML = `
        <div class="hr-summary-grid">
          <div class="mini-stat blue"><span>ใบลารอบตัวกรอง</span><strong>${filteredRows.length}</strong></div>
          <div class="mini-stat orange"><span>รออนุมัติ</span><strong>${pending}</strong></div>
          <div class="mini-stat green"><span>อนุมัติแล้ว</span><strong>${approved}</strong></div>
          <div class="mini-stat red"><span>ถูกปฏิเสธ</span><strong>${rejected}</strong></div>
        </div>
        <div class="hr-note">
          <div>• อัตราการอนุมัติ: ${(approved / total * 100).toFixed(0)}% ของใบลาทั้งหมด</div>
          <div>• ใบลาที่ต้องติดตาม: ${pending} รายการ</div>
          <div>• ยกเลิก: ${cancelled} รายการ</div>
        </div>
      `;

      const breakdown = [
        { label: "รออนุมัติ", value: pending, color: "#f59e0b" },
        { label: "อนุมัติแล้ว", value: approved, color: "#22c55e" },
        { label: "ไม่อนุมัติ", value: rejected, color: "#ef4444" },
        { label: "ยกเลิก", value: cancelled, color: "#6b7280" }
      ];

      document.getElementById("hrStatusBreakdown").innerHTML = breakdown.map(item => {
        const pct = total ? Math.max((item.value / total) * 100, 0) : 0;
        return `
          <div class="breakdown-item">
            <div class="breakdown-row"><span>${item.label}</span><strong>${item.value}</strong></div>
            <div class="breakdown-bar"><div style="width:${pct}%;background:${item.color}"></div></div>
          </div>
        `;
      }).join("");

      const auditRows = [
        { title: "ประวัติการลาทั้งหมด", value: `${filteredRows.length} รายการ` },
        { title: "รอบตรวจสอบล่าสุด", value: peakMonthText },
        { title: "ประเภทการลาที่ใช้มากที่สุด", value: Object.entries(typeSummary).sort((a, b) => b[1] - a[1])[0]?.[0] || "ไม่มีข้อมูล" }
      ];

      document.getElementById("hrAuditPanel").innerHTML = `
        <div class="audit-list">
          ${auditRows.map(item => `
            <div class="audit-item">
              <div class="audit-title">${item.title}</div>
              <div class="audit-value">${item.value}</div>
            </div>
          `).join("")}
        </div>
      `;

      const typeLabels = Object.entries(typeSummary).map(([name, count]) => `
        <div class="mini-chip">
          <span>${name}</span>
          <strong>${count}</strong>
        </div>
      `).join("");

      document.getElementById("hrReportPanel").innerHTML = `
        <div class="report-stack">
          <div class="report-block">
            <div class="report-label">จำนวนการลาแยกตามประเภท</div>
            <div class="report-content">${typeLabels || "ไม่มีข้อมูล"}</div>
          </div>
          <div class="report-block">
            <div class="report-label">ช่วงเวลาที่มีการลามากที่สุด</div>
            <div class="report-content">${peakMonthText}</div>
          </div>
        </div>
      `;

      const filteredBalances = getHrFilteredBalances();
      const anomalyRows = filteredRows.map(row => {
        const balance = filteredBalances.find(item =>
          Number(item.EMPLOYEE_ID) === Number(row.EMPLOYEE_ID) &&
          normalizeLeaveText(item.LEAVE_TYPE_NAME) === normalizeLeaveText(row.LEAVE_TYPE_NAME)
        );
        const days = Number(row.LEAVE_DAYS);
        const leaveType = normalizeLeaveText(row.LEAVE_TYPE_NAME || "");
        const reasons = [];

        if (leaveType.includes("ลาป่วย") && days > 3) {
          reasons.push(`ยื่น ${days} วัน เกินเกณฑ์ตรวจสอบ 3 วันสำหรับลาป่วย`);
        }
        if (balance && days > Number(balance.ENTITLED_DAYS)) {
          reasons.push(`ยื่น ${days} วัน เกินสิทธิ์รายปี ${balance.ENTITLED_DAYS} วันสำหรับ${leaveType}`);
        }
        if (String(row.STATUS).startsWith("PENDING") &&
            balance &&
            days > Number(balance.REMAINING_DAYS)) {
          reasons.push(`ยื่น ${days} วัน เกินวันลาคงเหลือ ${balance.REMAINING_DAYS} วันสำหรับ${leaveType}`);
        }

        return reasons.length ? { ...row, anomalyReasons: reasons } : null;
      }).filter(Boolean);
      document.getElementById("hrAnomalyList").innerHTML = anomalyRows.length
        ? anomalyRows.map(row => {
          const employee = `${row.EMPLOYEE_CODE || ""} ${row.FIRST_NAME || ""} ${row.LAST_NAME || ""}`.trim();
          const days = Number(row.LEAVE_DAYS);
          const rejectionReason = row.REJECTION_REASON
            ? `<div class="hr-anomaly-detail">เหตุผลที่ไม่อนุมัติ: ${escapeHtml(row.REJECTION_REASON)}</div>`
            : "";
          return `
            <article class="hr-anomaly-item">
              <div class="hr-anomaly-heading">
                <strong>${escapeHtml(row.REQUEST_NO || "-")}</strong>
                <span class="hr-anomaly-badge">เกินเกณฑ์ตรวจสอบ</span>
              </div>
              <div class="hr-anomaly-detail">${escapeHtml(employee)} · ${escapeHtml(row.LEAVE_TYPE_NAME)} · ${days} วัน · ${fmtDate(row.START_DATE)} - ${fmtDate(row.END_DATE)}</div>
              <div class="hr-anomaly-detail">เงื่อนไขตรวจสอบ: ${row.anomalyReasons.map(escapeHtml).join(" · ")}</div>
              ${rejectionReason}
              <div class="hr-anomaly-status">สถานะ: ${statusBadge(row.STATUS)}</div>
            </article>
          `;
        }).join("")
        : "<div class='notice'>ไม่พบรายการลาเกินเงื่อนไขสำหรับตัวกรองนี้</div>";

      renderHrChart(filteredRows);
      document.getElementById("hrTable").innerHTML = `<table><thead><tr><th>เลขที่</th><th>พนักงาน</th><th>ประเภท</th><th>วันที่</th><th>หมายเหตุ</th><th>สถานะ</th></tr></thead><tbody>
        ${filteredRows.map(r => `<tr><td>${r.REQUEST_NO}</td><td>${r.EMPLOYEE_CODE} ${r.FIRST_NAME} ${r.LAST_NAME}</td><td>${r.LEAVE_TYPE_NAME}</td><td>${fmtDate(r.START_DATE)} - ${fmtDate(r.END_DATE)}</td><td>${r.REASON ? escapeHtml(r.REASON) : "-"}</td><td>${statusBadge(r.STATUS)}</td></tr>`).join("")}
      </tbody></table>`;

      document.getElementById("hrBalanceTable").innerHTML = filteredBalances.length
        ? `<table><thead><tr><th>พนักงาน</th><th>แผนก</th><th>ประเภทการลา</th><th>สิทธิ์ทั้งหมด</th><th>ใช้ไป</th><th>คงเหลือ</th></tr></thead><tbody>
          ${filteredBalances.map(row => `<tr><td>${row.EMPLOYEE_CODE} ${row.FIRST_NAME} ${row.LAST_NAME}</td><td>${row.DEPARTMENT_ID ?? "-"}</td><td>${row.LEAVE_TYPE_NAME}</td><td>${row.ENTITLED_DAYS}</td><td>${row.USED_DAYS}</td><td><strong>${row.REMAINING_DAYS}</strong></td></tr>`).join("")}
        </tbody></table>`
        : "<div class='notice'>ไม่พบข้อมูลวันลาคงเหลือสำหรับตัวกรองนี้</div>";
    };

    const employeeFilter = document.getElementById("hrEmployeeFilter");

    employeeFilter.addEventListener("change", (e) => {
      hrFilters.employee = e.target.value;
      render();
    });

    document.getElementById("hrExportCsvBtn").addEventListener("click", () => {
      exportHrCsv(getHrFilteredRows(), "hr_leave_report.csv");
    });

    document.getElementById("hrExportExcelBtn").addEventListener("click", () => {
      exportHrExcel();
    });

    document.getElementById("hrBalanceExportBtn").addEventListener("click", () => {
      exportHrBalancesCsv(getHrFilteredBalances());
    });

    render();
  } catch (err) {
    toast(err.message);
  }
}

function saveProfileImage(){
  const url=document.getElementById("imageUrl").value.trim();
  if(!url){toast("กรุณาวาง URL รูปภาพ");return}
  localStorage.setItem("profileImageUrl",url);
  setAvatar(url);
  toast("บันทึกรูปโปรไฟล์แล้ว");
}
function removeProfileImage(){
  localStorage.removeItem("profileImageUrl");
  setInitialAvatar();
  document.getElementById("imageUrl").value="";
  toast("ลบรูปโปรไฟล์แล้ว");
}
function toast(msg){
  let el=document.getElementById("toast");
  if(!el){el=document.createElement("div");el.id="toast";el.style.cssText="position:fixed;right:20px;bottom:20px;background:#172033;color:white;padding:12px 16px;border-radius:8px;font-size:12px;z-index:100";document.body.appendChild(el)}
  el.textContent=msg;el.style.display="block";clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>el.style.display="none",2500);
}
document.getElementById("logoutBtn").onclick=()=>{localStorage.removeItem("user");window.location.href="index.html"};
