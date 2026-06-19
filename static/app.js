// ─── 全局状态 ─────────────────────────────────────────────

let sessionId = localStorage.getItem("session_id") || null;
let currentPhone = localStorage.getItem("phone") || null;
let deleteTargetId = null;

// 分页状态：待办、已过期和已完成各自独立
let pendingPage = 1;
let expiredPage = 1;
let donePage = 1;
let pendingTotalPages = 1;
let expiredTotalPages = 1;
let doneTotalPages = 1;
let perPage = 3;

// 当前排序和筛选
let currentSort = "created";
let currentCategory = "全部";
let currentSearch = "";

// 统计（全量数据）
let totalCount = 0;
let pendingCount = 0;
let expiredCount = 0;
let doneCount = 0;

const $ = (sel) => document.querySelector(sel);
const viewLogin = $("#view-login");
const viewRegister = $("#view-register");
const viewMain = $("#view-main");

// ─── 初始化 ───────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    bindNavigation();
    bindForms();
    bindLogout();
    bindModal();
    bindSearch();
    bindSortTabs();
    bindCategoryFilter();
    bindAdvancedToggle();
    bindStarRating();

    if (sessionId) {
        checkSession();
    } else {
        showView("login");
    }
});

// ─── 页面切换 ─────────────────────────────────────────────

function showView(name) {
    viewLogin.classList.toggle("hidden", name !== "login");
    viewRegister.classList.toggle("hidden", name !== "register");
    viewMain.classList.toggle("hidden", name !== "main");
}

function bindNavigation() {
    $("#go-register").addEventListener("click", (e) => { e.preventDefault(); showView("register"); });
    $("#go-login").addEventListener("click", (e) => { e.preventDefault(); showView("login"); });
}

// ─── API 请求 ─────────────────────────────────────────────

async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...options.headers };
    if (sessionId) headers["X-Session-Id"] = sessionId;
    const resp = await fetch(`/api${path}`, { ...options, headers });
    return resp.json();
}

// ─── Toast ────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, type = "info") {
    const el = $("#toast");
    el.textContent = msg;
    el.className = `toast ${type}`;
    void el.offsetWidth;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ─── 表单绑定 ─────────────────────────────────────────────

function bindForms() {
    // 登录
    $("#form-login").addEventListener("submit", async (e) => {
        e.preventDefault();
        const phone = $("#login-phone").value.trim();
        const password = $("#login-password").value.trim();
        const data = await api("/login", { method: "POST", body: JSON.stringify({ phone, password }) });
        if (data.success) {
            sessionId = data.data;
            currentPhone = phone;
            localStorage.setItem("session_id", sessionId);
            localStorage.setItem("phone", phone);
            showToast("登录成功，欢迎回来！", "success");
            enterMainView();
        } else {
            showToast(data.message, "error");
        }
    });

    // 注册
    $("#form-register").addEventListener("submit", async (e) => {
        e.preventDefault();
        const phone = $("#reg-phone").value.trim();
        const password = $("#reg-password").value.trim();
        const password2 = $("#reg-password2").value.trim();
        if (password !== password2) { showToast("两次密码输入不一致", "error"); return; }
        const data = await api("/register", { method: "POST", body: JSON.stringify({ phone, password }) });
        if (data.success) {
            showToast("注册成功，请登录！", "success");
            showView("login");
            $("#login-phone").value = phone;
        } else {
            showToast(data.message, "error");
        }
    });

    // 添加任务
    $("#form-add-task").addEventListener("submit", async (e) => {
        e.preventDefault();
        const title = $("#task-title").value.trim();
        if (!title) return;

        const startDate = $("#task-start-date").value || "";
        const deadline = $("#task-deadline").value || "";

        if (startDate && deadline && new Date(startDate) > new Date(deadline)) {
            showToast("开始日期不能晚于截止日期", "error");
            return;
        }

        const body = {
            title,
            description: $("#task-desc").value.trim(),
            category: $("#task-category").value,
            star_rating: parseInt($("#task-star-rating").value) || 0,
            start_date: startDate,
            deadline: deadline,
        };

        const data = await api("/tasks", { method: "POST", body: JSON.stringify(body) });
        if (data.success) {
            $("#task-title").value = "";
            $("#task-desc").value = "";
            $("#task-category").value = "其他";
            $("#task-star-rating").value = "0";
            $("#task-start-date").value = "";
            $("#task-deadline").value = "";
            resetStarRating("star-rating-create");
            showToast("任务添加成功！", "success");
            pendingPage = 1;
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
    });
}

// ─── 退出登录 ─────────────────────────────────────────────

function bindLogout() {
    $("#btn-logout").addEventListener("click", async () => {
        await api("/logout", { method: "POST" });
        sessionId = null; currentPhone = null;
        localStorage.removeItem("session_id"); localStorage.removeItem("phone");
        showView("login");
        showToast("已退出登录");
    });
}

// ─── 删除弹窗 ─────────────────────────────────────────────

function bindModal() {
    $("#modal-cancel").addEventListener("click", () => {
        $("#modal-overlay").classList.add("hidden");
        deleteTargetId = null;
    });
    $("#modal-confirm").addEventListener("click", async () => {
        if (!deleteTargetId) return;
        $("#modal-overlay").classList.add("hidden");
        const data = await api(`/tasks/${deleteTargetId}`, { method: "DELETE" });
        if (data.success) {
            showToast("任务已删除", "success");
            loadAllData();
        } else {
            showToast(data.message, "error");
        }
        deleteTargetId = null;
    });
}

// ─── 搜索 ─────────────────────────────────────────────────

function bindSearch() {
    let timer = null;
    $("#search-input").addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            currentSearch = $("#search-input").value.trim();
            pendingPage = 1; donePage = 1;
            loadAllData();
        }, 300);
    });
}

// ─── 分类筛选 ─────────────────────────────────────────────

function bindCategoryFilter() {
    $("#filter-category").addEventListener("change", () => {
        currentCategory = $("#filter-category").value;
        pendingPage = 1; donePage = 1;
        loadAllData();
    });
}

// ─── 排序标签 ─────────────────────────────────────────────

function bindSortTabs() {
    document.querySelectorAll(".sort-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".sort-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentSort = tab.dataset.sort;
            pendingPage = 1; donePage = 1;
            loadAllData();
        });
    });
}

// ─── 高级选项展开 ─────────────────────────────────────────

function bindAdvancedToggle() {
    $("#btn-toggle-advanced").addEventListener("click", () => {
        const panel = $("#advanced-panel");
        const chevron = $("#chevron-adv");
        panel.classList.toggle("hidden");
        chevron.classList.toggle("rotated");
    });
}

// ─── 星级评分 ─────────────────────────────────────────────

function bindStarRating() {
    setupStarGroup("star-rating-create", "task-star-rating");
}

function setupStarGroup(containerId, inputId) {
    const container = $(`#${containerId}`);
    if (!container) return;
    const stars = container.querySelectorAll(".star");
    stars.forEach(star => {
        star.addEventListener("click", () => {
            const val = parseInt(star.dataset.val);
            const input = $(`#${inputId}`);
            const currentVal = parseInt(input.value);
            // 点击相同星级取消选择
            if (currentVal === val) {
                input.value = "0";
                resetStarRating(containerId);
            } else {
                input.value = val;
                updateStarDisplay(containerId, val);
            }
        });
    });
}

function updateStarDisplay(containerId, val) {
    const container = $(`#${containerId}`);
    container.querySelectorAll(".star").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.val) <= val);
    });
}

function resetStarRating(containerId) {
    const container = $(`#${containerId}`);
    if (!container) return;
    container.querySelectorAll(".star").forEach(s => s.classList.remove("active"));
}

// ─── 会话检查 ─────────────────────────────────────────────

async function checkSession() {
    const data = await api("/session");
    if (data.success) {
        currentPhone = data.data;
        enterMainView();
    } else {
        sessionId = null;
        localStorage.removeItem("session_id");
        showView("login");
    }
}

function enterMainView() {
    showView("main");
    $("#display-phone").textContent = currentPhone;
    loadAllData();
}

// ─── 加载数据 ─────────────────────────────────────────────

async function loadAllData() {
    // 加载待办（第N页）
    const pendingParams = buildQueryParams("pending");
    const pendingData = await api(`/tasks?${pendingParams}`);

    // 加载已完成（第N页）
    const doneParams = buildQueryParams("done");
    const doneData = await api(`/tasks?${doneParams}`);

    // 加载全量统计（不带分页，只取计数）
    const allParams = new URLSearchParams({
        sort_by: "created",
        category: currentCategory,
        search: currentSearch,
        page: 1,
        per_page: 9999,
    });
    const allData = await api(`/tasks?${allParams}`);

    if (allData.success) {
        const allTasks = allData.data.items || [];
        totalCount = allTasks.length;
        pendingCount = allTasks.filter(t => !t.completed).length;
        doneCount = allTasks.filter(t => t.completed).length;
    }

    // 更新统计
    $("#stat-total").textContent = totalCount;
    $("#stat-pending").textContent = pendingCount;
    $("#stat-done").textContent = doneCount;
    $("#badge-pending").textContent = pendingCount;
    $("#badge-done").textContent = doneCount;

    // 渲染待办列表
    if (pendingData.success) {
        const d = pendingData.data;
        pendingTotalPages = d.total_pages;
        renderTaskList("list-pending", "empty-pending", d.items, false, pendingCount);
        renderPagination("pagination-pending", pendingPage, pendingTotalPages, "pending");
    }

    // 渲染已完成列表
    if (doneData.success) {
        const d = doneData.data;
        doneTotalPages = d.total_pages;
        renderTaskList("list-done", "empty-done", d.items, true, doneCount);
        renderPagination("pagination-done", donePage, doneTotalPages, "done");
    }

    // 全空大提示
    const grandEmpty = $("#grand-empty");
    if (totalCount === 0 && !currentSearch && currentCategory === "全部") {
        grandEmpty.classList.remove("hidden");
    } else {
        grandEmpty.classList.add("hidden");
    }
}

function buildQueryParams(listType) {
    const params = new URLSearchParams({
        sort_by: currentSort,
        category: currentCategory,
        search: currentSearch,
        per_page: perPage,
    });

    if (listType === "pending") {
        params.set("page", pendingPage);
        // 对于待办列表，需要在前端过滤（后端返回混合的，我们靠前端过滤）
        // 但我们已经在后端加了分页，所以需要用一个技巧：加载全部然后前端过滤分页
        // 实际上后端不区分已完成/未完成，所以我们先用大per_page，前端过滤后分页
        params.set("per_page", 9999);
    } else {
        params.set("page", 1);
        params.set("per_page", 9999);
    }

    return params.toString();
}

// 重新设计：后端不区分已完成/未完成，前端拿到全部后过滤分页
// 为了避免每次请求太多数据，我们优化为一次请求全部，前端处理分页

async function loadAllDataOptimized() {
    const params = new URLSearchParams({
        sort_by: currentSort,
        category: currentCategory,
        search: currentSearch,
        page: 1,
        per_page: 9999,
    });

    const data = await api(`/tasks?${params}`);
    if (!data.success) {
        showToast(data.message, "error");
        return;
    }

    const allTasks = data.data.items || [];
    const expiredTasks = allTasks.filter(t => isTaskExpired(t));
    const pendingTasks = allTasks.filter(t => !t.completed && !isTaskExpired(t));
    const doneTasks = allTasks.filter(t => t.completed);

    totalCount = allTasks.length;
    pendingCount = pendingTasks.length;
    expiredCount = expiredTasks.length;
    doneCount = doneTasks.length;

    // 更新统计
    $("#stat-total").textContent = totalCount;
    $("#stat-pending").textContent = pendingCount;
    $("#stat-done").textContent = doneCount;
    $("#badge-pending").textContent = pendingCount;
    $("#badge-expired").textContent = expiredCount;
    $("#badge-done").textContent = doneCount;

    // 分页切片
    pendingTotalPages = Math.max(1, Math.ceil(pendingCount / perPage));
    expiredTotalPages = Math.max(1, Math.ceil(expiredCount / perPage));
    doneTotalPages = Math.max(1, Math.ceil(doneCount / perPage));

    if (pendingPage > pendingTotalPages) pendingPage = pendingTotalPages;
    if (expiredPage > expiredTotalPages) expiredPage = expiredTotalPages;
    if (donePage > doneTotalPages) donePage = doneTotalPages;

    const pendingSlice = paginate(pendingTasks, pendingPage, perPage);
    const expiredSlice = paginate(expiredTasks, expiredPage, perPage);
    const doneSlice = paginate(doneTasks, donePage, perPage);

    renderTaskList("list-pending", "empty-pending", pendingSlice, false, pendingCount);
    renderExpiredList("list-expired", expiredSlice, expiredCount);
    renderTaskList("list-done", "empty-done", doneSlice, true, doneCount);

    renderPagination("pagination-pending", pendingPage, pendingTotalPages, "pending");
    renderPagination("pagination-expired", expiredPage, expiredTotalPages, "expired");
    renderPagination("pagination-done", donePage, doneTotalPages, "done");

    // 全空提示
    const grandEmpty = $("#grand-empty");
    if (totalCount === 0 && !currentSearch && currentCategory === "全部") {
        grandEmpty.classList.remove("hidden");
    } else {
        grandEmpty.classList.add("hidden");
    }
}

// 覆盖 loadAllData
var loadAllData = loadAllDataOptimized;

function paginate(items, page, perPage) {
    const start = (page - 1) * perPage;
    return items.slice(start, start + perPage);
}

function isTaskExpired(task) {
    if (task.completed || !task.deadline) return false;
    try {
        return new Date(task.deadline) < new Date();
    } catch {
        return false;
    }
}

// ─── 渲染任务列表 ─────────────────────────────────────────

function renderTaskList(listId, emptyId, tasks, isDoneList, totalForSection) {
    const listEl = $(`#${listId}`);
    const emptyEl = $(`#${emptyId}`);

    if (totalForSection === 0) {
        listEl.innerHTML = "";
        emptyEl.classList.remove("hidden");
        updateEmptyText(emptyId, isDoneList);
        return;
    }

    emptyEl.classList.add("hidden");

    if (tasks.length === 0) {
        listEl.innerHTML = `<div class="no-results"><div class="no-results-emoji">&#128269;</div><p>当前页没有任务</p></div>`;
        return;
    }

    listEl.innerHTML = tasks.map(t => {
        const stars = t.star_rating > 0 ? "★".repeat(t.star_rating) + "☆".repeat(5 - t.star_rating) : "";
        const dlDisplay = formatDeadline(t.deadline);
        const dlUrgent = isDeadlineUrgent(t.deadline);

        return `
        <div class="task-item ${t.completed ? "done" : ""} star-${t.star_rating || 0}" data-id="${t.id}">
            <button class="task-check ${t.completed ? "checked" : ""}" onclick="toggleTask('${t.id}')" title="切换状态"></button>
            <div class="task-body">
                <div class="task-title-text">${esc(t.title)}</div>
                ${t.description ? `<div class="task-desc-text">${esc(t.description)}</div>` : ""}
                <div class="task-meta">
                    <span class="task-time">${t.created_at}</span>
                    <span class="category-tag">${esc(t.category || "其他")}</span>
                    ${stars ? `<span class="star-display">${stars}</span>` : ""}
                    ${dlDisplay ? `<span class="deadline-tag ${dlUrgent ? "urgent" : ""}">${dlDisplay}</span>` : ""}
                </div>
            </div>
            <div class="task-actions">
                <button class="btn btn-outline btn-sm" onclick="startEdit('${t.id}')" title="编辑">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
                </button>
                <button class="btn btn-outline btn-sm" onclick="promptDelete('${t.id}')" title="删除">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                </button>
            </div>
        </div>`;
    }).join("");
}

function updateEmptyText(emptyId, isDoneList) {
    const el = $(`#${emptyId}`);
    if (!isDoneList) {
        if (doneCount > 0 && pendingCount === 0) {
            el.innerHTML = `<div class="empty-emoji">&#127942;</div><p class="empty-text">你好棒！你居然完成了所有任务！</p><p class="empty-sub">你简直是超人，休息一下吧~</p>`;
        } else {
            el.innerHTML = `<div class="empty-emoji">&#127919;</div><p class="empty-text">快来创建第一项任务吧！</p><p class="empty-sub">你的高效之旅从这里开始</p>`;
        }
    } else {
        if (pendingCount > 0 && doneCount === 0) {
            el.innerHTML = `<div class="empty-emoji">&#128170;</div><p class="empty-text">我已经迫不及待看你完成第一项任务了</p><p class="empty-sub">加油，你是最棒的！</p>`;
        } else {
            el.innerHTML = `<div class="empty-emoji">&#128170;</div><p class="empty-text">完成任务后会在这里显示</p><p class="empty-sub">加油，你是最棒的！</p>`;
        }
    }
}

// ─── 渲染已过期列表 ───────────────────────────────────────

function renderExpiredList(listId, tasks, totalForSection) {
    const listEl = $(`#${listId}`);
    const emptyEl = $("#empty-expired");
    const emptyHasEl = $("#empty-expired-has");

    if (totalForSection === 0) {
        listEl.innerHTML = "";
        emptyEl.classList.remove("hidden");
        emptyHasEl.classList.add("hidden");
        return;
    }

    emptyEl.classList.add("hidden");
    emptyHasEl.classList.remove("hidden");

    if (tasks.length === 0) {
        listEl.innerHTML = `<div class="no-results"><div class="no-results-emoji">&#128269;</div><p>当前页没有任务</p></div>`;
        return;
    }

    listEl.innerHTML = tasks.map(t => {
        const stars = t.star_rating > 0 ? "★".repeat(t.star_rating) + "☆".repeat(5 - t.star_rating) : "";
        const dlDisplay = formatDeadline(t.deadline);

        return `
        <div class="task-item expired star-${t.star_rating || 0}" data-id="${t.id}">
            <button class="task-check" onclick="toggleTask('${t.id}')" title="标记完成"></button>
            <div class="task-body">
                <div class="task-title-text">${esc(t.title)}</div>
                ${t.description ? `<div class="task-desc-text">${esc(t.description)}</div>` : ""}
                <div class="task-meta">
                    <span class="task-time">${t.created_at}</span>
                    <span class="category-tag">${esc(t.category || "其他")}</span>
                    ${stars ? `<span class="star-display">${stars}</span>` : ""}
                    ${dlDisplay ? `<span class="deadline-tag urgent">${dlDisplay}</span>` : ""}
                </div>
            </div>
            <div class="task-actions">
                <button class="btn btn-outline btn-sm" onclick="promptDelete('${t.id}')" title="删除">
                    <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
                </button>
            </div>
        </div>`;
    }).join("");
}

// ─── 分页渲染 ─────────────────────────────────────────────

function renderPagination(containerId, currentPage, totalPages, listType) {
    const el = $(`#${containerId}`);
    if (totalPages <= 1) { el.innerHTML = ""; return; }

    let html = "";
    html += `<button class="page-btn" ${currentPage <= 1 ? "disabled" : ""} onclick="goPage('${listType}', ${currentPage - 1})">&lsaquo;</button>`;
    html += `<span class="page-info">${currentPage} / ${totalPages}</span>`;
    html += `<button class="page-btn" ${currentPage >= totalPages ? "disabled" : ""} onclick="goPage('${listType}', ${currentPage + 1})">&rsaquo;</button>`;
    el.innerHTML = html;
}

function goPage(listType, page) {
    if (listType === "pending") {
        pendingPage = page;
    } else if (listType === "expired") {
        expiredPage = page;
    } else {
        donePage = page;
    }
    loadAllData();
}

// ─── 任务操作 ─────────────────────────────────────────────

async function toggleTask(id) {
    const data = await api(`/tasks/${id}/toggle`, { method: "POST" });
    if (data.success) {
        showToast(data.message, "success");
        loadAllData();
    } else {
        showToast(data.message, "error");
    }
}

function promptDelete(id) {
    deleteTargetId = id;
    $("#modal-overlay").classList.remove("hidden");
}

// ─── 内联编辑 ─────────────────────────────────────────────

function startEdit(id) {
    // 先从API获取最新数据
    const params = new URLSearchParams({ sort_by: "created", category: "全部", search: "", page: 1, per_page: 9999 });
    api(`/tasks?${params}`).then(data => {
        if (!data.success) return;
        const task = data.data.items.find(t => t.id === id);
        if (!task) return;
        startEditWithTask(task);
    });
}

function startEditWithTask(task) {
    const itemEl = document.querySelector(`.task-item[data-id="${task.id}"]`);
    if (!itemEl) return;

    itemEl.classList.add("editing");
    const bodyEl = itemEl.querySelector(".task-body");

    bodyEl.innerHTML = `
        <input class="edit-input" id="edit-title-${task.id}" value="${escAttr(task.title)}" placeholder="任务标题" maxlength="100">
        <input class="edit-input" id="edit-desc-${task.id}" value="${escAttr(task.description)}" placeholder="任务描述（可选）" maxlength="500">
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <select class="edit-input select-edit" id="edit-category-${task.id}" style="flex:1;min-width:80px;">
                <option value="工作" ${task.category === "工作" ? "selected" : ""}>工作</option>
                <option value="学习" ${task.category === "学习" ? "selected" : ""}>学习</option>
                <option value="生活" ${task.category === "生活" ? "selected" : ""}>生活</option>
                <option value="家庭" ${task.category === "家庭" ? "selected" : ""}>家庭</option>
                <option value="其他" ${task.category === "其他" ? "selected" : ""}>其他</option>
            </select>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px;">
            <div style="flex:1;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">星级</div>
                <div class="star-rating" id="star-edit-${task.id}" style="padding:0;">
                    ${[1,2,3,4,5].map(v => `<span class="star ${v <= task.star_rating ? "active" : ""}" data-val="${v}" onclick="clickEditStar('${task.id}', ${v})">&#9733;</span>`).join("")}
                </div>
                <input type="hidden" id="edit-star-${task.id}" value="${task.star_rating}">
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <div style="flex:1;min-width:120px;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">开始日期</div>
                <input class="edit-input" type="datetime-local" id="edit-start-${task.id}" value="${task.start_date || ""}">
            </div>
            <div style="flex:1;min-width:120px;">
                <div style="font-size:11px;color:#b2bec3;margin-bottom:2px;">截止日期</div>
                <input class="edit-input" type="datetime-local" id="edit-deadline-${task.id}" value="${task.deadline || ""}">
            </div>
        </div>
        <div class="edit-actions">
            <button class="btn btn-primary btn-sm" onclick="saveEdit('${task.id}')">保存</button>
            <button class="btn btn-outline btn-sm" onclick="loadAllData()">取消</button>
        </div>`;

    const actionsEl = itemEl.querySelector(".task-actions");
    if (actionsEl) actionsEl.style.display = "none";

    const titleInput = $(`#edit-title-${task.id}`);
    titleInput.focus();
    titleInput.select();
    titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") saveEdit(task.id); });
}

function clickEditStar(taskId, val) {
    const input = $(`#edit-star-${taskId}`);
    const current = parseInt(input.value);
    if (current === val) {
        input.value = "0";
        val = 0;
    } else {
        input.value = val;
    }
    $(`#star-edit-${taskId}`).querySelectorAll(".star").forEach(s => {
        s.classList.toggle("active", parseInt(s.dataset.val) <= val);
    });
}

async function saveEdit(id) {
    const title = $(`#edit-title-${id}`).value.trim();
    if (!title) { showToast("任务标题不能为空", "error"); return; }

    const startDate = $(`#edit-start-${id}`).value || "";
    const deadline = $(`#edit-deadline-${id}`).value || "";

    if (startDate && deadline && new Date(startDate) > new Date(deadline)) {
        showToast("开始日期不能晚于截止日期", "error");
        return;
    }

    const body = {
        title,
        description: $(`#edit-desc-${id}`).value.trim(),
        category: $(`#edit-category-${id}`).value,
        star_rating: parseInt($(`#edit-star-${id}`).value) || 0,
        start_date: startDate,
        deadline: deadline,
    };

    const data = await api(`/tasks/${id}`, { method: "PUT", body: JSON.stringify(body) });
    if (data.success) {
        showToast("任务已更新", "success");
        loadAllData();
    } else {
        showToast(data.message, "error");
    }
}

// ─── 工具函数 ─────────────────────────────────────────────

function esc(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function escAttr(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatDeadline(deadline) {
    if (!deadline) return "";
    try {
        const d = new Date(deadline);
        if (isNaN(d.getTime())) return deadline;
        const month = d.getMonth() + 1;
        const day = d.getDate();
        const hour = d.getHours().toString().padStart(2, "0");
        const min = d.getMinutes().toString().padStart(2, "0");
        return `${month}/${day} ${hour}:${min}`;
    } catch {
        return deadline;
    }
}

function isDeadlineUrgent(deadline) {
    if (!deadline) return false;
    try {
        const d = new Date(deadline);
        const now = new Date();
        const diff = d.getTime() - now.getTime();
        return diff > 0 && diff < 24 * 60 * 60 * 1000; // 24小时内
    } catch {
        return false;
    }
}
