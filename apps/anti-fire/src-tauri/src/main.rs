#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{Emitter, WebviewWindowBuilder, Window};

const NOT_FOUND: &str = "sfss-not-found";

const OUTPUT_EVENT: &str = "sfss-output";

#[cfg(windows)]
const SFSS_NAMES: &[&str] = &["sfss.cmd", "sfss.exe"];
#[cfg(not(windows))]
const SFSS_NAMES: &[&str] = &["sfss"];

fn find_sfss(home: Option<PathBuf>, path: Option<String>) -> Option<PathBuf> {
    let mut places: Vec<PathBuf> = Vec::new();
    if let Some(home) = home {
        places.push(home.join(".local/bin"));
        places.push(home.join("AppData/Local/sfss/bin"));
    }
    places.push(PathBuf::from("/opt/homebrew/bin"));
    places.push(PathBuf::from("/usr/local/bin"));
    if let Some(path) = path {
        places.extend(std::env::split_paths(&path));
    }
    places
        .into_iter()
        .flat_map(|dir| SFSS_NAMES.iter().map(move |name| dir.join(name)))
        .find(|file| file.is_file())
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

fn run(sfss: &Path, args: &[String], on_line: &(dyn Fn(&str) + Sync)) -> Result<String, String> {
    let mut command = Command::new(sfss);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command
        .args(args)

        .env("PYTHONUTF8", "1")

        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");
    let lines = Mutex::new(Vec::new());
    let read = |stream: Box<dyn Read + Send>| {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            on_line(&line);
            lines.lock().unwrap().push(line);
        }
    };
    thread::scope(|scope| {
        scope.spawn(|| read(Box::new(stdout)));
        scope.spawn(|| read(Box::new(stderr)));
    });
    let status = child.wait().map_err(|error| error.to_string())?;
    let text = lines.into_inner().unwrap().join("\n").trim().to_string();
    if status.success() { Ok(text) } else { Err(text) }
}

fn run_installed(window: &Window, args: &[String]) -> Result<String, String> {
    let path = std::env::var("PATH").ok();
    let sfss = find_sfss(home_dir(), path).ok_or(NOT_FOUND)?;
    run(&sfss, args, &|line| {
        let _ = window.emit(OUTPUT_EVENT, line);
    })
}

#[tauri::command(async)]
fn sfss_start(window: Window, port: u16) -> Result<String, String> {
    run_installed(&window, &["start".to_string(), "--port".to_string(), port.to_string()])
}

#[tauri::command(async)]
fn sfss_stop(window: Window) -> Result<String, String> {
    run_installed(&window, &["stop".to_string()])
}

const SCREEN_MARGIN: f64 = 24.0;

const TITLE_BAR: f64 = 32.0;

fn fit_size(wanted: (f64, f64), min: (f64, f64), area: (f64, f64)) -> (f64, f64) {
    let max_w = area.0 - 2.0 * SCREEN_MARGIN;
    let max_h = area.1 - 2.0 * SCREEN_MARGIN - TITLE_BAR;
    (wanted.0.min(max_w).max(min.0), wanted.1.min(max_h).max(min.1))
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn center_in(area_pos: (i32, i32), area_size: (u32, u32), window: (u32, u32)) -> (i32, i32) {
    let x = area_pos.0 + (area_size.0 as i32 - window.0 as i32).max(0) / 2;
    let y = area_pos.1 + (area_size.1 as i32 - window.1 as i32).max(0) / 2;
    (x, y)
}

fn center(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        let ns_window = window.ns_window()? as *mut AnyObject;

        if let Some(ns_window) = unsafe { ns_window.as_ref() } {
            let _: () = unsafe { msg_send![ns_window, center] };
        }
    }
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::GtkWindowExt;
        window.gtk_window()?.set_position(gtk::WindowPosition::Center);
    }
    #[cfg(target_os = "windows")]
    {
        let monitor = match window.current_monitor()? {
            Some(monitor) => Some(monitor),
            None => window.primary_monitor()?,
        };
        if let Some(monitor) = monitor {
            let area = monitor.work_area();
            let size = window.outer_size()?;
            let (x, y) = center_in(
                (area.position.x, area.position.y),
                (area.size.width, area.size.height),
                (size.width, size.height),
            );
            window.set_position(tauri::PhysicalPosition::new(x, y))?;
        }
    }
    Ok(())
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn linux_wayland_env(
    get: impl Fn(&str) -> Option<String>,
) -> Vec<(&'static str, &'static str)> {
    if get("WAYLAND_DISPLAY").is_none() {
        return Vec::new();
    }
    [("GDK_BACKEND", "x11"), ("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]
        .into_iter()
        .filter(|(name, _)| get(name).is_none())
        .collect()
}

fn main() {
    #[cfg(target_os = "linux")]
    for (name, value) in linux_wayland_env(|name| std::env::var(name).ok()) {
        std::env::set_var(name, value);
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![sfss_start, sfss_stop])
        .setup(|app| {
            let config = app.config().app.windows[0].clone();
            let mut size = (config.width, config.height);
            if let Some(monitor) = app.primary_monitor()? {
                let area = monitor.work_area().size.to_logical::<f64>(monitor.scale_factor());
                let min = (config.min_width.unwrap_or(0.0), config.min_height.unwrap_or(0.0));
                size = fit_size(size, min, (area.width, area.height));
            }

            let window = WebviewWindowBuilder::from_config(app.handle(), &config)?
                .inner_size(size.0, size.1)
                .on_download(|_, _| true)
                .build()?;
            center(&window)?;
            window.show()?;

            window.set_focus()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("could not start the window");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    mod with_fake_command {
    use super::super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;

    fn fake_command(name: &str, script: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("sfss-test-{name}-{}", std::process::id()));
        let bin = dir.join(".local/bin");
        fs::create_dir_all(&bin).unwrap();
        let file = bin.join("sfss");
        fs::write(&file, script).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755)).unwrap();
        (dir, file)
    }

    #[test]
    fn finds_command_in_home_without_path() {
        let (home, file) = fake_command("find", "#!/bin/sh\n");
        assert_eq!(find_sfss(Some(home.clone()), None), Some(file));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn missing_command_is_none() {
        let temp = std::env::temp_dir();
        let path = temp.join("sfss-test-empty").display().to_string();
        let found = find_sfss(Some(temp.join("sfss-test-missing")), Some(path));

        assert!(!found.is_some_and(|file| file.starts_with(&temp)));
    }

    #[test]
    fn output_and_failure_reach_the_page() {
        let (home, file) = fake_command("run", "#!/bin/sh\necho \"args: $*\"\n[ \"$1\" = stop ] && { sleep 0.2; echo busy >&2; exit 1; }\nexit 0\n");
        let quiet = |_: &str| {};
        assert_eq!(run(&file, &["start".into(), "--port".into(), "8000".into()], &quiet), Ok("args: start --port 8000".to_string()));
        assert_eq!(run(&file, &["stop".into()], &quiet), Err("args: stop\nbusy".to_string()));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn lines_arrive_before_the_command_ends() {
        let (home, file) = fake_command("stream", "#!/bin/sh\necho warming >&2\nsleep 1\necho done\n");
        let started = std::time::Instant::now();
        let seen = Mutex::new(Vec::new());
        let on_line = |line: &str| seen.lock().unwrap().push((line.to_string(), started.elapsed()));
        assert_eq!(run(&file, &[], &on_line), Ok("warming\ndone".to_string()));
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen[0].0, "warming");
        assert!(seen[0].1 < std::time::Duration::from_millis(700), "warming came at {:?}", seen[0].1);
        fs::remove_dir_all(home).unwrap();
    }
    }

    #[test]
    fn wayland_gets_x11_and_no_dmabuf() {
        let env = |name: &str| (name == "WAYLAND_DISPLAY").then(|| "wayland-0".to_string());
        assert_eq!(
            linux_wayland_env(env),
            vec![("GDK_BACKEND", "x11"), ("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]
        );
    }

    #[test]
    fn x11_session_is_left_alone() {
        assert!(linux_wayland_env(|_| None).is_empty());
    }

    #[test]
    fn explicit_choice_wins() {
        let env = |name: &str| match name {
            "WAYLAND_DISPLAY" => Some("wayland-0".to_string()),
            "GDK_BACKEND" => Some("wayland".to_string()),
            _ => None,
        };
        assert_eq!(linux_wayland_env(env), vec![("WEBKIT_DISABLE_DMABUF_RENDERER", "1")]);
    }

    #[test]
    fn window_shrinks_to_the_screen_without_dock() {
        assert_eq!(fit_size((1360.0, 860.0), (1024.0, 680.0), (1337.0, 851.0)), (1289.0, 771.0));
    }

    #[test]
    fn window_keeps_its_size_on_a_big_screen() {
        assert_eq!(fit_size((1360.0, 860.0), (1024.0, 680.0), (1920.0, 1050.0)), (1360.0, 860.0));
    }

    #[test]
    fn window_never_goes_below_minimum() {
        assert_eq!(fit_size((1360.0, 860.0), (1024.0, 680.0), (800.0, 600.0)), (1024.0, 680.0));
    }

    #[test]
    fn center_counts_from_the_work_area() {
        assert_eq!(center_in((100, 0), (1820, 1040), (1360, 900)), (330, 70));
    }

    #[test]
    fn oversized_window_sticks_to_the_corner() {
        assert_eq!(center_in((0, 25), (1000, 700), (1200, 800)), (0, 25));
    }
}
