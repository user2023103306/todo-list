// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::thread;
use std::time::Duration;

fn main() {
    // 在后台线程启动服务器
    thread::spawn(|| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            task_manager_lib::server::run_server().await;
        });
    });

    // 等待服务器启动完成
    thread::sleep(Duration::from_secs(2));

    // 启动Tauri窗口
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("启动TaskFlow失败");
}
