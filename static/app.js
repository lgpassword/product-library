const $ = (s) => document.querySelector(s);
// 注意：转成真数组！NodeList 没有 .map/.filter，直接返回会在 $$(...).map 处抛错导致统计不更新
const $$ = (s) => [...document.querySelectorAll(s)];

const state = {
  categories: [],
  companies: [],
  tags: [],
  page: 1,
  pageSize: 20,
  total: 0,
  filters: { search: "", category_id: "", company_id: "", tag_id: "" },
};

let cart = loadCart();
let currentProject = "";
let cartSelected = new Set();
let productSelected = new Set();

function loadCart() {
  try {
    const raw = localStorage.getItem("cart");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { projects: [{ name: "默认项目", ids: parsed }] };
      }
      if (parsed && Array.isArray(parsed.projects)) {
        return parsed;
      }
    }
  } catch (e) {}
  return { projects: [{ name: "默认项目", ids: [] }] };
}

async function api(url, opts = {}) {
  const res = await fetch(url, { cache: "no-store", ...opts });
  if (!res.ok) {
    let msg = "请求失败";
    try { msg = (await res.json()).detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

function qs(obj) {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v !== null && v !== undefined) p.append(k, v); });
  const s = p.toString();
  return s ? "?" + s : "";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (isNaN(n)) return "—";
  // 整数不带小数，小数保留两位；不显示货币符号（纯数字便于统计）
  return n % 1 === 0 ? n.toLocaleString("zh-CN") : n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadDicts() {
  const [c, co, t] = await Promise.all([
    api("/api/categories"), api("/api/companies"), api("/api/tags"),
  ]);
  state.categories = c; state.companies = co; state.tags = t;
  fillSelect($("#f-category"), c, "全部类型");
  fillSelect($("#f-company"), co, "全部公司");
  fillSelect($("#f-tag"), t, "全部标签");
}

function fillSelect(sel, items, placeholder) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join("");
  sel.value = cur;
}

// ---------- 视图切换 ----------

function switchView(name) {
  $("#view-home").style.display = name === "home" ? "block" : "none";
  $("#view-products").style.display = name === "products" ? "block" : "none";
  $("#view-cart").style.display = name === "cart" ? "block" : "none";
  $("#view-files").style.display = name === "files" ? "block" : "none";
  $("#view-notes").style.display = name === "notes" ? "block" : "none";
  $("#tab-home").classList.toggle("active", name === "home");
  $("#tab-products").classList.toggle("active", name === "products");
  $("#tab-cart").classList.toggle("active", name === "cart");
  $("#tab-files").classList.toggle("active", name === "files");
  $("#tab-notes").classList.toggle("active", name === "notes");
  // 底部固定统计栏只在购物车页显示
  if (name !== "cart") $("#cart-summary").style.display = "none";
  if (name === "home") renderHome();
  if (name === "cart") renderCart();
  if (name === "files") { loadFolders(); loadFiles(); }
  if (name === "notes") renderNotes();
  updateSelFloat();
}

function gotoSourceFile(fid, fname) {
  closeModal();
  // 重置为“全部”文件夹并清空搜索,避免被当前文件夹过滤掉
  currentFolder = "__all__";
  fileSearch = "";
  switchView("files");
  setTimeout(() => {
    const q = $("#file-q");
    if (q) q.value = fname || "";
    const btn = $("#btn-file-search");
    if (btn) btn.click();
    setTimeout(() => {
      const rows = document.querySelectorAll("#files-tbody tr");
      for (const r of rows) {
        if (fname && (r.textContent || "").includes(fname.slice(0, 15))) {
          r.style.background = "rgba(37,99,235,.16)";
          r.scrollIntoView({ block: "center" });
          setTimeout(() => { r.style.background = ""; }, 2800);
          break;
        }
      }
    }, 700);
  }, 300);
}

// ---------- 购物车 ----------

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
  const total = cart.projects.reduce((s, p) => s + p.ids.length, 0);
  $("#cart-count").textContent = total;
}

function getProject(name) {
  return cart.projects.find((p) => p.name === name);
}

// 购物车价格覆盖（仅存浏览器 localStorage，不改产品库数据）
let cartPrices = loadCartPrices();
let cartProductCache = {};  // 产品 id -> 产品数据（供统计读渠道价）
function loadCartPrices() {
  try { return JSON.parse(localStorage.getItem("cart_prices") || "{}"); } catch (e) { return {}; }
}
function saveCartPrices() {
  localStorage.setItem("cart_prices", JSON.stringify(cartPrices));
}
function currentProjectIds() {
  const proj = getProject(currentProject);
  return proj ? proj.ids : [];
}

function renderCartProjectBar() {
  const bar = $("#cart-project-bar");
  bar.innerHTML = cart.projects.map((p) =>
    `<span class="folder-chip ${currentProject === p.name ? "on" : ""}">
      <span data-project="${esc(p.name)}">${esc(p.name)} (${p.ids.length})</span>
      <span class="chip-del" data-project-del="${esc(p.name)}" title="删除项目">×</span>
    </span>`
  ).join("") + `<span class="folder-chip folder-new-chip" id="cart-project-new">+ 新建项目</span>`;
  bar.querySelectorAll("[data-project]").forEach((c) => {
    c.onclick = async () => {
      currentProject = c.dataset.project;
      renderCartProjectBar();
      await renderCart();
    };
  });
  bar.querySelectorAll("[data-project-del]").forEach((c) => {
    c.onclick = async (e) => {
      e.stopPropagation();
      deleteCartProject(c.dataset.projectDel);
    };
  });
  const nb = bar.querySelector("#cart-project-new");
  if (nb) nb.onclick = () => newCartProject();
}

async function deleteCartProject(name) {
  if (!confirm(`删除项目「${name}」？项目里的产品也会从购物车移除（不影响产品库数据）。`)) return;
  cart.projects = cart.projects.filter((p) => p.name !== name);
  if (currentProject === name) {
    currentProject = cart.projects.length ? cart.projects[0].name : "";
    cartSelected.clear();
  }
  saveCart();
  renderCartProjectBar();
  await renderCart();
}

async function newCartProject() {
  const name = await showPrompt("新建项目", "请输入项目名称");
  if (!name) return;
  if (getProject(name)) { alert("项目已存在"); return; }
  cart.projects.push({ name, ids: [] });
  currentProject = name;
  saveCart();
  renderCartProjectBar();
  await renderCart();
}

function removeFromCart(id) {
  const proj = getProject(currentProject);
  if (proj) {
    proj.ids = proj.ids.filter((x) => x !== id);
    cartSelected.delete(id);
  }
  saveCart();
  renderCart();
}

async function renderCart() {
  if (!currentProject && cart.projects.length) currentProject = cart.projects[0].name;
  renderCartProjectBar();
  const ids = currentProjectIds();
  if (!ids.length) {
    $("#cart-tbody").innerHTML = "";
    $("#cart-empty").style.display = "block";
    $("#cart-summary").style.display = "none";
    return;
  }
  $("#cart-empty").style.display = "none";
  const items = await Promise.all(ids.map((id) => api("/api/products/" + id)));
  cartProductCache = {};
  for (const p of items) cartProductCache[p.id] = p;
  $("#cart-tbody").innerHTML = items.map((p) => {
    // 购物车价格覆盖（只影响本项目展示与导出，不改产品库）
    const ov = cartPrices[p.id] || {};
    const mp = ov.market_price !== undefined ? ov.market_price : p.market_price;
    // 内联 oninput/onchange 直接绑定（比事件委托更可靠），空价格也可输入
    const hasMp = mp !== null && mp !== undefined && mp !== "";
    const mpCell = `<input type="number" step="0.01" class="input cart-price-input"
        data-pid="${p.id}" data-field="market_price"
        value="${hasMp ? Number(mp) : ""}" placeholder="${hasMp ? "" : "输入价格"}"
        oninput="handleCartPriceInput(this)" onchange="handleCartPriceInput(this)"
        style="width:110px;padding:5px 8px">`;
    return `
    <tr>
      <td><input type="checkbox" class="cart-check" data-id="${p.id}" ${cartSelected.has(p.id) ? "checked" : ""}></td>
      <td class="muted">${esc(p.seq || "—")}</td>
      <td><a class="link" data-act="view" data-id="${p.id}" title="点击查看详情">${esc(p.name)}</a></td>
      <td class="muted">${esc(p.category_name || "—")}</td>
      <td class="price">${mpCell}</td>
      <td class="price">${fmtPrice(p.channel_price)}</td>
      <td><a class="link" style="color:var(--danger)" data-cart-remove="${p.id}">移除</a></td>
    </tr>`;
  }).join("");
  updateCartSummary(items);
}

function updateCartSummary(items) {
  // 统计【仅勾选的产品】；未勾选任何产品时显示 0（不显示全部）
  const checkedIds = currentProjectIds().filter((id) => cartSelected.has(id));
  const useChecked = checkedIds.length > 0;
  const scope = useChecked ? items.filter((p) => checkedIds.includes(p.id)) : [];
  let marketSum = 0, channelSum = 0;
  for (const p of scope) {
    const ov = cartPrices[p.id] || {};
    const mp = ov.market_price !== undefined ? Number(ov.market_price) : Number(p.market_price);
    const cp = Number(p.channel_price);
    if (!isNaN(mp) && mp !== null) marketSum += mp;
    if (!isNaN(cp) && p.channel_price !== null && p.channel_price !== undefined && p.channel_price !== "") channelSum += cp;
  }
  setSum("#sum-count", scope.length);
  $("#sum-scope").textContent = useChecked ? `已勾选 ${scope.length} 个` : `未勾选`;
  setSum("#sum-market", fmtPrice(Math.round(marketSum * 100) / 100));
  setSum("#sum-channel", fmtPrice(Math.round(channelSum * 100) / 100));
  $("#cart-summary").style.display = "flex";
}

// 从当前表格行实时读取（勾选/改价后即时刷新统计）
function getCartRows() {
  return $$("#cart-tbody tr").map((tr) => {
    const inp = tr.querySelector(".cart-price-input");
    const chk = tr.querySelector(".cart-check");
    return { id: Number(chk.dataset.id), checked: chk.checked, market_price: inp ? inp.value : null };
  });
}

// 更新统计数字并做闪烁反馈（让用户明确看到合计已变化）
function setSum(id, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("flash");
  void el.offsetWidth; // 强制重排以重放动画
  el.classList.add("flash");
}

function updateCartSummaryFromRows(rows) {
  // 统计【仅勾选的产品】；未勾选时显示 0
  const checked = rows.filter((r) => r.checked);
  const scope = checked.length ? checked : [];
  let marketSum = 0, channelSum = 0;
  for (const r of scope) {
    const mp = r.market_price !== null && r.market_price !== "" ? Number(r.market_price) : null;
    if (mp !== null && !isNaN(mp)) marketSum += mp;
    // 渠道价从产品库取（不可编辑）
    const p = cartProductCache[r.id];
    if (p && p.channel_price !== null && p.channel_price !== undefined && p.channel_price !== "") {
      const cp = Number(p.channel_price);
      if (!isNaN(cp)) channelSum += cp;
    }
  }
  setSum("#sum-count", scope.length);
  $("#sum-scope").textContent = checked.length ? `已勾选 ${checked.length} 个` : `未勾选`;
  setSum("#sum-market", fmtPrice(Math.round(marketSum * 100) / 100));
  setSum("#sum-channel", fmtPrice(Math.round(channelSum * 100) / 100));
}

// 恢复本购物车项目的所有改价（回到产品库原价）
function resetCartPrices() {
  const ids = currentProjectIds();
  if (!ids.length) return;
  if (!confirm("恢复当前项目所有产品为产品库原价？（仅影响本项目，不改产品库）")) return;
  let cleared = 0;
  for (const id of ids) {
    if (cartPrices[id]) { delete cartPrices[id]; cleared++; }
  }
  saveCartPrices();
  renderCart();
  if (cleared) alert(`已恢复 ${cleared} 个产品的原价`);
}

function openCartAddModal(ids) {
  if (!cart.projects.length) cart.projects.push({ name: "默认项目", ids: [] });
  const sel = $("#cart-project-select");
  sel.innerHTML = cart.projects.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("");
  $("#cart-new-project").value = "";
  $("#cart-add-info").textContent = `已勾选 ${ids.length} 个产品，选择加入的项目：`;
  openModal("#modal-cart-add");
  $("#btn-cart-add-ok").onclick = () => {
    let projectName = $("#cart-new-project").value.trim();
    if (!projectName) projectName = sel.value;
    if (!projectName) { alert("请选择或输入项目名称"); return; }
    let proj = getProject(projectName);
    if (!proj) {
      proj = { name: projectName, ids: [] };
      cart.projects.push(proj);
    }
    for (const id of ids) {
      if (!proj.ids.includes(id)) proj.ids.push(id);
    }
    saveCart();
    closeModal();
  };
}

async function exportCart() {
  const ids = currentProjectIds().filter((id) => cartSelected.has(id));
  if (!ids.length) { alert("请先勾选要导出的产品"); return; }
  // 带上购物车价格覆盖（不改产品库）
  const price_overrides = {};
  for (const id of ids) {
    if (cartPrices[id] && cartPrices[id].market_price !== undefined) {
      price_overrides[id] = { market_price: cartPrices[id].market_price };
    }
  }
  const res = await fetch("/api/export/selected", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, price_overrides }),
  });
  if (!res.ok) { alert("导出失败"); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "选购产品_" + new Date().toISOString().slice(0, 10) + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 文件库 ----------

let fileSearch = "";
let currentFolder = "__all__";
let folders = [];
let fileSelected = new Set();

async function loadFolders() {
  folders = await api("/api/folders");
  renderFolderBar();
}

function renderFolderBar() {
  const bar = $("#folder-bar");
  const items = [
    { label: "全部", value: "__all__", id: null },
    { label: "根目录", value: "", id: null },
  ].concat(folders.map((f) => ({ label: f.name, value: f.name, id: f.id })));
  bar.innerHTML = items.map((it) => {
    const del = it.id ? `<span class="chip-del" data-folder-del="${it.id}" data-folder-name="${esc(it.label)}" title="删除文件夹">×</span>` : "";
    return `<span class="folder-chip ${currentFolder === it.value ? "on" : ""}">
      <span data-folder="${esc(it.value)}">${esc(it.label)}</span>${del}
    </span>`;
  }).join("");
  bar.querySelectorAll("[data-folder]").forEach((c) => {
    c.onclick = async () => {
      currentFolder = c.dataset.folder;
      renderFolderBar();
      await loadFiles();
    };
  });
  bar.querySelectorAll("[data-folder-del]").forEach((c) => {
    c.onclick = async (e) => {
      e.stopPropagation();
      deleteFolder(c.dataset.folderDel, c.dataset.folderName);
    };
  });
}

async function deleteFolder(id, name) {
  if (!confirm(`删除文件夹「${name}」？文件夹里的文件也会一并删除，且无法恢复。`)) return;
  await api(`/api/folders/${id}`, { method: "DELETE" });
  if (currentFolder === name) currentFolder = "__all__";
  await loadFolders();
  await loadFiles();
}

async function batchDownloadFiles() {
  const ids = [...fileSelected];
  if (!ids.length) { alert("请先勾选要下载的文件"); return; }
  const res = await fetch("/api/files/batch-download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) { alert("下载失败"); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "文件下载_" + new Date().toISOString().slice(0, 10) + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}

async function batchMoveFiles() {
  const ids = [...fileSelected];
  if (!ids.length) { alert("请先勾选要移动的文件"); return; }
  const folder = await showPrompt("移动文件", "输入目标文件夹名（留空移动到根目录）");
  if (folder === null) return;
  const target = folder;
  if (target && !folders.some((f) => f.name === target)) {
    await api("/api/folders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: target }),
    });
  }
  const res = await api("/api/files/batch-move", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, folder: target }),
  });
  fileSelected.clear();
  await loadFolders();
  await loadFiles();
  alert(`已移动 ${res.moved} 个文件`);
}

async function loadFiles() {
  const parts = [];
  if (fileSearch) parts.push("search=" + encodeURIComponent(fileSearch));
  if (currentFolder !== "__all__") {
    parts.push("folder=" + encodeURIComponent(currentFolder));
  }
  const q = parts.length ? "?" + parts.join("&") : "";
  const data = await api("/api/files" + q);
  renderFiles(data);
}

function fmtSize(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function renderFiles(files) {
  const tbody = $("#files-tbody");
  $("#files-empty").style.display = files.length ? "none" : "block";
  tbody.innerHTML = files.map((f) => `
    <tr>
      <td><input type="checkbox" class="file-check" data-id="${f.id}" ${fileSelected.has(f.id) ? "checked" : ""}></td>
      <td>${esc(f.filename)}</td>
      <td class="muted">${esc(f.folder || "根目录")}</td>
      <td class="muted">${fmtSize(f.size)}</td>
      <td class="muted">${f.created_at || "—"}</td>
      <td><div class="row-actions">
        <a class="link" data-file-preview="${f.id}">预览</a>
        <a class="link" href="/api/files/${f.id}/download" target="_blank">下载</a>
        <a class="link" style="color:var(--danger)" data-file-del="${f.id}">删除</a>
      </div></td>
    </tr>`).join("");
  const selAll = $("#file-select-all");
  if (selAll) {
    selAll.checked = files.length > 0 && files.every((f) => fileSelected.has(f.id));
  }
}

function _previewShowStatus(text, isError) {
  const s = $("#file-preview-status");
  const t = $("#file-preview-status-text");
  const f = $("#file-preview-frame");
  if (f) f.style.display = "none";
  if (s) s.style.display = "flex";
  if (t) {
    const spin = s.querySelector(".spinner");
    if (isError) {
      if (spin) spin.style.display = "none";
      t.innerHTML = "⚠️ " + text + "<br><br><span style='color:#9ca3af;font-size:12px'>可关闭弹窗后重新点击预览,或点下方按钮下载原文件</span>";
    } else {
      if (spin) spin.style.display = "";
      t.textContent = text;
    }
  }
}
function _previewShowFrame(url) {
  const s = $("#file-preview-status");
  const f = $("#file-preview-frame");
  if (s) s.style.display = "none";
  if (f) {
    f.onload = null;
    f.src = url;
    f.style.display = "block";
  }
}
function _previewShowNote(text) {
  const n = $("#file-preview-note");
  if (!n) return;
  if (!text) { n.style.display = "none"; return; }
  n.textContent = "ℹ️ " + text;
  n.style.display = "block";
  n.onclick = () => { n.style.display = "none"; };
}
async function openFilePreview(fid) {
  openModal("#modal-file-preview");
  _previewShowNote(null);
  _previewShowStatus("正在提交预览任务...");
  try {
    const r = await fetch("/api/files/" + fid + "/preview/async", { method: "POST" });
    if (!r.ok) {
      let m = "预览服务异常 (" + r.status + ")";
      try { m = (await r.json()).detail || m; } catch (e) {}
      _previewShowStatus(m, true);
      return;
    }
    const data = await r.json();
    if (data.note) _previewShowNote(data.note);
    if (data.url && data.status === "done") {
      _previewShowFrame(data.url);
      return;
    }
    const tid = data.task_id;
    let elapsed = 0;
    for (let i = 0; i < 240; i++) {  // 最多轮询 240 次 ≈ 6 分钟
      await new Promise(rs => setTimeout(rs, 1500));
      elapsed += 1.5;
      const r2 = await fetch("/api/preview/tasks/" + tid);
      const st = await r2.json();
      if (st.note) _previewShowNote(st.note);
      if (st.status === "done" && st.url) {
        _previewShowFrame(st.url);
        return;
      }
      if (st.status === "failed") {
        _previewShowStatus("预览生成失败: " + (st.error || "未知错误"), true);
        return;
      }
      const sizeMb = (data.size / 1048576).toFixed(1);
      _previewShowStatus("正在生成预览... 已用时 " + elapsed.toFixed(0) + "s (文件大小 " + sizeMb + " MB)");
    }
    _previewShowStatus("预览生成超时,请改用下载查看原文件", true);
  } catch (e) {
    _previewShowStatus("网络错误: " + (e.message || e), true);
  }
}

async function uploadLibraryFiles(fileList, folder) {
  const target = folder !== undefined ? folder : (currentFolder === "__all__" ? "" : currentFolder);
  for (const f of fileList) {
    let filename = f.name;
    let done = false;
    while (!done) {
      const fd = new FormData();
      fd.append("file", f, filename);
      fd.append("folder", target);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (res.ok) {
        done = true;
      } else if (res.status === 409) {
        const newName = await showPrompt("文件重名", `「${filename}」已存在，请输入新名称（留空则跳过）`);
        if (!newName) break;
        filename = newName;
      } else {
        let msg = f.name;
        try { msg = (await res.json()).detail || msg; } catch (e) {}
        alert("上传失败：" + msg);
        break;
      }
    }
  }
  await loadFiles();
}

async function newFolder() {
  const name = await showPrompt("新建文件夹", "请输入文件夹名称");
  if (!name) return;
  try {
    await api("/api/folders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await loadFolders();
  } catch (e) {
    alert(e.message);
  }
}

function openUploadModal() {
  const sel = $("#upload-folder");
  sel.innerHTML = `<option value="">根目录</option>` + folders.map((f) => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join("");
  if (currentFolder !== "__all__" && currentFolder !== "") sel.value = currentFolder;
  $("#upload-progress-wrap").style.display = "none";
  openModal("#modal-upload");
  setupUploadDropzone();
}

function setupUploadDropzone() {
  const dz = $("#upload-dropzone");
  const input = $("#upload-file-input");
  dz.onclick = () => input.click();
  input.onchange = async (e) => {
    await uploadWithProgress(e.target.files);
    e.target.value = "";
  };
  // 用 onxxx 属性赋值（而非 addEventListener），避免每次打开弹窗重复叠加监听器导致文件被上传多次
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add("drag-over"); };
  dz.ondragleave = (e) => { e.preventDefault(); dz.classList.remove("drag-over"); };
  dz.ondrop = async (e) => {
    e.preventDefault();
    dz.classList.remove("drag-over");
    await uploadWithProgress(e.dataTransfer.files);
  };
}

function uploadOneFileXHR(file, filename, folder, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file, filename);
    fd.append("folder", folder);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve("ok");
      else if (xhr.status === 409) resolve("dup");
      else {
        let msg = filename;
        try { msg = JSON.parse(xhr.responseText).detail || msg; } catch (e) {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("网络错误"));
    xhr.send(fd);
  });
}

async function uploadWithProgress(fileList) {
  if (!fileList || !fileList.length) return;
  if (window._uploading) return;  // 防重入：上一次上传未完成时忽略新触发
  window._uploading = true;
  const folder = $("#upload-folder").value;
  const wrap = $("#upload-progress-wrap");
  const info = $("#upload-progress-info");
  const fill = $("#progress-fill");
  wrap.style.display = "block";
  const total = fileList.length;
  let finished = 0;
  for (const f of fileList) {
    let filename = f.name;
    let done = false;
    while (!done) {
      info.textContent = `正在上传：${filename}`;
      fill.style.width = "0%";
      try {
        const result = await uploadOneFileXHR(f, filename, folder, (pct) => {
          fill.style.width = Math.round(pct * 100) + "%";
        });
        if (result === "ok") {
          done = true;
          finished++;
          fill.style.width = "100%";
        } else if (result === "dup") {
          const newName = await showPrompt("文件重名", `「${filename}」已存在，请输入新名称（留空则跳过）`);
          if (!newName) { finished++; done = true; break; }
          filename = newName;
        }
      } catch (e) {
        alert("上传失败：" + e.message);
        finished++;
        done = true;
      }
    }
    info.textContent = `进度：${finished} / ${total} 个文件`;
    fill.style.width = Math.round((finished / total) * 100) + "%";
  }
  info.textContent = `上传完成（${finished} 个文件）`;
  window._uploading = false;
  setTimeout(() => {
    closeModal();
    loadFiles();
    loadFolders();
  }, 600);
}

// ---------- 首页看板 ----------

let chartInstances = [];

const STAT_ICONS = {
  total: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/></svg>`,
  category: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  company: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5l7-3v19"/><path d="M12 9l7 3v9"/><path d="M9 9h.01M9 13h.01M9 17h.01"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13l-7 7-9-9V4h7l9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/></svg>`,
};

function animateNumber(el, target, duration = 950) {
  const start = performance.now();
  const from = 0;
  function tick(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function renderHome() {
  const s = await api("/api/stats");
  const catN = s.by_category.filter((x) => x.value > 0).length;
  const comN = s.by_company.filter((x) => x.value > 0).length;
  const tagN = s.by_tag.filter((x) => x.value > 0).length;
  const today = new Date();
  const week = ["日", "一", "二", "三", "四", "五", "六"][today.getDay()];
  const dateStr = `${today.getMonth() + 1}月${today.getDate()}日 星期${week}`;
  const hour = today.getHours();
  const greet = hour < 6 ? "夜深了" : hour < 12 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";

  const catTop = s.by_category.filter((x) => x.value > 0).slice(0, 8);
  const comTop = s.by_company.filter((x) => x.value > 0).slice(0, 8);
  const maxCat = catTop.length ? catTop[0].value : 1;
  const maxCom = comTop.length ? comTop[0].value : 1;

  // 分类彩色横向条(纯CSS)
  const catBars = catTop.map((c) => `
    <div class="hb-row" style="cursor:pointer" title="查看「${esc(c.name)}」产品" onclick="gotoFiltered('cat','${esc(c.name)}')">
      <span class="hb-name">${esc(c.name.length > 9 ? c.name.slice(0, 8) + "…" : c.name)}</span>
      <span class="hb-track"><span class="hb-fill" style="width:${(c.value / maxCat * 100).toFixed(1)}%"></span></span>
      <span class="hb-val">${c.value}</span>
    </div>`).join("");

  // 公司徽章流
  const palette = ["#2563EB", "#0D9488", "#E8A33D", "#7C5CD6", "#E2725B", "#2B7FE0", "#14B8A6", "#F0B454"];
  const comChips = comTop.map((c, i) =>
    `<span class="com-chip" style="--cc:${palette[i % palette.length]};cursor:pointer" title="查看「${esc(c.name)}」产品" onclick="gotoFiltered('com','${esc(c.name)}')">${esc(c.name.length > 12 ? c.name.slice(0, 11) + "…" : c.name)} <b>${c.value}</b></span>`).join("");

  // 热门产品(带图优先)
  const topProds = (s.top_products || []).filter((x) => x.img_id).slice(0, 8);
  const topCards = topProds.length ? topProds.map((p) => `
    <div class="hot-card" onclick="openProductQuick(${p.id})">
      <div class="hot-img"><img src="/api/attachments/${p.img_id}/raw" loading="lazy" onerror="this.closest('.hot-card').style.display='none'"></div>
      <div class="hot-info">
        <div class="hot-name">${esc(p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name)}</div>
        <div class="hot-meta">${esc(p.model || "")}</div>
        <div class="hot-price">${p.market_price != null ? "¥" + fmtPrice(p.market_price) : ""}</div>
      </div>
    </div>`).join("") : '<div class="muted" style="padding:24px">暂无产品图片 — 去"AI 助手/导入"添加吧</div>';

  // 最新入库
  const latest = (s.latest || []).slice(0, 7);
  const latestList = latest.length ? `<div class="latest-list">${latest.map((p, i) => `
    <div class="latest-row" onclick="openProductQuick(${p.id})">
      <span class="latest-idx">${String(i + 1).padStart(2, "0")}</span>
      <span class="latest-name">${esc(p.name.length > 24 ? p.name.slice(0, 23) + "…" : p.name)}</span>
      <span class="latest-price">${p.market_price != null ? "¥" + fmtPrice(p.market_price) : ""}</span>
    </div>`).join("")}</div>` : "";

  $("#home-content").innerHTML = `
    <div class="home-wrap">
      <div class="hero-banner">
        <div class="hero-glow"></div>
        <div class="hero-inner">
          <div class="hero-kicker">${greet} · ${dateStr}</div>
          <div class="hero-title">康复特教产品库</div>
          <div class="hero-sub">一站式管理康复辅具 · 心理设备 · 特教平台 · 结构化教室 · 数字教育装备</div>
          <div class="hero-actions">
            <button class="btn hero-btn" onclick="gotoProducts()">📦 浏览产品</button>
            <button class="btn hero-btn ghost" onclick="gotoFiles()">🗂 打开文件库</button>
            <button class="btn hero-btn ghost" onclick="openAiFab()">🤖 AI 录入</button>
          </div>
        </div>
        <div class="hero-badge"><div class="badge-num">${s.total}</div><div class="badge-lbl">在库产品</div></div>
      </div>

      <div class="stats-grid">
        <div class="stat-card" style="animation-delay:.1s;--accent:#2563EB">
          <div class="stat-icon" style="background:#E8F0FE;color:#2563EB">${STAT_ICONS.total}</div>
          <div><div class="num" data-count="${s.total}">0</div><div class="lbl">产品总数</div></div>
        </div>
        <div class="stat-card" style="animation-delay:.2s;--accent:#0D9488">
          <div class="stat-icon" style="background:#E0F5F2;color:#0D9488">${STAT_ICONS.category}</div>
          <div><div class="num" data-count="${catN}">0</div><div class="lbl">产品类型</div></div>
        </div>
        <div class="stat-card" style="animation-delay:.3s;--accent:#E8A33D">
          <div class="stat-icon" style="background:#FDF3E3;color:#E8A33D">${STAT_ICONS.company}</div>
          <div><div class="num" data-count="${comN}">0</div><div class="lbl">合作公司</div></div>
        </div>
        <div class="stat-card" style="animation-delay:.4s;--accent:#7C5CD6">
          <div class="stat-icon" style="background:#F0EBFC;color:#7C5CD6">${STAT_ICONS.tag}</div>
          <div><div class="num" data-count="${tagN}">0</div><div class="lbl">标签种类</div></div>
        </div>
      </div>

      <div class="home-cols">
        <div class="panel">
          <div class="panel-head"><h3>🔥 热门产品</h3><span class="muted" style="font-size:12px">覆盖各大类型 · 点击查看</span></div>
          <div class="hot-grid">${topCards}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>🕒 最新入库</h3><span class="muted" style="font-size:12px">最近添加 · 点击查看</span></div>
          ${latestList}
        </div>
      </div>

      <div class="home-cols">
        <div class="panel">
          <div class="panel-head"><h3>📊 产品类型分布</h3><span class="muted" style="font-size:12px">Top ${catTop.length}</span></div>
          <div class="hb-list">${catBars}</div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>🏢 合作公司</h3><span class="muted" style="font-size:12px">产品数量 TOP</span></div>
          <div class="com-wrap">${comChips}</div>
        </div>
      </div>
    </div>`;

  $$("#home-content .num").forEach((el) => {
    const target = Number(el.dataset.count) || 0;
    animateNumber(el, target);
  });
  chartInstances.forEach((c) => c.destroy());
  chartInstances = [];
}

function gotoProducts() { switchView("products"); }
function gotoFiles() { switchView("files"); }

// 首页点击分类/公司 → 切到产品库并按名筛选(选下拉框里匹配项)
window.gotoFiltered = async function (kind, name) {
  switchView("products");
  await loadDicts();
  const catSel = $("#f-category");
  const comSel = $("#f-company");
  const tagSel = $("#f-tag");
  const q = $("#q");
  let matched = false;
  if (kind === "cat" && catSel) {
    for (const o of catSel.options) if (o.text === name) { catSel.value = o.value; matched = true; break; }
  } else if (kind === "com" && comSel) {
    for (const o of comSel.options) if (o.text === name) { comSel.value = o.value; matched = true; break; }
  }
  if (!matched && q) q.value = name;  // 下拉没匹配到,退化为关键词搜索
  state.filters = collectFilters();
  state.page = 1;
  await loadProducts();
  // 若在下拉匹配,保持选中
};

// 键盘 "/" 快速聚焦产品搜索
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
    e.preventDefault();
    const q = $("#q");
    if (q) { switchView("products"); setTimeout(() => q.focus(), 60); }
  }
});
function openAiFab() { const f = $("#ai-fab"); if (f) f.click(); }
window.openProductQuick = async function (id) {
  try { await openDetail(id); } catch (e) {}
};

// 横向条形图：条在右侧延伸，类目名在左侧完整显示，永不挤压文字
function makeHBar(canvasId, data, colors) {
  const ctx = $(canvasId);
  if (!ctx) return null;
  // 数量多的排前面
  const sorted = [...data].sort((a, b) => b.value - a.value);
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: sorted.map((d) => d.name),
      datasets: [{
        label: "数量",
        data: sorted.map((d) => d.value),
        backgroundColor: sorted.map((_, i) => colors[i % colors.length]),
        borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 6, bottomRight: 6 },
        borderSkipped: false,
        maxBarThickness: 26,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: "easeOutQuart" },
      layout: { padding: { left: 4, right: 34 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(13,30,56,.92)",
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: { label: (c) => ` ${c.parsed.x} 个产品` },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: "rgba(100,116,139,.09)" },
          ticks: { precision: 0, font: { size: 11 }, color: "#64748B" },
        },
        y: {
          grid: { display: false },
          ticks: { font: { size: 12.5 }, color: "#17263C", autoSkip: false, crossAlign: "far" },
        },
      },
    },
  });
}

// ---------- 产品列表 ----------

async function loadProducts() {
  const params = { ...state.filters, page: state.page, page_size: state.pageSize };
  const data = await api("/api/products" + qs(params));
  state.total = data.total;
  renderTable(data.items);
  renderPagination();
}

// 标签单元格渲染：超过 2 个折叠，显示"+N"，点击展开/收起，避免撑高行
function renderTagCell(tags) {
  if (!tags.length) return '<span class="muted">—</span>';
  const MAX = 2;
  if (tags.length <= MAX) {
    return tags.map((t) => `<span class="tag">${esc(t.name)}</span>`).join("");
  }
  const shown = tags.slice(0, MAX).map((t) => `<span class="tag">${esc(t.name)}</span>`).join("");
  const rest = tags.slice(MAX).map((t) => `<span class="tag">${esc(t.name)}</span>`).join("");
  return `
    <div class="tag-cell">
      <div class="tag-collapsed">${shown}<span class="tag tag-more" data-tagtoggle>+${tags.length - MAX}</span></div>
      <div class="tag-expanded" style="display:none">${shown}${rest}</div>
    </div>`;
}

document.addEventListener("click", (e) => {
  if (!e.target.matches("[data-tagtoggle]")) return;
  const cell = e.target.closest(".tag-cell");
  if (!cell) return;
  const collapsed = cell.querySelector(".tag-collapsed");
  const expanded = cell.querySelector(".tag-expanded");
  const isExpanded = expanded.style.display !== "none";
  expanded.style.display = isExpanded ? "none" : "block";
  collapsed.style.display = isExpanded ? "block" : "none";
});

function renderTable(items) {
  const tbody = $("#tbody");  $("#empty").style.display = items.length ? "none" : "block";
  tbody.innerHTML = items.map((p) => {
    const img = p.images && p.images.length
      ? `<img class="thumb" src="/api/attachments/${p.images[0].id}/raw" alt="" style="cursor:pointer" onclick="showImage('/api/attachments/${p.images[0].id}/raw')">`
      : `<div class="thumb-placeholder">无图</div>`;
    const tags = renderTagCell(p.tags || []);
    const files = (p.files || []).map((f) =>
      `<a class="link" href="/api/attachments/${f.id}/download" target="_blank" title="${esc(f.filename)}">${esc(f.filename)}</a>`
    ).join("");
    const time = (p.created_at || "").slice(0, 10);
    const src = p.source_file_id
      ? `<a class="link src-file-link" data-src-file="${p.source_file_id}" data-src-name="${esc(p.source_filename || "")}" title="来源文件:${esc(p.source_filename || "")}">${esc((p.source_filename || "").length > 18 ? (p.source_filename || "").slice(0, 17) + "…" : p.source_filename || "")}</a>`
      : '<span class="muted">—</span>';
    return `<tr>
      <td><input type="checkbox" class="product-check" data-id="${p.id}" ${productSelected.has(p.id) ? "checked" : ""}></td>
      <td>${img}</td>
      <td class="muted">${esc(p.seq || "—")}</td>
      <td><div class="name-cell">${esc(p.name)}</div><div class="muted" style="font-size:12px">${esc((p.intro || "").slice(0, 40))}</div></td>
      <td class="muted">${esc(p.model || "—")}</td>
      <td class="muted">${esc(p.category_name || "—")}</td>
      <td class="muted">${esc(p.company_name || "—")}</td>
      <td class="price">${fmtPrice(p.market_price)}</td>
      <td class="price">${fmtPrice(p.channel_price)}</td>
      <td>${tags || '<span class="muted">—</span>'}</td>
      <td><div class="file-names">${files || "—"}</div></td>
      <td>${src}</td>
      <td class="time-cell">${time}</td>
      <td><div class="row-actions">
        <a class="link" data-act="view" data-id="${p.id}">查看</a>
        <a class="link" data-act="edit" data-id="${p.id}">编辑</a>
        <a class="link" style="color:var(--danger)" data-act="del" data-id="${p.id}">删除</a>
      </div></td>
    </tr>`;
  }).join("");
  const selAll = $("#product-select-all");
  if (selAll) {
    selAll.checked = items.length > 0 && items.every((p) => productSelected.has(p.id));
  }
  updateSelFloat();
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const box = $("#pagination");
  let html = `<button class="pg" data-pg="1" ${state.page <= 1 ? "disabled" : ""}>«</button>`;
  html += `<button class="pg" data-pg="${state.page - 1}" ${state.page <= 1 ? "disabled" : ""}>‹</button>`;
  html += `<span class="muted" style="padding:0 8px">第 ${state.page} / ${totalPages} 页 · 共 ${state.total} 条</span>`;
  html += `<button class="pg" data-pg="${state.page + 1}" ${state.page >= totalPages ? "disabled" : ""}>›</button>`;
  html += `<button class="pg" data-pg="${totalPages}" ${state.page >= totalPages ? "disabled" : ""}>»</button>`;
  box.innerHTML = html;
}

// ---------- 弹窗 ----------

function openModal(id) {
  $("#overlay").style.display = "block";
  $(id).style.display = "flex";
}
function closeModal() {
  $("#overlay").style.display = "none";
  $$(".modal").forEach((m) => (m.style.display = "none"));
}

function showPrompt(title, placeholder) {
  return new Promise((resolve) => {
    $("#modal-input-title").textContent = title;
    const inp = $("#modal-input-value");
    inp.value = "";
    inp.placeholder = placeholder || "";
    openModal("#modal-input");
    const cleanup = () => {
      $("#modal-input-ok").onclick = null;
      inp.onkeydown = null;
      $("#modal-input").querySelectorAll("[data-close]").forEach((b) => (b.onclick = null));
    };
    const done = () => {
      const v = inp.value.trim();
      cleanup();
      closeModal();
      resolve(v);
    };
    const cancel = () => {
      cleanup();
      closeModal();
      resolve(null);
    };
    $("#modal-input-ok").onclick = done;
    inp.onkeydown = (e) => { if (e.key === "Enter") done(); };
    $("#modal-input").querySelectorAll("[data-close]").forEach((b) => (b.onclick = cancel));
    setTimeout(() => inp.focus(), 50);
  });
}

function showImage(src) {
  $("#modal-img-body").innerHTML = `<img src="${src}" alt="">`;
  openModal("#modal-img");
}

// ---------- 新建 / 编辑 ----------

async function openProductModal(id) {
  const isEdit = !!id;
  $("#modal-product-title").textContent = isEdit ? "编辑产品" : "新建产品";
  let p = null;
  if (isEdit) p = await api("/api/products/" + id);

  const body = $("#modal-product-body");
  body.innerHTML = `
  <div class="form-grid">
    <div class="field"><label>序号</label><input class="input" id="f-seq" value="${isEdit ? esc(p?.seq || "") : "自动生成"}" disabled style="background:#F3F4F6"></div>
    <div class="field"><label class="req">名称</label><input class="input" id="f-name" value="${esc(p?.name || "")}" placeholder="必填"></div>
    <div class="field"><label>型号</label><input class="input" id="f-model" value="${esc(p?.model || "")}"></div>
    <div class="field"><label>产品类型</label>
      <input class="input" id="f-cat" list="dl-cat" placeholder="输入新类型，或选择已有" value="${esc(p?.category_name || "")}">
      <datalist id="dl-cat">${state.categories.map((c) => `<option value="${esc(c.name)}"></option>`).join("")}</datalist>
    </div>
    <div class="field"><label>公司名称</label>
      <input class="input" id="f-com" list="dl-com" placeholder="输入新公司，或选择已有" value="${esc(p?.company_name || "")}">
      <datalist id="dl-com">${state.companies.map((c) => `<option value="${esc(c.name)}"></option>`).join("")}</datalist>
    </div>
    <div class="field"><label>联系方式</label><input class="input" id="f-phone" value="${esc(p?.contact_phone || "")}"></div>
    <div class="field"><label>市场价</label><input class="input" type="number" step="0.01" id="f-mprice" value="${p?.market_price ?? ""}"></div>
    <div class="field"><label>渠道价</label><input class="input" type="number" step="0.01" id="f-cprice" value="${p?.channel_price ?? ""}"></div>
    <div class="field"><label>联系人</label><input class="input" id="f-person" value="${esc(p?.contact_person || "")}"></div>
    <div class="field full"><label>介绍</label><textarea class="textarea" id="f-intro">${esc(p?.intro || "")}</textarea></div>
    <div class="field full"><label>参数</label><textarea class="textarea" id="f-params">${esc(p?.params || "")}</textarea></div>
    <div class="field full"><label>标签</label><div class="tags-picker" id="tag-picker"></div>
      <div class="tag-add"><input class="input" id="new-tag" placeholder="新标签名称"><button class="btn sm" type="button" id="btn-add-tag">添加</button></div></div>
  </div>
  <div class="upload-grid">
    <div class="field">
      <label>产品图片（上传后显示缩略图）</label>
      <div class="upload-zone" id="upload-image">点击选择图片上传（可多选）</div>
      <input type="file" id="file-image" accept="image/*" multiple style="display:none">
      <div class="attach-list" id="image-list"></div>
    </div>
    <div class="field">
      <label>附件（文档等，点击可打开）</label>
      <div class="upload-zone" id="upload-file">点击选择附件上传（可多选）</div>
      <input type="file" id="file-file" multiple style="display:none">
      <div class="attach-list" id="file-list"></div>
    </div>
  </div>
  <div class="modal-footer">
    <button class="btn ghost" data-close>取消</button>
    <button class="btn primary" id="btn-save">保存</button>
  </div>`;

  const selectedTags = new Set(p ? p.tags.map((t) => t.id) : []);
  renderTagPicker(selectedTags);

  if (p) {
    renderImageList(p.attachments.filter((a) => a.kind === "image"));
    renderFileList(p.attachments.filter((a) => a.kind === "file"));
  }

  $("#upload-image").onclick = () => $("#file-image").click();
  $("#upload-file").onclick = () => $("#file-file").click();

  $("#btn-add-tag").onclick = async () => {
    const inp = $("#new-tag");
    const name = inp.value.trim();
    if (!name) return;
    const t = await api("/api/tags", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    state.tags.push(t);
    selectedTags.add(t.id);
    renderTagPicker(selectedTags);
    inp.value = "";
  };

  $("#btn-save").onclick = async () => {
    const payload = {
      seq: $("#f-seq").value.trim(),
      name: $("#f-name").value.trim(),
      model: $("#f-model").value.trim(),
      intro: $("#f-intro").value.trim(),
      params: $("#f-params").value.trim(),
      category_name: $("#f-cat").value.trim(),
      company_name: $("#f-com").value.trim(),
      contact_phone: $("#f-phone").value.trim(),
      contact_person: $("#f-person").value.trim(),
      market_price: $("#f-mprice").value === "" ? null : Number($("#f-mprice").value),
      channel_price: $("#f-cprice").value === "" ? null : Number($("#f-cprice").value),
      tag_ids: [...selectedTags],
    };
    if (!payload.name) { alert("请填写产品名称"); return; }
    let pid = id;
    try {
      if (isEdit) {
        await api("/api/products/" + id, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
      } else {
        const r = await api("/api/products", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
        });
        pid = r.id;
      }
    } catch (e) {
      alert(e.message);
      return;
    }
    await uploadFiles(pid);
    closeModal();
    await loadDicts();
    await loadProducts();
  };

  openModal("#modal-product");
}

async function uploadFiles(pid) {
  const jobs = [
    { input: $("#file-image"), kind: "image" },
    { input: $("#file-file"), kind: "file" },
  ];
  for (const j of jobs) {
    if (j.input && j.input.files.length) {
      const fd = new FormData();
      for (const f of j.input.files) fd.append("files", f);
      await fetch(`/api/products/${pid}/attachments?kind=${j.kind}`, { method: "POST", body: fd });
    }
  }
}

function renderTagPicker(selected) {
  const box = $("#tag-picker");
  if (!state.tags.length) { box.innerHTML = '<span class="muted">暂无标签，可在下方添加</span>'; return; }
  box.innerHTML = state.tags.map((t) =>
    `<span class="chip ${selected.has(t.id) ? "on" : ""}" data-tid="${t.id}">${esc(t.name)}</span>`
  ).join("");
  box.querySelectorAll(".chip").forEach((c) => {
    c.onclick = () => {
      const id = Number(c.dataset.tid);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      c.classList.toggle("on");
    };
  });
}

function renderImageList(images) {
  const box = $("#image-list");
  if (!box) return;
  if (!images.length) return;
  box.innerHTML = images.map((a) => `
    <div class="attach-item">
      <span class="kind-badge kind-image">图片</span>
      <span class="fname">${esc(a.filename)}</span>
      <a class="link" href="/api/attachments/${a.id}/raw" target="_blank">查看</a>
      <a class="link" style="color:var(--danger)" data-rm-att="${a.id}">移除</a>
    </div>`).join("");
  bindRemoveAttach(box);
}

function renderFileList(files) {
  const box = $("#file-list");
  if (!box) return;
  if (!files.length) return;
  box.innerHTML = files.map((a) => `
    <div class="attach-item">
      <span class="kind-badge kind-file">附件</span>
      <span class="fname">${esc(a.filename)}</span>
      <span class="fsize">${(a.size / 1024).toFixed(1)} KB</span>
      <a class="link" href="/api/attachments/${a.id}/download" target="_blank">打开</a>
      <a class="link" style="color:var(--danger)" data-rm-att="${a.id}">移除</a>
    </div>`).join("");
  bindRemoveAttach(box);
}

function bindRemoveAttach(box) {
  box.querySelectorAll("[data-rm-att]").forEach((a) => {
    a.onclick = async () => {
      await api("/api/attachments/" + a.dataset.rmAtt, { method: "DELETE" });
      a.closest(".attach-item").remove();
    };
  });
}

// ---------- 详情 ----------

async function openDetail(id) {
  const p = await api("/api/products/" + id);
  const imgs = (p.attachments || []).filter((a) => a.kind === "image");
  const files = (p.attachments || []).filter((a) => a.kind === "file");
  const gallery = imgs.length
    ? `<div class="img-gallery">${imgs.map((a) =>
        `<img src="/api/attachments/${a.id}/raw" onclick="showImage('/api/attachments/${a.id}/raw')">`).join("")}</div>`
    : '<span class="muted">无图片</span>';
  const fileList = files.length
    ? files.map((a) => `<div class="attach-item">
        <span class="kind-badge kind-file">附件</span>
        <span class="fname">${esc(a.filename)}</span>
        <span class="fsize">${(a.size / 1024).toFixed(1)} KB</span>
        <a class="link" href="/api/attachments/${a.id}/download" target="_blank">打开</a>
      </div>`).join("")
    : '<span class="muted">无附件</span>';

  $("#modal-detail-body").innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><div class="k">序号</div><div class="v">${esc(p.seq || "—")}</div></div>
      <div class="detail-item"><div class="k">名称</div><div class="v" style="font-weight:600">${esc(p.name)}</div></div>
      <div class="detail-item"><div class="k">型号</div><div class="v">${esc(p.model || "—")}</div></div>
      <div class="detail-item"><div class="k">产品类型</div><div class="v">${esc(p.category_name || "—")}</div></div>
      <div class="detail-item"><div class="k">公司名称</div><div class="v">${esc(p.company_name || "—")}</div></div>
      <div class="detail-item"><div class="k">联系方式</div><div class="v">${esc(p.contact_phone || "—")}</div></div>
      <div class="detail-item"><div class="k">市场价</div><div class="v price">${fmtPrice(p.market_price)}</div></div>
      <div class="detail-item"><div class="k">渠道价</div><div class="v price">${fmtPrice(p.channel_price)}</div></div>
      <div class="detail-item"><div class="k">联系人</div><div class="v">${esc(p.contact_person || "—")}</div></div>
      <div class="detail-item"><div class="k">标签</div><div class="v">${(p.tags || []).map((t) => `<span class="tag">${esc(t.name)}</span>`).join("") || "—"}</div></div>
      <div class="detail-item full"><div class="k">介绍</div><div class="v">${esc(p.intro || "—")}</div></div>
      <div class="detail-item full"><div class="k">参数</div><div class="v" style="white-space:pre-wrap">${esc(p.params || "—")}</div></div>
      <div class="detail-item full"><div class="k">图片</div>${gallery}</div>
      <div class="detail-item full"><div class="k">附件</div><div class="attach-list">${fileList}</div></div>
      ${p.source_file_id ? `<div class="detail-item"><div class="k">来源文件</div><div class="v"><a class="link" data-src-file="${p.source_file_id}" data-src-name="${esc(p.source_filename || '')}">${esc(p.source_filename || '查看文件')}</a> <span class="muted" style="font-size:12px">(点击跳转文件库)</span></div></div>` : ''}
      <div class="detail-item"><div class="k">导入时间</div><div class="v muted">${p.created_at || "—"}</div></div>
      <div class="detail-item"><div class="k">更新时间</div><div class="v muted">${p.updated_at || "—"}</div></div>
    </div>`;
  $("#modal-detail").classList.add("wide");
  openModal("#modal-detail");
}

// ---------- 导入导出备份 ----------

function doExport() {
  const f = state.filters;
  window.location.href = "/api/export" + qs(f);
}
function doBackup() {
  window.location.href = "/api/backup";
}

// ---------- 事件绑定 ----------

document.addEventListener("click", async (e) => {
  const actEl = e.target.closest("[data-act]");
  if (actEl) {
    const id = Number(actEl.dataset.id);
    const act = actEl.dataset.act;
    if (act === "view") openDetail(id);
    else if (act === "edit") openProductModal(id);
    else if (act === "del") {
      if (confirm("确定删除该产品？其图片和附件也会一并删除。")) {
        await api("/api/products/" + id, { method: "DELETE" });
        await loadProducts();
      }
    }
    return;
  }
  const rmEl = e.target.closest("[data-cart-remove]");
  if (rmEl) {
    removeFromCart(Number(rmEl.dataset.cartRemove));
    return;
  }
  const srcEl = e.target.closest("[data-src-file]");
  if (srcEl) {
    gotoSourceFile(Number(srcEl.dataset.srcFile), srcEl.dataset.srcName || "");
    return;
  }
  const fpEl = e.target.closest("[data-file-preview]");
  if (fpEl) {
    openFilePreview(Number(fpEl.dataset.filePreview));
    return;
  }
  const fdEl = e.target.closest("[data-file-del]");
  if (fdEl) {
    if (confirm("确定删除该文件？")) {
      await api("/api/files/" + fdEl.dataset.fileDel, { method: "DELETE" });
      await loadFiles();
    }
    return;
  }
  const pg = e.target.closest("[data-pg]");
  if (pg && !pg.disabled) {
    state.page = Number(pg.dataset.pg);
    await loadProducts();
    return;
  }
  if (e.target.closest("[data-close]")) { closeModal(); return; }
});

// 购物车价格输入：抽出共用处理，input/change 都能触发实时统计
function handleCartPriceInput(el) {
  const id = Number(el.dataset.pid);
  const val = el.value;
  if (val === "" || isNaN(Number(val))) {
    delete cartPrices[id];
  } else {
    cartPrices[id] = { ...(cartPrices[id] || {}), market_price: Number(val) };
  }
  saveCartPrices();
  updateCartSummaryFromRows(getCartRows());
}

// input 事件：数字框边输入边更新合计（change 只在失焦/回车时触发）
document.addEventListener("input", (e) => {
  if (e.target.classList && e.target.classList.contains("cart-price-input")) {
    handleCartPriceInput(e.target);
  }
});

document.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("cart-check")) {
    const id = Number(e.target.dataset.id);
    e.target.checked ? cartSelected.add(id) : cartSelected.delete(id);
    // 勾选变化 → 更新底部统计
    updateCartSummaryFromRows(getCartRows());
  } else if (e.target.classList && e.target.classList.contains("cart-price-input")) {
    handleCartPriceInput(e.target);
  } else if (e.target.classList && e.target.classList.contains("product-check")) {
    const id = Number(e.target.dataset.id);
    e.target.checked ? productSelected.add(id) : productSelected.delete(id);
    updateSelFloat();
  } else if (e.target.classList && e.target.classList.contains("file-check")) {
    const id = Number(e.target.dataset.id);
    e.target.checked ? fileSelected.add(id) : fileSelected.delete(id);
  } else if (e.target.id === "cart-select-all") {
    const checks = $$(".cart-check");
    checks.forEach((c) => {
      c.checked = e.target.checked;
      const id = Number(c.dataset.id);
      e.target.checked ? cartSelected.add(id) : cartSelected.delete(id);
    });
    updateCartSummaryFromRows(getCartRows());
  } else if (e.target.id === "product-select-all") {
    const checks = $$(".product-check");
    checks.forEach((c) => {
      c.checked = e.target.checked;
      const id = Number(c.dataset.id);
      e.target.checked ? productSelected.add(id) : productSelected.delete(id);
    });
    updateSelFloat();
  } else if (e.target.id === "file-select-all") {
    const checks = $$(".file-check");
    checks.forEach((c) => {
      c.checked = e.target.checked;
      const id = Number(c.dataset.id);
      e.target.checked ? fileSelected.add(id) : fileSelected.delete(id);
    });
  }
});

$("#tab-home").onclick = () => switchView("home");
$("#tab-products").onclick = () => switchView("products");
$("#tab-cart").onclick = () => switchView("cart");
$("#tab-files").onclick = () => switchView("files");
$("#tab-notes").onclick = () => switchView("notes");
$("#btn-file-upload").onclick = openUploadModal;
$("#btn-folder-new").onclick = newFolder;
$("#btn-files-download").onclick = batchDownloadFiles;
$("#btn-files-move").onclick = batchMoveFiles;
// ---------- 搜索热更新（输入即搜，防抖 350ms） ----------

let searchTimer = null;
function collectFilters() {
  const pfEl = document.querySelector("#price-toggle .pt-btn.on");
  const min = $("#f-price-min").value;
  const max = $("#f-price-max").value;
  return {
    search: $("#q").value.trim(),
    category_id: $("#f-category").value,
    company_id: $("#f-company").value,
    tag_id: $("#f-tag").value,
    price_field: pfEl ? pfEl.dataset.pf : "channel",
    price_min: min === "" ? "" : Number(min),
    price_max: max === "" ? "" : Number(max),
    sort: $("#f-sort").value,
  };
}
function applyFilters() {
  state.filters = collectFilters();
  state.page = 1;
}
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    applyFilters();
    await loadProducts();
  }, 350);
}

let fileSearchTimer = null;
function debounceFileSearch() {
  clearTimeout(fileSearchTimer);
  fileSearchTimer = setTimeout(async () => {
    fileSearch = $("#file-q").value.trim();
    await loadFiles();
  }, 350);
}

$("#btn-search").onclick = async () => {
  clearTimeout(searchTimer);
  applyFilters();
  await loadProducts();
};
$("#btn-reset").onclick = async () => {
  $("#q").value = "";
  $("#f-category").value = $("#f-company").value = $("#f-tag").value = "";
  // 恢复默认：按进货价
  $$("#price-toggle .pt-btn").forEach((b) => b.classList.toggle("on", b.dataset.pf === "channel"));
  $("#f-price-min").value = "";
  $("#f-price-max").value = "";
  $("#f-sort").value = "";
  state.filters = { search: "", category_id: "", company_id: "", tag_id: "", price_field: "channel", price_min: "", price_max: "", sort: "" };
  state.page = 1;
  await loadProducts();
};
// 价格类型切换按钮（进货价/市场价）
$$("#price-toggle .pt-btn").forEach((btn) => {
  btn.onclick = () => {
    if (btn.classList.contains("on")) return;
    $$("#price-toggle .pt-btn").forEach((b) => b.classList.remove("on"));
    btn.classList.add("on");
    debounceSearch();
  };
});
$("#q").oninput = debounceSearch;
$("#f-category").onchange = debounceSearch;
$("#f-company").onchange = debounceSearch;
$("#f-tag").onchange = debounceSearch;
$("#f-price-min").oninput = debounceSearch;
$("#f-price-max").oninput = debounceSearch;
$("#f-sort").onchange = debounceSearch;
$("#q").onkeydown = (e) => { if (e.key === "Enter") $("#btn-search").click(); };
$("#btn-file-search").onclick = async () => {
  clearTimeout(fileSearchTimer);
  fileSearch = $("#file-q").value.trim();
  await loadFiles();
};
$("#btn-file-reset").onclick = async () => {
  $("#file-q").value = "";
  fileSearch = "";
  await loadFiles();
};
$("#file-q").oninput = debounceFileSearch;
$("#file-q").onkeydown = (e) => { if (e.key === "Enter") $("#btn-file-search").click(); };

$("#btn-cart-export").onclick = exportCart;
$("#btn-cart-reset").onclick = resetCartPrices;
$("#btn-cart-clear").onclick = () => {
  const proj = getProject(currentProject);
  if (!proj || !proj.ids.length) return;
  if (confirm(`确定清空项目「${currentProject}」？不会删除产品数据。`)) {
    proj.ids = [];
    cartSelected.clear();
    saveCart();
    renderCart();
  }
};
$("#btn-batch-cart").onclick = () => {
  const ids = [...productSelected];
  if (!ids.length) { alert("请先勾选产品（列表左侧勾选框）"); return; }
  openCartAddModal(ids);
};

// ---------- 产品勾选浮动操作条(固定底部,不随页面滚动) ----------
function updateSelFloat() {
  const box = document.getElementById("sel-float");
  const n = document.getElementById("sel-float-n");
  if (!box) return;
  const inProducts = document.getElementById("view-products")?.style.display !== "none";
  const cnt = productSelected.size;
  if (cnt > 0 && inProducts) {
    box.style.display = "flex";
    if (n) n.textContent = String(cnt);
  } else {
    box.style.display = "none";
  }
}

const floatCart = document.getElementById("btn-float-cart");
if (floatCart) floatCart.onclick = () => {
  const ids = [...productSelected];
  if (!ids.length) { alert("请先勾选产品"); return; }
  openCartAddModal(ids);
};
const floatClear = document.getElementById("btn-float-clear");
if (floatClear) floatClear.onclick = () => {
  productSelected.clear();
  document.querySelectorAll(".product-check").forEach((c) => (c.checked = false));
  const all = document.getElementById("product-select-all");
  if (all) all.checked = false;
  updateSelFloat();
};

$("#btn-add").onclick = () => openProductModal(null);
$("#btn-export").onclick = doExport;
$("#btn-backup").onclick = doBackup;
$("#btn-template").onclick = () => (window.location.href = "/api/export/template");
$("#btn-import").onclick = () => $("#file-import").click();
$("#file-import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await api("/api/import", { method: "POST", body: fd });
    alert(`导入完成：成功 ${r.created} 条` + (r.errors.length ? `\n失败 ${r.errors.length} 条：\n${r.errors.slice(0, 5).join("\n")}` : ""));
    await loadDicts();
    await loadProducts();
  } catch (err) {
    alert("导入失败：" + err.message);
  }
  e.target.value = "";
};

$("#overlay").onclick = closeModal;

// ---------- 备忘录（仅本机浏览器可见，localStorage 持久化） ----------

let notes = loadNotes();
let currentNoteBook = "all";

function loadNotes() {
  try {
    const raw = localStorage.getItem("notes");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.books)) return parsed;
    }
  } catch (e) {}
  return { books: [{ name: "默认备忘本", items: [] }] };
}

function saveNotes() {
  localStorage.setItem("notes", JSON.stringify(notes));
  const total = notes.books.reduce((s, b) => s + b.items.filter((i) => !i.done).length, 0);
  const badge = $("#notes-badge");
  badge.textContent = total;
  badge.style.display = total > 0 ? "inline-block" : "none";
}

function getNoteBook(name) {
  return notes.books.find((b) => b.name === name);
}

function renderNotes() {
  renderNoteBookBar();
  renderNoteCards();
}

function renderNoteBookBar() {
  const bar = $("#note-book-bar");
  const totalCount = notes.books.reduce((s, b) => s + b.items.length, 0);
  let html = `<span class="folder-chip ${currentNoteBook === "all" ? "on" : ""}" data-nbook="all">全部 (${totalCount})</span>`;
  html += notes.books.map((b) => {
    const delBtn = notes.books.length > 1
      ? `<span class="chip-del" data-nbook-del="${esc(b.name)}" title="删除备忘本（含全部备忘）">×</span>` : "";
    return `<span class="folder-chip ${currentNoteBook === b.name ? "on" : ""}" data-nbook="${esc(b.name)}">${esc(b.name)} (${b.items.length}) ${delBtn}</span>`;
  }).join("");
  bar.innerHTML = html;
  bar.querySelectorAll("[data-nbook]").forEach((c) => {
    c.onclick = (e) => {
      if (e.target.closest("[data-nbook-del]")) return;
      currentNoteBook = c.dataset.nbook;
      renderNotes();
    };
  });
  bar.querySelectorAll("[data-nbook-del]").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const name = btn.dataset.nbookDel;
      const nb = getNoteBook(name);
      if (!nb) return;
      if (!confirm(`删除备忘本「${name}」？里面 ${nb.items.length} 条备忘将一并删除，无法恢复。`)) return;
      notes.books = notes.books.filter((b) => b.name !== name);
      if (currentNoteBook === name) currentNoteBook = "all";
      saveNotes();
      renderNotes();
    };
  });
}

function noteScopeItems() {
  const books = currentNoteBook === "all" ? notes.books : (getNoteBook(currentNoteBook) ? [getNoteBook(currentNoteBook)] : []);
  const out = [];
  for (const b of books) {
    for (const it of b.items) out.push({ ...it, book: b.name });
  }
  return out;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function renderNoteCards() {
  const grid = $("#notes-grid");
  const kw = ($("#note-q").value || "").trim().toLowerCase();
  const filter = $("#note-filter").value;
  const today = todayStr();
  let items = noteScopeItems();
  if (kw) items = items.filter((i) => (i.text || "").toLowerCase().includes(kw));
  if (filter === "todo") items = items.filter((i) => !i.done);
  else if (filter === "done") items = items.filter((i) => i.done);
  else if (filter === "today") items = items.filter((i) => !i.done && i.due === today);
  else if (filter === "overdue") items = items.filter((i) => !i.done && i.due && i.due < today);
  // 排序：置顶 > 紧急 > 重要 > 未完成 > 截止日期 > 创建时间
  const prio = { urgent: 0, high: 1, normal: 2 };
  items.sort((a, b) => {
    if (!!a.pin !== !!b.pin) return a.pin ? -1 : 1;
    if (a.done !== b.done) return a.done ? 1 : -1;
    if ((prio[a.priority] ?? 2) !== (prio[b.priority] ?? 2)) return (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2);
    if ((a.due || "9999") !== (b.due || "9999")) return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
    return (b.created_at || "") < (a.created_at || "") ? -1 : 1;
  });

  $("#notes-empty").style.display = items.length ? "none" : "block";
  grid.innerHTML = items.map((it) => {
    const today = todayStr();
    let duePill = "";
    if (it.due) {
      if (it.done) duePill = `<span class="note-pill">截止 ${it.due}</span>`;
      else if (it.due < today) duePill = `<span class="note-pill due">已逾期 ${it.due}</span>`;
      else if (it.due === today) duePill = `<span class="note-pill due-today">今日到期</span>`;
      else duePill = `<span class="note-pill">截止 ${it.due}</span>`;
    }
    const remindPill = it.remind ? `<span class="note-pill">⏰ ${it.remind}</span>` : "";
    const prioPill = it.priority && it.priority !== "normal"
      ? `<span class="note-pill prio ${it.priority}">${it.priority === "urgent" ? "紧急" : "重要"}</span>` : "";
    return `
    <div class="note-card ${it.priority || "normal"} ${it.done ? "done" : ""}" data-nid="${it.id}">
      ${it.pin ? '<span class="note-pin">📌</span>' : ""}
      <div class="note-actions">
        <button data-note-pin title="${it.pin ? "取消置顶" : "置顶"}">${it.pin ? "✕" : "📌"}</button>
        <button data-note-edit title="编辑">✎</button>
        <button class="del" data-note-del title="删除">🗑</button>
      </div>
      <div class="note-top">
        <input type="checkbox" class="note-check" data-note-check ${it.done ? "checked" : ""}>
        <div class="note-text" data-note-edit>${esc(it.text)}</div>
      </div>
      <div class="note-meta">
        ${prioPill}${duePill}${remindPill}
        <span class="note-pill">📔 ${esc(it.book)}</span>
        <span class="note-pill">${(it.created_at || "").slice(0, 10)}</span>
      </div>
    </div>`;
  }).join("");
}

let noteEditingId = null;

function openNoteModal(item) {
  noteEditingId = item ? item.id : null;
  $("#modal-note-title").textContent = item ? "编辑备忘" : "新建备忘";
  const sel = $("#note-book");
  sel.innerHTML = notes.books.map((b) => `<option value="${esc(b.name)}">${esc(b.name)}</option>`).join("");
  $("#note-text").value = item ? item.text : "";
  $("#note-priority").value = item ? (item.priority || "normal") : "normal";
  $("#note-due").value = item ? (item.due || "") : "";
  $("#note-remind").value = item ? (item.remind || "") : "";
  if (item) sel.value = item.book;
  openModal("#modal-note");
  setTimeout(() => $("#note-text").focus(), 60);
}

$("#btn-note-new").onclick = () => openNoteModal(null);

$("#btn-note-book-new").onclick = async () => {
  const name = await showPrompt("新建备忘本", "请输入备忘本名称");
  if (!name) return;
  if (getNoteBook(name)) { alert("备忘本已存在"); return; }
  notes.books.push({ name, items: [] });
  currentNoteBook = name;
  saveNotes();
  renderNotes();
};

$("#btn-note-save").onclick = () => {
  const text = $("#note-text").value.trim();
  if (!text) { alert("请填写备忘内容"); return; }
  const bookName = $("#note-book").value || notes.books[0].name;
  const data = {
    text,
    priority: $("#note-priority").value,
    due: $("#note-due").value || "",
    remind: $("#note-remind").value || "",
  };
  if (noteEditingId) {
    // 编辑：可能在原备忘本，也可能移动到所选备忘本
    for (const b of notes.books) {
      const idx = b.items.findIndex((i) => i.id === noteEditingId);
      if (idx >= 0) {
        const it = b.items[idx];
        Object.assign(it, data);
        if (b.name !== bookName) {
          b.items.splice(idx, 1);
          const target = getNoteBook(bookName);
          if (target) target.items.push(it);
        }
        break;
      }
    }
  } else {
    const nb = getNoteBook(bookName);
    if (!nb) { alert("备忘本不存在"); return; }
    nb.items.push({
      id: Date.now(),
      created_at: new Date().toLocaleString("sv-SE").replace("T", " "),
      pin: false,
      done: false,
      ...data,
    });
  }
  saveNotes();
  closeModal();
  renderNotes();
};

// 备忘卡片事件（事件委托）
$("#notes-grid").addEventListener("click", (e) => {
  const card = e.target.closest("[data-nid]");
  if (!card) return;
  const id = Number(card.dataset.nid);
  // 找到备忘（跨本）
  let found = null, foundBook = null;
  for (const b of notes.books) {
    const it = b.items.find((i) => i.id === id);
    if (it) { found = it; foundBook = b; break; }
  }
  if (!found) return;
  if (e.target.matches("[data-note-check]")) {
    found.done = e.target.checked;
    saveNotes();
    renderNoteCards();
  } else if (e.target.closest("[data-note-del]")) {
    if (!confirm("删除这条备忘？")) return;
    foundBook.items = foundBook.items.filter((i) => i.id !== id);
    saveNotes();
    renderNotes();
  } else if (e.target.closest("[data-note-pin]")) {
    found.pin = !found.pin;
    saveNotes();
    renderNoteCards();
  } else if (e.target.closest("[data-note-edit]")) {
    openNoteModal(found);
  }
});

// 搜索与筛选（热更新）
$("#note-q").addEventListener("input", renderNoteCards);
$("#note-filter").addEventListener("change", renderNoteCards);

// 导出备份
$("#btn-note-export").onclick = () => {
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `备忘录备份_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

// 导入备份
$("#btn-note-import").onclick = () => $("#note-import-file").click();
$("#note-import-file").onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.books)) { alert("备份文件格式不正确"); return; }
      if (!confirm("导入将覆盖当前所有备忘，确定继续？")) return;
      notes = data;
      currentNoteBook = "all";
      saveNotes();
      renderNotes();
      alert("导入成功");
    } catch (err) {
      alert("文件解析失败：" + err.message);
    }
  };
  reader.readAsText(f);
  e.target.value = "";
};

// ---------- 启动 ----------

// 欢迎页：自动关闭（可点击任意处提前进入）
function dismissSplash() {
  const sp = $("#splash");
  if (!sp || sp.classList.contains("hide")) return;
  sp.classList.add("hide");
  setTimeout(() => sp.remove(), 700);
}

(async function init() {
  saveCart();
  saveNotes();
  await loadDicts();
  await renderHome();
  await loadProducts();
  // 欢迎动画播完后淡出进入系统
  setTimeout(dismissSplash, 2900);
})();

// ================= AI 助手(浮动工具栏) =================
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fab = document.getElementById("ai-fab");
  const panel = document.getElementById("ai-panel");
  if (!fab || !panel) return;

  let aiItems = [];
  let confirmQueue = [];
  let confirmIdx = 0;
  let curEditor = null;

  $$(".ai-tab").forEach((t) => t.onclick = () => {
    $$(".ai-tab").forEach((x) => x.classList.toggle("on", x === t));
    $$(".ai-page").forEach((p) => p.style.display = (p.dataset.aipage === t.dataset.aitab) ? "block" : "none");
  });
  const xBtn = document.getElementById("ai-x");
  if (xBtn) xBtn.onclick = () => panel.style.display = "none";
  fab.onclick = () => {
    const show = panel.style.display !== "block";
    panel.style.display = show ? "flex" : "none";
    if (show) loadAiCfg();
  };

  async function loadAiCfg() {
    try {
      const c = await api("/api/ai/config");
      const keyInp = document.getElementById("ai-key");
      if (c.key_masked) {
        keyInp.placeholder = "已配置:" + c.key_masked + "(留空不修改)";
        keyInp.value = "";
      }
      document.getElementById("ai-base").value = c.base_url || "https://api.deepseek.com";
      document.getElementById("ai-model").value = c.model || "deepseek-chat";
      document.getElementById("ai-cfg-msg").textContent = c.configured ? "✓ 已配置 " + c.key_masked : "尚未配置 Key,请在下方填写";
      const dot = document.getElementById("ai-fab-dot");
      if (dot) dot.style.display = c.configured ? "none" : "block";
    } catch (e) { document.getElementById("ai-cfg-msg").textContent = "读取配置失败:" + e.message; }
  }

  const saveCfg = document.getElementById("ai-save-cfg");
  if (saveCfg) saveCfg.onclick = async () => {
    const body = {
      api_key: document.getElementById("ai-key").value.trim(),
      base_url: document.getElementById("ai-base").value.trim(),
      model: document.getElementById("ai-model").value,
    };
    if (!body.api_key && !document.getElementById("ai-key").placeholder.includes("已配置")) {
      document.getElementById("ai-cfg-msg").textContent = "请填写 API Key"; return;
    }
    try {
      await api("/api/ai/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      document.getElementById("ai-cfg-msg").textContent = "✓ 已保存";
      loadAiCfg();
    } catch (e) { document.getElementById("ai-cfg-msg").textContent = "保存失败:" + e.message; }
  };

  const testCfg = document.getElementById("ai-test-cfg");
  if (testCfg) testCfg.onclick = async () => {
    document.getElementById("ai-cfg-msg").textContent = "测试中…";
    const body = {
      api_key: document.getElementById("ai-key").value.trim() || null,
      base_url: document.getElementById("ai-base").value.trim(),
      model: document.getElementById("ai-model").value,
    };
    try {
      const r = await api("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      document.getElementById("ai-cfg-msg").textContent = r.ok ? "✓ 连接成功:" + String(r.reply || "").slice(0, 20) : "✗ " + (r.error || "失败");
    } catch (e) { document.getElementById("ai-cfg-msg").textContent = "测试异常:" + e.message; }
  };

  const drop = document.getElementById("ai-drop");
  const fileInp = document.getElementById("ai-file");
  drop.onclick = () => fileInp.click();
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("on"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("on"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) runAnalyze(f); });
  fileInp.onchange = () => { if (fileInp.files[0]) runAnalyze(fileInp.files[0]); fileInp.value = ""; };

  async function runAnalyze(file) {
    if (file.size > 30 * 1024 * 1024) { alert("文件过大(>30MB)"); return; }
    const prog = document.getElementById("ai-progress");
    const resBox = document.getElementById("ai-result");
    prog.style.display = "block";
    resBox.innerHTML = "";
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/ai/analyze", { method: "POST", body: fd });
      if (!res.ok) {
        let m = "分析失败(" + res.status + ")";
        try { const j = await res.json(); m = j.detail || m; } catch (e2) {}
        resBox.innerHTML = '<div class="muted" style="color:#dc2626">⚠️ ' + esc(m) + "</div>";
        prog.style.display = "none";
        return;
      }
      const data = await res.json();
      aiItems = data.items || [];
      prog.style.display = "none";
      if (!aiItems.length) { resBox.innerHTML = '<div class="muted">未识别到产品,请确认文件是产品清单。</div>'; return; }
      renderAiResult();
      confirmQueue = aiItems.filter((it) => !it.confident);
      if (confirmQueue.length) startConfirm();
    } catch (e) {
      prog.style.display = "none";
      resBox.innerHTML = '<div class="muted" style="color:#dc2626">⚠️ ' + esc(e.message || e) + "</div>";
    }
  }

  function renderAiResult() {
    const ok = aiItems.filter((i) => i.confident).length;
    const warn = aiItems.length - ok;
    const box = document.getElementById("ai-result");
    let html = '<div class="ai-result-sum">共识别 <b>' + aiItems.length + "</b> 个产品(确定 " + ok + " / 待确认 " + warn + ")" + (warn ? " — 将逐个弹窗确认" : "") + "</div>";
    html += aiItems.map((it, i) => {
      const badge = it.confident ? "✅" : "⚠️";
      const cls = it.confident ? "ok" : "warn";
      const btn = it.confident ? "" : '<button class="btn ghost" style="padding:2px 8px" data-aiedit="' + i + '">确认</button>';
      return '<div class="ai-item-card ' + cls + '"><span>' + badge + '</span><span class="nm" title="' + esc(it.name) + '">' + esc(it.name) + '</span><span class="muted">' + esc(it.model || "") + "</span>" + btn + "</div>";
    }).join("");
    box.innerHTML = html;
    box.querySelectorAll("[data-aiedit]").forEach((b) => b.onclick = () => {
      const i = Number(b.dataset.aiedit);
      confirmQueue = [aiItems[i]];
      confirmIdx = 0;
      startConfirm();
    });
  }

  function startConfirm() {
    if (!confirmQueue.length) return;
    confirmIdx = 0;
    openConfirmModal();
  }

  function openConfirmModal() {
    const it = confirmQueue[confirmIdx];
    curEditor = it;
    document.getElementById("ai-conf-idx").textContent = "第 " + (confirmIdx + 1) + " / " + confirmQueue.length + " 条(⚠️ AI 拿捏不准,请核对)";
    document.getElementById("ai-c-name").value = it.name || "";
    document.getElementById("ai-c-model").value = it.model || "";
    document.getElementById("ai-c-cat").value = it.category || "";
    document.getElementById("ai-c-tags").value = (it.tags || []).join(", ");
    document.getElementById("ai-c-company").value = it.company || "";
    document.getElementById("ai-c-mp").value = it.market_price ?? "";
    document.getElementById("ai-c-cp").value = it.channel_price ?? "";
    document.getElementById("ai-c-intro").value = it.intro || "";
    document.getElementById("ai-c-params").value = it.params || "";
    const unsure = [];
    if (!it.name) unsure.push("名称缺失");
    if (!it.model) unsure.push("型号未识别");
    if (!it.category) unsure.push("类型未识别");
    if (!it.company) unsure.push("厂商未识别");
    if (!it.market_price && !it.channel_price) unsure.push("价格缺失");
    const uBox = document.getElementById("ai-c-uncertain");
    uBox.style.display = unsure.length ? "block" : "none";
    uBox.textContent = "AI 可能拿不准:" + unsure.join("、") + " — 请核对/补充后点「保存此产品」;也可「下一个」跳过。";
    document.getElementById("ai-c-prev").disabled = confirmIdx <= 0;
    openModal("#modal-ai-confirm");
  }

  const btnPrev = document.getElementById("ai-c-prev");
  const btnNext = document.getElementById("ai-c-next");
  const btnSkip = document.getElementById("ai-c-skip");
  const btnSave = document.getElementById("ai-c-save");
  if (btnPrev) btnPrev.onclick = () => { if (confirmIdx > 0) { confirmIdx--; openConfirmModal(); } };
  if (btnNext) btnNext.onclick = () => {
    if (confirmIdx < confirmQueue.length - 1) { confirmIdx++; openConfirmModal(); }
    else { alert("已是最后一条;可点「保存此产品」入库,或「上一个」回看"); }
  };
  if (btnSkip) btnSkip.onclick = () => {
    closeModal();
    const box = document.getElementById("ai-result");
    box.innerHTML += '<div class="muted" style="margin-top:6px">已跳过待确认项,可在结果中点「确认」逐个处理。</div>';
  };
  if (btnSave) btnSave.onclick = async () => {
    const payload = {
      name: document.getElementById("ai-c-name").value.trim(),
      model: document.getElementById("ai-c-model").value.trim(),
      category: document.getElementById("ai-c-cat").value.trim(),
      tags: document.getElementById("ai-c-tags").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      company: document.getElementById("ai-c-company").value.trim(),
      market_price: document.getElementById("ai-c-mp").value === "" ? null : Number(document.getElementById("ai-c-mp").value),
      channel_price: document.getElementById("ai-c-cp").value === "" ? null : Number(document.getElementById("ai-c-cp").value),
      intro: document.getElementById("ai-c-intro").value.trim(),
      params: document.getElementById("ai-c-params").value.trim(),
    };
    if (!payload.name) { alert("请填写产品名称"); return; }
    try {
      await api("/api/products", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          name: payload.name, model: payload.model, category_name: payload.category,
          company_name: payload.company, tag_ids: [], market_price: payload.market_price,
          channel_price: payload.channel_price, intro: payload.intro, params: payload.params,
        }),
      });
      const done = curEditor;
      confirmQueue = confirmQueue.filter((x) => x !== done);
      aiItems = aiItems.map((x) => (x === done ? Object.assign({}, x, { confident: true, _saved: true }) : x));
      renderAiResult();
      if (confirmQueue.length) openConfirmModal();
      else { closeModal(); alert("✅ 全部确认完成!"); await loadProducts(); }
    } catch (e) { alert("保存失败:" + e.message); }
  };
})();

// 回到顶部
(function () {
  const btn = document.getElementById("btn-top");
  if (!btn) return;
  window.addEventListener("scroll", () => {
    btn.style.display = (document.documentElement.scrollTop || document.body.scrollTop) > 400 ? "flex" : "none";
  }, { passive: true });
  btn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
})();
