use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use chrono::{Duration, Local, NaiveDateTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::PathBuf, sync::Arc};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use uuid::Uuid;

// ─── 数据模型 ───────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Task {
    id: String,
    title: String,
    description: String,
    completed: bool,
    category: String,
    star_rating: u8,
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    deadline: String,
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct RegisterRequest {
    phone: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    phone: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct CreateTaskRequest {
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default = "default_category")]
    category: String,
    #[serde(default)]
    star_rating: u8,
    #[serde(default)]
    start_date: String,
    #[serde(default)]
    deadline: String,
}

#[derive(Debug, Deserialize)]
struct UpdateTaskRequest {
    title: Option<String>,
    description: Option<String>,
    category: Option<String>,
    star_rating: Option<u8>,
    start_date: Option<String>,
    deadline: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    #[serde(default)]
    sort_by: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    search: String,
    #[serde(default = "default_page")]
    page: u32,
    #[serde(default = "default_per_page")]
    per_page: u32,
}

fn default_category() -> String { "其他".to_string() }
fn default_page() -> u32 { 1 }
fn default_per_page() -> u32 { 3 }

#[derive(Debug, Serialize)]
struct ApiResponse {
    success: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<Value>,
}

#[derive(Debug, Serialize)]
struct PagedData {
    items: Vec<Task>,
    total: u32,
    page: u32,
    per_page: u32,
    total_pages: u32,
}

fn ok(message: &str, data: impl Serialize) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: true,
        message: message.to_string(),
        data: Some(serde_json::to_value(data).unwrap_or(Value::Null)),
    })
}

fn err(message: &str) -> Json<ApiResponse> {
    Json(ApiResponse {
        success: false,
        message: message.to_string(),
        data: None,
    })
}

// ─── 应用状态 ───────────────────────────────────────────────

struct AppState {
    sessions: RwLock<HashMap<String, String>>,
    users_file: PathBuf,
    data_dir: PathBuf,
}

impl AppState {
    fn new() -> Self {
        let data_dir = PathBuf::from("data");
        if !data_dir.exists() {
            fs::create_dir_all(&data_dir).expect("无法创建 data 目录");
        }
        Self {
            sessions: RwLock::new(HashMap::new()),
            users_file: PathBuf::from("users.json"),
            data_dir,
        }
    }

    fn read_users(&self) -> HashMap<String, String> {
        if self.users_file.exists() {
            let content = fs::read_to_string(&self.users_file).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        }
    }

    fn write_users(&self, users: &HashMap<String, String>) -> Result<(), String> {
        let json = serde_json::to_string_pretty(users).map_err(|e| e.to_string())?;
        fs::write(&self.users_file, json).map_err(|e| e.to_string())
    }

    fn user_tasks_path(&self, phone: &str) -> PathBuf {
        self.data_dir.join(format!("{phone}.json"))
    }

    fn read_tasks(&self, phone: &str) -> Vec<Task> {
        let path = self.user_tasks_path(phone);
        if path.exists() {
            let content = fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        }
    }

    fn write_tasks(&self, phone: &str, tasks: &[Task]) -> Result<(), String> {
        let path = self.user_tasks_path(phone);
        let json = serde_json::to_string_pretty(tasks).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())
    }
}

// ─── 辅助函数 ───────────────────────────────────────────────

fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn validate_phone(phone: &str) -> bool {
    phone.len() == 11 && phone.chars().all(|c| c.is_ascii_digit())
}

async fn get_session_phone(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<String, (StatusCode, Json<ApiResponse>)> {
    let session_id = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .ok_or((StatusCode::UNAUTHORIZED, err("未登录，请先登录")))?;
    let sessions = state.sessions.read().await;
    sessions
        .get(session_id)
        .cloned()
        .ok_or((StatusCode::UNAUTHORIZED, err("登录已过期，请重新登录")))
}

/// 截止日期在1天内的未完成任务，自动升级为5星
fn auto_upgrade_star(tasks: &mut Vec<Task>) -> bool {
    let now = Local::now();
    let mut changed = false;
    for t in tasks.iter_mut() {
        if t.completed || t.star_rating >= 5 || t.deadline.is_empty() {
            continue;
        }
        if let Ok(dl) = NaiveDateTime::parse_from_str(&t.deadline, "%Y-%m-%dT%H:%M") {
            let dl_local = dl - Duration::hours(8);
            if dl_local <= (now + Duration::hours(24)).naive_local() && dl_local >= now.naive_local() - Duration::hours(1) {
                t.star_rating = 5;
                changed = true;
            }
        } else if let Ok(dl_date) = chrono::NaiveDate::parse_from_str(&t.deadline, "%Y-%m-%d") {
            if dl_date <= (now + Duration::hours(24)).date_naive() && dl_date >= now.date_naive() - Duration::days(1) {
                t.star_rating = 5;
                changed = true;
            }
        }
    }
    changed
}

// ─── 用户认证 ───────────────────────────────────────────────

async fn register(
    State(state): State<Arc<AppState>>,
    Json(req): Json<RegisterRequest>,
) -> impl IntoResponse {
    let phone = req.phone.trim().to_string();
    let password = req.password.trim().to_string();
    if !validate_phone(&phone) {
        return (StatusCode::BAD_REQUEST, err("手机号必须为11位数字"));
    }
    if password.len() < 6 {
        return (StatusCode::BAD_REQUEST, err("密码长度不能低于6位"));
    }
    let mut users = state.read_users();
    if users.contains_key(&phone) {
        return (StatusCode::CONFLICT, err("该手机号已被注册"));
    }
    users.insert(phone, hash_password(&password));
    match state.write_users(&users) {
        Ok(_) => (StatusCode::OK, ok("注册成功", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("注册失败: {e}"))),
    }
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let phone = req.phone.trim().to_string();
    let password = req.password.trim().to_string();
    let users = state.read_users();
    let stored_hash = match users.get(&phone) {
        Some(h) => h.clone(),
        None => return (StatusCode::UNAUTHORIZED, err("手机号或密码错误")),
    };
    if stored_hash != hash_password(&password) {
        return (StatusCode::UNAUTHORIZED, err("手机号或密码错误"));
    }
    let session_id = Uuid::new_v4().to_string();
    state.sessions.write().await.insert(session_id.clone(), phone);
    (StatusCode::OK, ok("登录成功", session_id))
}

async fn logout(headers: HeaderMap, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    if let Some(sid) = headers.get("x-session-id").and_then(|v| v.to_str().ok()) {
        state.sessions.write().await.remove(sid);
    }
    (StatusCode::OK, ok("已退出登录", ()))
}

async fn check_session(headers: HeaderMap, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match get_session_phone(&headers, &state).await {
        Ok(phone) => (StatusCode::OK, ok("已登录", phone)),
        Err((s, r)) => (s, r),
    }
}

// ─── 任务管理 ───────────────────────────────────────────────

async fn list_tasks(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };

    let mut tasks = state.read_tasks(&phone);

    // 自动升级截止临近任务
    let upgraded = auto_upgrade_star(&mut tasks);
    if upgraded {
        let _ = state.write_tasks(&phone, &tasks);
    }

    // 搜索过滤
    if !q.search.is_empty() {
        let kw = q.search.to_lowercase();
        tasks.retain(|t| t.title.to_lowercase().contains(&kw) || t.description.to_lowercase().contains(&kw));
    }

    // 分类过滤
    if !q.category.is_empty() && q.category != "全部" {
        tasks.retain(|t| t.category == q.category);
    }

    // 排序
    match q.sort_by.as_str() {
        "deadline" => {
            tasks.sort_by(|a, b| {
                let da = if a.deadline.is_empty() { "9999".to_string() } else { a.deadline.clone() };
                let db = if b.deadline.is_empty() { "9999".to_string() } else { b.deadline.clone() };
                da.cmp(&db)
            });
        }
        "importance" => {
            tasks.sort_by(|a, b| {
                b.star_rating.cmp(&a.star_rating)
                    .then(a.deadline.cmp(&b.deadline))
            });
        }
        _ => {
            // 默认：最近创建
            tasks.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        }
    }

    let total = tasks.len() as u32;
    let per_page = q.per_page.max(1);
    let total_pages = if total == 0 { 1 } else { (total + per_page - 1) / per_page };
    let page = q.page.max(1).min(total_pages);
    let start = ((page - 1) * per_page) as usize;
    let end = (start + per_page as usize).min(tasks.len());
    let items = if start < tasks.len() { tasks[start..end].to_vec() } else { vec![] };

    (StatusCode::OK, ok("获取成功", PagedData { items, total, page, per_page, total_pages }))
}

async fn create_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateTaskRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let title = req.title.trim().to_string();
    if title.is_empty() {
        return (StatusCode::BAD_REQUEST, err("任务标题不能为空"));
    }
    let category = if req.category.is_empty() { "其他".to_string() } else { req.category };
    let star_rating = req.star_rating.min(5);

    let task = Task {
        id: Uuid::new_v4().to_string(),
        title,
        description: req.description.trim().to_string(),
        completed: false,
        category,
        star_rating,
        start_date: req.start_date,
        deadline: req.deadline,
        created_at: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
    };

    let mut tasks = state.read_tasks(&phone);
    tasks.push(task.clone());
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => (StatusCode::CREATED, ok("任务创建成功", task)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("创建失败: {e}"))),
    }
}

async fn update_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
    Json(req): Json<UpdateTaskRequest>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut tasks = state.read_tasks(&phone);
    let task = match tasks.iter_mut().find(|t| t.id == task_id) {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };
    if let Some(title) = req.title {
        let title = title.trim().to_string();
        if title.is_empty() { return (StatusCode::BAD_REQUEST, err("任务标题不能为空")); }
        task.title = title;
    }
    if let Some(desc) = req.description { task.description = desc.trim().to_string(); }
    if let Some(c) = req.category { task.category = c; }
    if let Some(s) = req.star_rating { task.star_rating = s.min(5); }
    if let Some(sd) = req.start_date { task.start_date = sd; }
    if let Some(dl) = req.deadline { task.deadline = dl; }
    let updated = task.clone();
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => (StatusCode::OK, ok("任务更新成功", updated)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("更新失败: {e}"))),
    }
}

async fn toggle_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut tasks = state.read_tasks(&phone);
    let task = match tasks.iter_mut().find(|t| t.id == task_id) {
        Some(t) => t,
        None => return (StatusCode::NOT_FOUND, err("任务不存在")),
    };
    task.completed = !task.completed;
    let updated = task.clone();
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => {
            let label = if updated.completed { "已完成" } else { "已重新打开" };
            (StatusCode::OK, ok(&format!("任务{label}"), updated))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("操作失败: {e}"))),
    }
}

async fn delete_task(
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
    Path(task_id): Path<String>,
) -> impl IntoResponse {
    let phone = match get_session_phone(&headers, &state).await {
        Ok(p) => p,
        Err((s, r)) => return (s, r),
    };
    let mut tasks = state.read_tasks(&phone);
    let before = tasks.len();
    tasks.retain(|t| t.id != task_id);
    if tasks.len() == before {
        return (StatusCode::NOT_FOUND, err("任务不存在"));
    }
    match state.write_tasks(&phone, &tasks) {
        Ok(_) => (StatusCode::OK, ok("任务已删除", ())),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, err(&format!("删除失败: {e}"))),
    }
}

// ─── 主函数 ─────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState::new());

    let api_routes = Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/session", get(check_session))
        .route("/tasks", get(list_tasks).post(create_task))
        .route("/tasks/{id}", put(update_task).delete(delete_task))
        .route("/tasks/{id}/toggle", post(toggle_task));

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(ServeDir::new("static"))
        .with_state(state);

    let port = 8080;
    println!("========================================");
    println!("  TaskFlow - 多用户局域网任务管理工具");
    println!("  服务已启动！");
    println!("  本机访问: http://localhost:{port}");
    println!("  局域网:   http://<你的IP>:{port}");
    println!("========================================");

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .expect("无法绑定端口");
    axum::serve(listener, app).await.expect("服务器启动失败");
}
