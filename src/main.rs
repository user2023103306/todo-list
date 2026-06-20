mod server;

fn main() {
    // 创建tokio运行时
    let rt = tokio::runtime::Runtime::new().unwrap();

    // 在后台线程启动服务器
    let server_thread = std::thread::spawn(move || {
        rt.block_on(async {
            server::run_server().await;
        });
    });

    // 等待服务器启动
    std::thread::sleep(std::time::Duration::from_secs(2));

    // 打开浏览器
    let url = "http://localhost:8080";
    println!("========================================");
    println!("  TaskFlow - 任务管理桌面版");
    println!("========================================");
    println!("  服务已启动！");
    println!("  正在打开浏览器...");
    println!("========================================");

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", url])
            .spawn();
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(url)
            .spawn();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(url)
            .spawn();
    }

    // 等待服务器线程结束
    let _ = server_thread.join();
}
