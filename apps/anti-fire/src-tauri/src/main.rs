// Окно вокруг программы. Вся логика лежит внутри страницы. Окно заводится из кода ради
// скачивания: без обработчика WKWebView молча игнорирует ссылку с download, и кнопка
// «Выгрузить» ничего не делала. Команды две: выключенный SFSS не может запустить себя
// сам, поэтому это умеет только окно, а страница о процессах ничего не знает.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{Emitter, WebviewWindowBuilder, Window};

const NOT_FOUND: &str = "sfss-not-found";
/// Событие на каждую строку вывода: страница печатает её сразу, а не после прогрева
const OUTPUT_EVENT: &str = "sfss-output";

/// У приложения из Finder в PATH нет ни ~/.local/bin, ни Homebrew: там команду и ищем.
fn find_sfss(home: Option<PathBuf>, path: Option<String>) -> Option<PathBuf> {
    let mut places: Vec<PathBuf> = Vec::new();
    if let Some(home) = home {
        places.push(home.join(".local/bin"));
    }
    places.push(PathBuf::from("/opt/homebrew/bin"));
    places.push(PathBuf::from("/usr/local/bin"));
    if let Some(path) = path {
        places.extend(std::env::split_paths(&path));
    }
    places.into_iter().map(|dir| dir.join("sfss")).find(|file| file.is_file())
}

/// Строки команды по мере появления, из stdout и stderr вперемешку, как в терминале.
/// Раньше вывод приходил целиком после выхода: «Прогрев моделей...» появлялся, когда прогрев
/// уже закончился. Возвращается весь текст. Пустой вывод не считается ошибкой.
fn run(sfss: &Path, args: &[String], on_line: &(dyn Fn(&str) + Sync)) -> Result<String, String> {
    let mut child = Command::new(sfss)
        .args(args)
        // В трубу Python пишет stdout блоками, а не построчно: строки опаздывали бы до выхода
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
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let path = std::env::var("PATH").ok();
    let sfss = find_sfss(home, path).ok_or(NOT_FOUND)?;
    run(&sfss, args, &|line| {
        let _ = window.emit(OUTPUT_EVENT, line);
    })
}

// async: запуск ждёт прогрева моделей, окно всё это время не должно висеть.
// Адрес не передаётся: окно управляет только сервисом на этой машине.
#[tauri::command(async)]
fn sfss_start(window: Window, port: u16) -> Result<String, String> {
    run_installed(&window, &["start".to_string(), "--port".to_string(), port.to_string()])
}

#[tauri::command(async)]
fn sfss_stop(window: Window) -> Result<String, String> {
    run_installed(&window, &["stop".to_string()])
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![sfss_start, sfss_stop])
        .setup(|app| {
            let config = app.config().app.windows[0].clone();
            // Файл попадает в «Загрузки», и одноимённые файлы не перезаписываются
            WebviewWindowBuilder::from_config(app.handle(), &config)?
                .on_download(|_, _| true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("не удалось запустить окно");
}

#[cfg(test)]
mod tests {
    use super::*;
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
        // Системные папки проверяются всегда, и там команда может быть на самом деле
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
        // Строка из stderr до долгой паузы, как «Прогрев моделей...» перед прогревом
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
