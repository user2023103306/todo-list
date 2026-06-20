// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 获取资源目录
            let resource_path = app.path().resource_dir().unwrap();

            // 在后台线程启动服务器
            let _server_thread = std::thread::spawn(move || {
                // 这里我们假设服务器已经作为单独的进程启动
                // 或者我们可以内嵌服务器代码
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动Tauri失败");
}
