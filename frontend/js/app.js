/**
 * CloudDrive 前端 — 对接真实后端 API
 * 后端地址：http://localhost:8000
 */

const API_BASE = window.location.origin;

// ===== App State =====
const state = {
  currentUser:   null,
  token:         localStorage.getItem("cd_token") || null,
  currentPath:   "",      // 当前目录路径字符串，根目录为 ""
  currentView:   "grid",
  currentNav:    "all",
  ctxTarget:     null,
  renameTarget:  null,
  searchQuery:   ""
};

// ===== HTTP 工具 =====

async function http(method, path, body = null, isForm = false) {
  const headers = {};
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;

  const init = { method, headers };

  if (body && !isForm) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  } else if (isForm) {
    init.body = body; // FormData，不设 Content-Type 让浏览器自动加 boundary
  }

  const res = await fetch(API_BASE + path, init);

  if (res.status === 401) {
    logout();
    throw new Error("未登录");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "请求失败" }));
    throw new Error(err.detail || "请求失败");
  }

  // 下载接口直接返回 Response
  if (res.headers.get("Content-Disposition")) return res;

  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

const api = {
  get:    (path)          => http("GET",    path),
  post:   (path, body)    => http("POST",   path, body),
  patch:  (path, body)    => http("PATCH",  path, body),
  delete: (path)          => http("DELETE", path),
  upload: (path, formData)=> http("POST",   path, formData, true),
};

// ===== Auth =====

function showLogin() {
  document.getElementById("login-form").style.display    = "";
  document.getElementById("register-form").style.display = "none";
  document.getElementById("login-error").style.display   = "none";
}

function showRegister() {
  document.getElementById("login-form").style.display    = "none";
  document.getElementById("register-form").style.display = "";
  document.getElementById("reg-error").style.display     = "none";
}

async function doLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pw    = document.getElementById("login-password").value;
  const err   = document.getElementById("login-error");
  err.style.display = "none";

  if (!email || !pw) { showError(err, "请填写邮箱和密码"); return; }

  try {
    const data = await api.post("/api/auth/login", { email, password: pw });
    saveSession(data);
    enterApp(data.user);
  } catch (e) {
    showError(err, e.message);
  }
}

async function doRegister() {
  const name  = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const pw    = document.getElementById("reg-password").value;
  const err   = document.getElementById("reg-error");
  err.style.display = "none";

  if (!name || !email || !pw) { showError(err, "请填写所有字段"); return; }
  if (pw.length < 6)          { showError(err, "密码至少6位"); return; }

  try {
    const data = await api.post("/api/auth/register", { name, email, password: pw });
    saveSession(data);
    enterApp(data.user);
  } catch (e) {
    showError(err, e.message);
  }
}

function saveSession(data) {
  state.token = data.access_token;
  localStorage.setItem("cd_token", data.access_token);
}

function showError(el, msg) {
  el.textContent    = msg;
  el.style.display  = "block";
}

function enterApp(user) {
  state.currentUser = user;
  document.getElementById("auth-screen").classList.remove("active");
  document.getElementById("app-screen").classList.add("active");

  const initials = user.name.slice(0, 2).toUpperCase();
  document.getElementById("user-avatar").textContent     = initials;
  document.getElementById("user-name-disp").textContent  = user.name;
  document.getElementById("user-email-disp").textContent = user.email;

  updateStorage();
  navTo("all");
}

async function checkSession() {
  if (!state.token) return;
  try {
    const user = await api.get("/api/auth/me");
    enterApp(user);
  } catch {
    localStorage.removeItem("cd_token");
    state.token = null;
  }
}

function showUserMenu() {
  if (confirm("是否退出登录？")) logout();
}

function logout() {
  localStorage.removeItem("cd_token");
  state.token       = null;
  state.currentUser = null;
  document.getElementById("app-screen").classList.remove("active");
  document.getElementById("auth-screen").classList.add("active");
  document.getElementById("login-email").value    = "";
  document.getElementById("login-password").value = "";
  showLogin();
  toast("已退出登录", "info");
}

// ===== Storage =====

async function updateStorage() {
  try {
    const info = await api.get("/api/auth/storage");
    const pct  = Math.min(100, Math.round(info.percent));
    document.getElementById("storage-fill").style.width = pct + "%";
    document.getElementById("storage-text").textContent =
      `${formatSize(info.used)} / ${formatSize(info.quota)}`;
  } catch { /* ignore */ }
}

// ===== Navigation =====

function navTo(nav) {
  state.currentNav  = nav;
  state.currentPath = "";
  state.searchQuery = "";
  document.getElementById("search-input").value = "";

  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  const navEl = document.getElementById("nav-" + nav);
  if (navEl) navEl.classList.add("active");

  renderFiles();
}

// ===== Render =====

async function renderFiles() {
  renderBreadcrumb();

  const params = new URLSearchParams({
    nav:  state.currentNav,
    path: state.currentPath,
    q:    state.searchQuery,
  });

  let data;
  try {
    data = await api.get(`/api/files?${params}`);
  } catch (e) {
    toast("加载失败：" + e.message, "error");
    return;
  }

  const files = data.items || [];
  const grid  = document.getElementById("file-grid-view");
  const list  = document.getElementById("file-list-view");

  if (files.length === 0) {
    const empty = `<div class="empty-state"><i class="ti ti-folder-open"></i><p>此处暂无文件</p></div>`;
    grid.innerHTML = empty;
    list.innerHTML = empty;
    return;
  }

  grid.innerHTML = files.map(f => `
    <div class="file-card" data-id="${f.id}"
         onclick="onFileClick(${f.id}, '${escAttr(f.file_type)}', '${escAttr(f.name)}')"
         oncontextmenu="showCtx(event, ${f.id}, '${escAttr(f.file_type)}')">
      <div class="file-icon ${iconClass(f.file_type)}">
        <i class="ti ${iconName(f.file_type)}"></i>
      </div>
      <div class="file-name">${escHtml(f.name)}</div>
      <div class="file-meta">${f.file_type === "folder" ? "文件夹" : formatSize(f.size)}</div>
      <div class="file-actions">
        <button class="file-action-btn"
                onclick="event.stopPropagation(); downloadFile(${f.id})"
                title="下载">
          <i class="ti ti-download"></i>
        </button>
        <button class="file-action-btn"
                onclick="event.stopPropagation(); showCtx(event, ${f.id}, '${escAttr(f.file_type)}')"
                title="更多">
          <i class="ti ti-dots-vertical"></i>
        </button>
      </div>
    </div>
  `).join("");

  list.innerHTML = `
    <div class="file-list-header">
      <div style="width:34px;margin-right:12px;flex-shrink:0"></div>
      <div style="flex:1">名称</div>
      <div style="width:80px;text-align:right;flex-shrink:0">大小</div>
      <div style="width:120px;text-align:right;flex-shrink:0">修改时间</div>
      <div style="width:70px;flex-shrink:0"></div>
    </div>
    ` + files.map(f => `
    <div class="file-list-item"
         onclick="onFileClick(${f.id}, '${escAttr(f.file_type)}', '${escAttr(f.name)}')"
         oncontextmenu="showCtx(event, ${f.id}, '${escAttr(f.file_type)}')">
      <div class="file-list-icon ${iconClass(f.file_type)}">
        <i class="ti ${iconName(f.file_type)}"></i>
      </div>
      <div class="file-list-name">${escHtml(f.name)}</div>
      <div class="file-list-size">${f.file_type === "folder" ? "—" : formatSize(f.size)}</div>
      <div class="file-list-date">${formatDate(f.updated_at)}</div>
      <div class="file-list-actions">
        <button class="icon-btn" onclick="event.stopPropagation(); downloadFile(${f.id})" title="下载">
          <i class="ti ti-download"></i>
        </button>
        <button class="icon-btn" onclick="event.stopPropagation(); showCtx(event, ${f.id}, '${escAttr(f.file_type)}')" title="更多">
          <i class="ti ti-dots-vertical"></i>
        </button>
      </div>
    </div>
  `).join("");
}

function renderBreadcrumb() {
  const navLabels = {
    all:"全部文件", recent:"最近访问", shared:"我的分享",
    trash:"回收站", image:"图片", video:"视频", doc:"文档"
  };
  const root = navLabels[state.currentNav] || "全部文件";
  const bc   = document.getElementById("breadcrumb");

  if (!state.currentPath) {
    bc.innerHTML = `<span class="current">${escHtml(root)}</span>`;
    return;
  }

  const segs = state.currentPath.split("/").filter(Boolean);
  let html = `<span onclick="backToRoot()">${escHtml(root)}</span>`;
  segs.forEach((seg, i) => {
    html += `<span class="sep"> / </span>`;
    if (i < segs.length - 1) {
      html += `<span onclick="navToPathIndex(${i})">${escHtml(seg)}</span>`;
    } else {
      html += `<span class="current">${escHtml(seg)}</span>`;
    }
  });
  bc.innerHTML = html;
}

function backToRoot() { state.currentPath = ""; renderFiles(); }

function navToPathIndex(idx) {
  const segs = state.currentPath.split("/").filter(Boolean);
  state.currentPath = segs.slice(0, idx + 1).join("/");
  renderFiles();
}

// ===== File Interactions =====

function onFileClick(id, type, name) {
  if (type === "folder") {
    state.currentPath = state.currentPath
      ? state.currentPath + "/" + name
      : name;
    renderFiles();
  } else {
    downloadFile(id);
  }
}

async function downloadFile(id) {
  try {
    const res = await http("GET", `/api/files/${id}/download`);
    // 触发浏览器下载
    const cd   = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename = match ? decodeURIComponent(match[1].replace(/['"]/g, "")) : "download";

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    toast("下载失败：" + e.message, "error");
  }
}

// ===== View Toggle =====

function setView(v) {
  state.currentView = v;
  document.getElementById("file-grid-view").className = "file-grid" + (v === "grid" ? " show" : "");
  document.getElementById("file-list-view").className = "file-list" + (v === "list" ? " show" : "");
  document.getElementById("view-grid-btn").className  = "view-btn"  + (v === "grid" ? " active" : "");
  document.getElementById("view-list-btn").className  = "view-btn"  + (v === "list" ? " active" : "");
}

// ===== Search =====

let searchTimer;
function doSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = document.getElementById("search-input").value.trim();
    renderFiles();
  }, 300);
}

// ===== Upload =====

// ===== Upload Task Manager =====

let pendingUploads = [];
const uploadTasks = [];

function showUpload() {
  pendingUploads = [];
  document.getElementById("upload-list").innerHTML = "";
  document.getElementById("file-input").value = "";
  document.getElementById("upload-modal").classList.add("show");
}

function closeUpload() {
  document.getElementById("upload-modal").classList.remove("show");
}

function triggerFileInput() { document.getElementById("file-input").click(); }
function handleFileSelect(e) { addPendingFiles(Array.from(e.target.files)); }
function handleUploadDrop(e) {
  e.preventDefault(); e.stopPropagation();
  addPendingFiles(Array.from(e.dataTransfer.files));
}

function addPendingFiles(files) {
  files.forEach(f => pendingUploads.push(f));
  renderPendingUploads();
}

function renderPendingUploads() {
  document.getElementById("upload-list").innerHTML = pendingUploads.map(f => `
    <div class="upload-item">
      <i class="ti ${iconName(guessType(f.name))}"></i>
      <span class="upload-item-name">${escHtml(f.name)}</span>
      <span class="upload-item-size">${formatSize(f.size)}</span>
    </div>
  `).join("");
}

function doUpload() {
  if (!pendingUploads.length) { toast("请选择要上传的文件", "error"); return; }
  const files = [...pendingUploads];
  const uploadPath = state.currentPath;
  closeUpload();
  pendingUploads = [];
  document.getElementById("file-input").value = "";

  files.forEach(file => {
    const task = {
      id: Date.now() + Math.random(),
      file, path: uploadPath,
      status: "uploading",
      progress: 0, speed: 0, loaded: 0,
      startTime: Date.now(),
    };
    uploadTasks.push(task);
    startUploadTask(task);
  });
  showUploadPanel();
}

function startUploadTask(task) {
  const form = new FormData();
  form.append("file", task.file);
  const xhr = new XMLHttpRequest();
  task.xhr = xhr;

  xhr.upload.addEventListener("progress", e => {
    if (!e.lengthComputable) return;
    const elapsed = (Date.now() - task.startTime) / 1000 || 0.001;
    task.loaded   = e.loaded;
    task.progress = Math.round((e.loaded / e.total) * 100);
    task.speed    = e.loaded / elapsed;
    renderUploadPanel();
  });

  xhr.addEventListener("load", () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      task.status = "done"; task.progress = 100;
    } else {
      task.status = "error";
      try { task.errorMsg = JSON.parse(xhr.responseText).detail || "上传失败"; }
      catch { task.errorMsg = "上传失败"; }
    }
    renderUploadPanel();
    updateStorage();
    renderFiles();
  });

  xhr.addEventListener("error", () => {
    task.status = "error"; task.errorMsg = "网络错误";
    renderUploadPanel();
  });

  xhr.open("POST", `${API_BASE}/api/files/upload?path=${encodeURIComponent(task.path)}`);
  if (state.token) xhr.setRequestHeader("Authorization", `Bearer ${state.token}`);
  xhr.send(form);
}

function showUploadPanel() {
  let panel = document.getElementById("upload-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "upload-panel";
    panel.className = "upload-panel show";
    panel.innerHTML = `
      <div class="upload-panel-header" onclick="toggleUploadPanel()">
        <div class="upload-panel-title">
          <i class="ti ti-cloud-upload"></i> 传输列表
          <span class="badge" id="upload-badge">0</span>
        </div>
        <div class="upload-panel-actions">
          <button class="upload-panel-btn" onclick="event.stopPropagation();clearDoneTasks()" title="清除已完成"><i class="ti ti-trash"></i></button>
          <button class="upload-panel-btn" id="upload-panel-toggle-icon" title="折叠"><i class="ti ti-chevron-down"></i></button>
        </div>
      </div>
      <div class="upload-panel-body" id="upload-panel-body"></div>
    `;
    document.body.appendChild(panel);
  } else {
    panel.classList.add("show");
    panel.classList.remove("collapsed");
  }
  renderUploadPanel();
}

function toggleUploadPanel() {
  const panel = document.getElementById("upload-panel");
  const icon  = document.getElementById("upload-panel-toggle-icon");
  if (!panel) return;
  panel.classList.toggle("collapsed");
  icon.innerHTML = panel.classList.contains("collapsed")
    ? '<i class="ti ti-chevron-up"></i>'
    : '<i class="ti ti-chevron-down"></i>';
}

function clearDoneTasks() {
  uploadTasks.splice(0, uploadTasks.length, ...uploadTasks.filter(t => t.status === "uploading"));
  if (!uploadTasks.length) {
    const p = document.getElementById("upload-panel");
    if (p) p.classList.remove("show");
  } else renderUploadPanel();
}

function renderUploadPanel() {
  const body  = document.getElementById("upload-panel-body");
  const badge = document.getElementById("upload-badge");
  if (!body) return;
  const active = uploadTasks.filter(t => t.status === "uploading").length;
  if (badge) badge.textContent = active > 0 ? active : uploadTasks.length;

  body.innerHTML = uploadTasks.map(task => {
    const statusIcon = task.status === "done"
      ? '<i class="ti ti-circle-check" style="color:#22c55e;font-size:18px"></i>'
      : task.status === "error"
      ? '<i class="ti ti-circle-x" style="color:#ef4444;font-size:18px"></i>'
      : '<i class="ti ti-loader" style="color:var(--blue-600);font-size:18px"></i>';

    const metaText = task.status === "done"
      ? `<span style="color:#22c55e">上传完成</span>`
      : task.status === "error"
      ? `<span style="color:#ef4444">${escHtml(task.errorMsg || "上传失败")}</span>`
      : `<span>${task.progress}%</span><span>${formatSize(task.speed)}/s</span><span>${formatSize(task.loaded)} / ${formatSize(task.file.size)}</span>`;

    return `<div class="upload-task ${task.status}">
      <div class="upload-task-icon"><i class="ti ${iconName(guessType(task.file.name))}"></i></div>
      <div class="upload-task-info">
        <div class="upload-task-name">${escHtml(task.file.name)}</div>
        <div class="upload-task-meta">${metaText}</div>
        <div class="upload-task-bar-wrap"><div class="upload-task-bar" style="width:${task.progress}%"></div></div>
      </div>
      <div class="upload-task-status">${statusIcon}</div>
    </div>`;
  }).join("");
}

// ===== New Folder =====

function showNewFolder() {
  document.getElementById("folder-name").value = "新建文件夹";
  document.getElementById("folder-modal").classList.add("show");
  setTimeout(() => document.getElementById("folder-name").select(), 50);
}

function closeModal(id) { document.getElementById(id).classList.remove("show"); }

async function createFolder() {
  const name = document.getElementById("folder-name").value.trim();
  if (!name) { toast("请输入文件夹名称", "error"); return; }

  try {
    await api.post("/api/files/folder", { name, path: state.currentPath });
    closeModal("folder-modal");
    toast(`文件夹 "${name}" 已创建`, "success");
    renderFiles();
  } catch (e) {
    toast("创建失败：" + e.message, "error");
  }
}

// ===== Context Menu =====

function showCtx(e, id, type) {
  e.preventDefault(); e.stopPropagation();
  state.ctxTarget     = id;
  state.ctxTargetType = type;

  const menu = document.getElementById("ctx-menu");
  menu.classList.add("show");
  menu.style.left = Math.min(e.clientX, window.innerWidth  - 180) + "px";
  menu.style.top  = Math.min(e.clientY, window.innerHeight - 170) + "px";
}

document.addEventListener("click", () => {
  document.getElementById("ctx-menu").classList.remove("show");
});

function ctxDownload() { downloadFile(state.ctxTarget); }

async function ctxRename() {
  // 从 DOM 取当前文件名
  const card = document.querySelector(`[data-id="${state.ctxTarget}"] .file-name`);
  document.getElementById("rename-input").value = card ? card.textContent : "";
  state.renameTarget = state.ctxTarget;
  document.getElementById("rename-modal").classList.add("show");
  setTimeout(() => document.getElementById("rename-input").select(), 50);
}

async function doRename() {
  const name = document.getElementById("rename-input").value.trim();
  if (!name) { toast("请输入名称", "error"); return; }

  try {
    await api.patch(`/api/files/${state.renameTarget}/rename`, { name });
    closeModal("rename-modal");
    toast("重命名成功", "success");
    renderFiles();
  } catch (e) {
    toast("重命名失败：" + e.message, "error");
  }
}

async function ctxShare() {
  try {
    const updated = await api.post(`/api/files/${state.ctxTarget}/share`);
    if (updated.is_shared && updated.share_token) {
      const link = `${API_BASE}/api/files/shared/${updated.share_token}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      toast("分享链接已复制到剪贴板", "success");
    } else {
      toast("已关闭分享", "info");
    }
    renderFiles();
  } catch (e) {
    toast("操作失败：" + e.message, "error");
  }
}

async function ctxDelete() {
  try {
    if (state.currentNav === "trash") {
      if (!confirm("确认永久删除？此操作不可撤销")) return;
      await api.delete(`/api/files/${state.ctxTarget}/permanent`);
      toast("已永久删除", "info");
    } else {
      await api.delete(`/api/files/${state.ctxTarget}`);
      toast("已移入回收站", "info");
    }
    updateStorage();
    renderFiles();
  } catch (e) {
    toast("删除失败：" + e.message, "error");
  }
}

async function ctxRestore() {
  try {
    await api.post(`/api/files/${state.ctxTarget}/restore`);
    toast("已恢复", "success");
    renderFiles();
  } catch (e) {
    toast("恢复失败：" + e.message, "error");
  }
}

// ===== Drag & Drop =====

function onDragOver(e) {
  e.preventDefault();
  document.getElementById("drag-overlay").classList.add("show");
}

function onDragLeave(e) {
  if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget)) {
    document.getElementById("drag-overlay").classList.remove("show");
  }
}

async function onDrop(e) {
  e.preventDefault();
  document.getElementById("drag-overlay").classList.remove("show");
  const files = Array.from(e.dataTransfer.files);
  if (!files.length) return;

  let count = 0;
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    try {
      await api.upload(`/api/files/upload?path=${encodeURIComponent(state.currentPath)}`, form);
      count++;
    } catch (e) {
      toast(`"${file.name}" 上传失败：${e.message}`, "error");
    }
  }
  if (count > 0) toast(`上传了 ${count} 个文件`, "success");
  updateStorage();
  renderFiles();
}

// ===== Toast =====

function toast(msg, type = "info") {
  const c  = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icons  = { success:"ti-check", error:"ti-alert-circle", info:"ti-info-circle" };
  el.innerHTML = `<i class="ti ${icons[type]}" style="font-size:16px"></i> ${escHtml(msg)}`;
  c.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 0.3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ===== Utilities =====

function formatSize(bytes) {
  if (!bytes || bytes === 0) return "—";
  if (bytes < 1024)        return bytes + " B";
  if (bytes < 1024 ** 2)   return Math.round(bytes / 1024) + " KB";
  if (bytes < 1024 ** 3)   return (bytes / 1024 ** 2).toFixed(1) + " MB";
  return (bytes / 1024 ** 3).toFixed(2) + " GB";
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function guessType(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  const map  = {
    image: ["png","jpg","jpeg","gif","webp","svg","bmp","ico","avif"],
    video: ["mp4","mov","avi","mkv","webm","flv","m4v"],
    audio: ["mp3","wav","flac","aac","ogg","m4a","wma"],
    pdf:   ["pdf"],
    doc:   ["doc","docx","txt","md","odt","rtf","xls","xlsx","csv","ppt","pptx"],
    zip:   ["zip","rar","7z","tar","gz","bz2","xz"],
  };
  for (const [type, exts] of Object.entries(map)) {
    if (exts.includes(ext)) return type;
  }
  return "other";
}

function iconClass(type) {
  return {folder:"folder",image:"image",pdf:"pdf",doc:"doc",video:"video",audio:"audio",zip:"zip"}[type] || "other";
}

function iconName(type) {
  return {folder:"ti-folder",image:"ti-photo",pdf:"ti-file-type-pdf",doc:"ti-file-text",
          video:"ti-video",audio:"ti-music",zip:"ti-file-zip"}[type] || "ti-file";
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])
  );
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

// ===== Keyboard =====

document.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    if (document.getElementById("folder-modal").classList.contains("show")) { createFolder(); return; }
    if (document.getElementById("rename-modal").classList.contains("show")) { doRename(); return; }
    if (document.getElementById("upload-modal").classList.contains("show")) { doUpload(); return; }
  }
  if (e.key === "Escape") {
    closeModal("folder-modal");
    closeModal("rename-modal");
    closeUpload();
    document.getElementById("ctx-menu").classList.remove("show");
  }
});

// ===== Bootstrap =====
checkSession();
