use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
mod intelligence;
mod shortcuts;

struct Store {
    connection: Mutex<Connection>,
    root: PathBuf,
}
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() < 100
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.' || c == b'_')
        && !s.contains("..")
}
fn scope_path(root: &Path, scope: &str) -> Result<PathBuf> {
    if !safe_id(scope) {
        return Err("Ungültiger Speicherbereich".into());
    }
    Ok(root.join("vault").join(scope))
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("Ungültiger Pfad")?;
    fs::create_dir_all(parent).map_err(err)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(err)?;
    file.write_all(bytes).map_err(err)?;
    file.as_file().sync_all().map_err(err)?;
    file.persist(path).map_err(err)?;
    Ok(())
}
fn materialize(root: &Path, n: &Value) -> Result<()> {
    let scope = n["scope"].as_str().ok_or("Speicherbereich fehlt")?;
    let id = n["id"].as_str().ok_or("Notiz-ID fehlt")?;
    if !safe_id(id) {
        return Err("Ungültige Notiz-ID".into());
    }
    let path = scope_path(root, scope)?
        .join("notes")
        .join(format!("{id}.md"));
    let data=format!("---\nnotto_id: {}\ncreated: {}\nupdated: {}\npinned: {}\narchived: {}\ndeleted: {}\n---\n\n{}",id,n["createdAt"].as_str().unwrap_or(""),n["updatedAt"].as_str().unwrap_or(""),n["pinned"],n["archived"],n["deleted"],n["content"].as_str().unwrap_or(""));
    atomic_write(&path, data.as_bytes())
}
// Keep external edits as separate notes before repairing/replacing a projection.
// Known historical text is a stale mirror after an interrupted write, not an external edit.
fn preserve_external(store: &Store, n: &Value) -> Result<()> {
    let scope = n["scope"].as_str().ok_or("Speicherbereich fehlt")?;
    let id = n["id"].as_str().ok_or("ID fehlt")?;
    let path = scope_path(&store.root, scope)?
        .join("notes")
        .join(format!("{id}.md"));
    if !path.exists() {
        return Ok(());
    }
    let file = fs::read_to_string(path).map_err(err)?;
    let normalized = file.replace("\r\n", "\n");
    let body = if normalized.starts_with("---\n") {
        normalized[4..]
            .split_once("\n---\n")
            .map(|(_, v)| v.strip_prefix('\n').unwrap_or(v))
            .unwrap_or(&normalized)
    } else {
        &normalized
    };
    let current = n["content"].as_str().unwrap_or("").replace("\r\n", "\n");
    if body == current
        || n["history"]
            .as_array()
            .map(|h| {
                h.iter()
                    .any(|r| r["content"].as_str().unwrap_or("").replace("\r\n", "\n") == body)
            })
            .unwrap_or(false)
    {
        return Ok(());
    }
    let mut recovered = n.clone();
    let revision = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    recovered["id"] = json!(uuid::Uuid::new_v4().to_string());
    recovered["revision"] = json!(revision);
    recovered["content"] = json!(body);
    recovered["baseRevision"] = Value::Null;
    recovered["dirty"] = json!(true);
    recovered["deleted"] = json!(false);
    recovered["conflictOf"] = json!(id);
    recovered["updatedAt"] = json!(now);
    let mut history = n["history"].as_array().cloned().unwrap_or_default();
    history.push(json!({"revision":revision,"content":body,"savedAt":now}));
    recovered["history"] = json!(history);
    save_note(store, &recovered, None)?;
    materialize(&store.root, &recovered)?;
    Ok(())
}
fn open_store(root: PathBuf) -> Result<Store> {
    fs::create_dir_all(&root).map_err(err)?;
    let conn = Connection::open(root.join("notto.sqlite")).map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS notes(scope TEXT NOT NULL,id TEXT NOT NULL,revision TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS drafts(key TEXT PRIMARY KEY,scope TEXT NOT NULL,document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments(scope TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(scope UNINDEXED,id UNINDEXED,content,tokenize='unicode61 remove_diacritics 2');").map_err(err)?;
    let all_notes: Vec<Value> = {
        let mut stmt = conn.prepare("SELECT document FROM notes").map_err(err)?;
        let notes = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        notes
            .map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
            .collect::<Result<Vec<_>>>()?
    };
    let store = Store {
        connection: Mutex::new(conn),
        root,
    };
    for note in all_notes {
        preserve_external(&store, &note)?;
        if let Err(e) = materialize(&store.root, &note) {
            eprintln!("Markdown mirror: {e}")
        }
    }
    Ok(store)
}
#[tauri::command]
fn list_notes(scope: String, store: State<Store>) -> Result<Vec<Value>> {
    let c = store.connection.lock().map_err(err)?;
    let mut s = c
        .prepare("SELECT document FROM notes WHERE scope=?1")
        .map_err(err)?;
    let rows = s
        .query_map([scope], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
#[tauri::command]
fn get_note(scope: String, id: String, store: State<Store>) -> Result<Option<Value>> {
    let c = store.connection.lock().map_err(err)?;
    let text: Option<String> = c
        .query_row(
            "SELECT document FROM notes WHERE scope=?1 AND id=?2",
            params![scope, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    text.map(|t| serde_json::from_str(&t).map_err(err))
        .transpose()
}
fn save_note(store: &Store, note: &Value, expected: Option<String>) -> Result<()> {
    let scope = note["scope"].as_str().ok_or("Speicherbereich fehlt")?;
    scope_path(&store.root, scope)?;
    let id = note["id"].as_str().ok_or("ID fehlt")?;
    if !safe_id(id) {
        return Err("Ungültige ID".into());
    }
    let rev = note["revision"].as_str().ok_or("Version fehlt")?;
    let content = note["content"].as_str().ok_or("Text fehlt")?;
    let mut c = store.connection.lock().map_err(err)?;
    let tx = c.transaction().map_err(err)?;
    let old: Option<String> = tx
        .query_row(
            "SELECT revision FROM notes WHERE scope=?1 AND id=?2",
            params![scope, id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if old != expected {
        return Err(
            "Diese Notiz wurde in einem anderen Fenster geändert. Dein Entwurf bleibt erhalten."
                .into(),
        );
    }
    tx.execute("INSERT INTO notes(scope,id,revision,document) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,id) DO UPDATE SET revision=excluded.revision,document=excluded.document",params![scope,id,rev,note.to_string()]).map_err(err)?;
    tx.execute(
        "DELETE FROM note_search WHERE scope=?1 AND id=?2",
        params![scope, id],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO note_search(scope,id,content) VALUES(?1,?2,?3)",
        params![scope, id, content],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
#[tauri::command]
fn put_note(
    note: Value,
    expected_revision: Option<String>,
    store: State<Store>,
    app: tauri::AppHandle,
) -> Result<()> {
    // Validate the existing projection against the last journal version first.
    let old: Option<String> = store
        .connection
        .lock()
        .map_err(err)?
        .query_row(
            "SELECT document FROM notes WHERE scope=?1 AND id=?2",
            params![note["scope"].as_str(), note["id"].as_str()],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if let Some(old) = old {
        let original: Value = serde_json::from_str(&old).map_err(err)?;
        preserve_external(&store, &original)?;
    }
    save_note(&store, &note, expected_revision)?;
    // SQLite is the durable revision journal. A failed Markdown projection is repaired on restart.
    if let Err(e) = materialize(&store.root, &note) {
        let _=app.emit("storage-warning",format!("Notiz gespeichert; Markdown-Datei wird beim nächsten Start erneut geschrieben: {e}"));
    }
    Ok(())
}
#[tauri::command]
fn search_notes(scope: String, query: String, store: State<Store>) -> Result<Vec<String>> {
    let c = store.connection.lock().map_err(err)?;
    let q = query
        .split_whitespace()
        .map(|s| format!("\"{}\"*", s.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ");
    if q.is_empty() {
        return Ok(vec![]);
    }
    let mut stmt = c
        .prepare("SELECT id FROM note_search WHERE note_search MATCH ?1 AND scope=?2 ORDER BY rank")
        .map_err(err)?;
    let rows = stmt
        .query_map(params![q, scope], |r| r.get(0))
        .map_err(err)?;
    rows.map(|r| r.map_err(err)).collect()
}
#[tauri::command]
fn get_draft(key: String, store: State<Store>) -> Result<Option<Value>> {
    let c = store.connection.lock().map_err(err)?;
    let text: Option<String> = c
        .query_row("SELECT document FROM drafts WHERE key=?1", [key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    text.map(|s| serde_json::from_str(&s).map_err(err))
        .transpose()
}
#[tauri::command]
fn list_drafts(scope: String, store: State<Store>) -> Result<Vec<Value>> {
    let c = store.connection.lock().map_err(err)?;
    let mut s = c
        .prepare("SELECT document FROM drafts WHERE scope=?1")
        .map_err(err)?;
    let rows = s
        .query_map([scope], |r| r.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
#[tauri::command]
fn save_draft(draft: Value, store: State<Store>) -> Result<()> {
    let c = store.connection.lock().map_err(err)?;
    c.execute("INSERT INTO drafts(key,scope,document) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET document=excluded.document",params![draft["key"].as_str(),draft["scope"].as_str(),draft.to_string()]).map_err(err)?;
    Ok(())
}
#[tauri::command]
fn remove_draft(key: String, store: State<Store>) -> Result<()> {
    store
        .connection
        .lock()
        .map_err(err)?
        .execute("DELETE FROM drafts WHERE key=?1", [key])
        .map_err(err)?;
    Ok(())
}
#[derive(Deserialize, Serialize)]
struct Attachment {
    id: String,
    scope: String,
    name: String,
    mime: String,
    bytes: Vec<u8>,
}
fn attachment_path(root: &Path, scope: &str, id: &str) -> Result<PathBuf> {
    if !safe_id(id) {
        return Err("Ungültiger Bildname".into());
    }
    Ok(scope_path(root, scope)?
        .join("notes")
        .join("attachments")
        .join(id))
}
#[tauri::command]
fn put_attachment(attachment: Attachment, store: State<Store>) -> Result<()> {
    if attachment.bytes.len() > 12 * 1024 * 1024 {
        return Err("Bild ist zu groß".into());
    }
    if ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/avif",
        "application/pdf",
    ]
    .contains(&attachment.mime.as_str())
    {
        return Err("Nicht unterstütztes Bildformat".into());
    }
    atomic_write(
        &attachment_path(&store.root, &attachment.scope, &attachment.id)?,
        &attachment.bytes,
    )?;
    store.connection.lock().map_err(err)?.execute("INSERT INTO attachments(scope,id,name,mime) VALUES(?1,?2,?3,?4) ON CONFLICT(scope,id) DO NOTHING",params![attachment.scope,attachment.id,attachment.name,attachment.mime]).map_err(err)?;
    Ok(())
}
#[tauri::command]
fn get_attachment(scope: String, id: String, store: State<Store>) -> Result<Option<Attachment>> {
    let path = attachment_path(&store.root, &scope, &id)?;
    let meta: Option<(String, String)> = store
        .connection
        .lock()
        .map_err(err)?
        .query_row(
            "SELECT name,mime FROM attachments WHERE scope=?1 AND id=?2",
            params![scope, id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    match meta {
        Some((name, mime)) => Ok(Some(Attachment {
            id,
            scope,
            name,
            mime,
            bytes: fs::read(path).map_err(err)?,
        })),
        None => Ok(None),
    }
}
#[tauri::command]
fn write_export(path: String, bytes: Vec<u8>) -> Result<()> {
    atomic_write(Path::new(&path), &bytes)
}
#[tauri::command]
fn storage_path(store: State<Store>) -> String {
    store.root.display().to_string()
}
#[tauri::command]
fn open_vault(store: State<Store>) -> Result<()> {
    fs::create_dir_all(store.root.join("vault")).map_err(err)?;
    std::process::Command::new("explorer.exe")
        .arg(store.root.join("vault"))
        .spawn()
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
fn open_external(url: String) -> Result<()> {
    let parsed = reqwest::Url::parse(&url).map_err(err)?;
    if !matches!(parsed.scheme(), "https" | "http")
        || parsed.host_str().is_none()
        || url.contains('\0')
    {
        return Err("Nur gültige Weblinks können geöffnet werden".into());
    }
    #[cfg(target_os = "windows")]
    {
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut std::ffi::c_void,
                operation: *const u16,
                file: *const u16,
                parameters: *const u16,
                directory: *const u16,
                show: i32,
            ) -> isize;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let target: Vec<u16> = parsed
            .as_str()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        // Both strings are NUL-terminated and stay alive throughout the synchronous call.
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result <= 32 {
            return Err(format!(
                "Standardbrowser konnte nicht geöffnet werden (Windows {result})"
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    Err("Weblinks werden auf diesem System noch nicht unterstützt".into())
}
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}
#[tauri::command]
fn open_main(app: tauri::AppHandle, note_id: Option<String>) {
    show_main(&app);
    let _ = app.emit_to("main", "open-note", note_id);
}
#[tauri::command]
fn show_widget(app: tauri::AppHandle) -> Result<()> {
    let w = app.get_webview_window("widget").ok_or("Widget fehlt")?;
    w.show().map_err(err)
}
#[tauri::command]
fn hide_widget(app: tauri::AppHandle) -> Result<()> {
    let w = app.get_webview_window("widget").ok_or("Widget fehlt")?;
    w.hide().map_err(err)
}
fn position_widget(app: &tauri::AppHandle, side: Option<String>, save: bool) -> Result<String> {
    let w = app.get_webview_window("widget").ok_or("Widget fehlt")?;
    let monitor = w
        .current_monitor()
        .map_err(err)?
        .or(w.primary_monitor().map_err(err)?)
        .ok_or("Kein Monitor gefunden")?;
    let area = monitor.work_area();
    let pos = w.outer_position().map_err(err)?;
    let size = w.outer_size().map_err(err)?;
    let left = side.map(|s| s == "left").unwrap_or(
        pos.x + ((size.width / 2) as i32) < area.position.x + (area.size.width / 2) as i32,
    );
    let x = if left {
        area.position.x
    } else {
        area.position.x + area.size.width as i32 - size.width as i32
    };
    let y = pos
        .y
        .max(area.position.y)
        .min((area.position.y + area.size.height as i32 - size.height as i32).max(area.position.y));
    if pos.x != x || pos.y != y {
        w.set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(err)?;
    }
    let side = if left { "left" } else { "right" };
    if save {
        let store = app.state::<Store>();
        store.connection.lock().map_err(err)?.execute("INSERT INTO settings(key,value) VALUES('widget',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[json!({"x":x,"y":y,"side":side}).to_string()]).map_err(err)?;
    }
    let _ = w.emit("dock-side", side);
    Ok(side.into())
}
#[tauri::command]
fn snap_widget(app: tauri::AppHandle, side: Option<String>) -> Result<String> {
    position_widget(&app, side, true)
}
#[tauri::command]
fn widget_mode(app: tauri::AppHandle, mode: String) -> Result<()> {
    let w = app.get_webview_window("widget").ok_or("Widget fehlt")?;
    let (width, height): (f64, f64) = match mode.as_str() {
        "peek" => (360., 340.),
        "edit" => (480., 430.),
        _ => (64., 118.),
    };
    let pos = w.outer_position().map_err(err)?;
    let old = w.outer_size().map_err(err)?;
    let scale = w.scale_factor().map_err(err)?;
    let monitor = w.current_monitor().map_err(err)?.ok_or("Monitor fehlt")?;
    let area = monitor.work_area();
    let left = pos.x + ((old.width / 2) as i32) < area.position.x + (area.size.width / 2) as i32;
    let width: f64 = width.min(area.size.width as f64 / scale);
    let height: f64 = height.min(area.size.height as f64 / scale);
    w.set_size(tauri::LogicalSize::new(width, height))
        .map_err(err)?;
    if !left {
        w.set_position(tauri::PhysicalPosition::new(
            pos.x + old.width as i32 - (width * scale).round() as i32,
            pos.y,
        ))
        .map_err(err)?;
    }
    position_widget(
        &app,
        Some(if left { "left" } else { "right" }.into()),
        false,
    )?;
    w.set_focusable(mode == "edit").map_err(err)?;
    if mode == "edit" {
        w.set_focus().map_err(err)?;
    }
    Ok(())
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| shortcuts::handle(app, event.state()))
                .build(),
        )
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let store = open_store(root).map_err(std::io::Error::other)?;
            app.manage(store);
            let widget = WebviewWindowBuilder::new(
                app,
                "widget",
                WebviewUrl::App("index.html?window=widget".into()),
            )
            .title("Noto · Schnellnotiz")
            .inner_size(64., 118.)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .focused(false)
            .focusable(false)
            .build()?;
            let saved: Option<String> = app
                .state::<Store>()
                .connection
                .lock()
                .unwrap()
                .query_row("SELECT value FROM settings WHERE key='widget'", [], |r| {
                    r.get(0)
                })
                .optional()?;
            if let Some(saved) = saved {
                if let Ok(v) = serde_json::from_str::<Value>(&saved) {
                    widget.set_position(tauri::PhysicalPosition::new(
                        v["x"].as_i64().unwrap_or(100) as i32,
                        v["y"].as_i64().unwrap_or(200) as i32,
                    ))?;
                }
            } else if let Some(m) = widget.primary_monitor()? {
                let a = m.work_area();
                widget.set_position(tauri::PhysicalPosition::new(
                    a.position.x + a.size.width as i32 - 64,
                    a.position.y + (a.size.height / 3) as i32,
                ))?;
            }
            let _ = position_widget(app.handle(), None, true);
            let open = MenuItem::with_id(app, "open", "Noto öffnen", true, None::<&str>)?;
            let capture = MenuItem::with_id(app, "capture", "Neue Notiz", true, None::<&str>)?;
            let toggle = MenuItem::with_id(
                app,
                "toggle",
                "Randwidget ein-/ausblenden",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Noto beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &capture, &toggle, &quit])?;
            let icon = app.default_window_icon().cloned().unwrap_or_else(|| {
                let mut pixels = vec![0u8; 32 * 32 * 4];
                for p in pixels.chunks_mut(4) {
                    p.copy_from_slice(&[50, 65, 110, 255])
                }
                tauri::image::Image::new_owned(pixels, 32, 32)
            });
            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Noto")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "capture" => shortcuts::capture(app),
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("widget") {
                            if w.is_visible().unwrap_or(false) {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle())
                    }
                })
                .build(app)?;
            shortcuts::setup(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_notes,
            get_note,
            put_note,
            search_notes,
            get_draft,
            list_drafts,
            save_draft,
            remove_draft,
            put_attachment,
            get_attachment,
            write_export,
            storage_path,
            open_vault,
            open_external,
            open_main,
            show_widget,
            hide_widget,
            snap_widget,
            widget_mode,
            shortcuts::shortcut_status,
            shortcuts::shortcut_set,
            intelligence::ai_key_status,
            intelligence::ai_models,
            intelligence::ai_set_key,
            intelligence::ai_request,
            intelligence::knowledge_list,
            intelligence::knowledge_put,
            intelligence::server_session_get,
            intelligence::server_session_set
        ])
        .run(tauri::generate_context!())
        .expect("Noto konnte nicht gestartet werden");
}

#[cfg(test)]
mod tests {
    #[test]
    fn external_links_reject_files_and_invalid_urls() {
        for url in ["file:///C:/Windows", "javascript:alert(1)", "C:\\Windows", "https://example.com\0bad"] {
            assert!(super::open_external(url.to_string()).is_err());
        }
    }
    use super::*;
    #[test]
    fn optimistic_save_and_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let store = open_store(dir.path().to_owned()).unwrap();
        let note = json!({"scope":"local","id":"abc","revision":"v1","content":"# Test\nUnverändert","createdAt":"today","updatedAt":"today","pinned":false,"archived":false,"deleted":false});
        save_note(&store, &note, None).unwrap();
        assert!(save_note(&store, &note, None).is_err());
        drop(store);
        let _store = open_store(dir.path().to_owned()).unwrap();
        let md = fs::read_to_string(dir.path().join("vault/local/notes/abc.md")).unwrap();
        assert!(md.ends_with("# Test\nUnverändert"));
    }
    #[test]
    fn paths_stay_inside_vault() {
        assert!(!safe_id("../escape"));
        assert!(!safe_id("C:\\escape"));
        assert!(!safe_id("/tmp"));
        assert!(safe_id("local"));
    }
    #[test]
    fn preserves_external_markdown_edits() {
        let dir = tempfile::tempdir().unwrap();
        let store = open_store(dir.path().to_owned()).unwrap();
        let note = json!({"scope":"local","id":"abc","revision":"v1","content":"Original","history":[{"revision":"v1","content":"Original","savedAt":"today"}],"createdAt":"today","updatedAt":"today","pinned":false,"archived":false,"deleted":false});
        save_note(&store, &note, None).unwrap();
        materialize(&store.root, &note).unwrap();
        fs::write(
            dir.path().join("vault/local/notes/abc.md"),
            "Extern ergänzt",
        )
        .unwrap();
        drop(store);
        let store = open_store(dir.path().to_owned()).unwrap();
        let c = store.connection.lock().unwrap();
        let count: i32 = c
            .query_row("SELECT count(*) FROM notes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let recovered: String = c
            .query_row("SELECT document FROM notes WHERE id<>'abc'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(recovered.contains("Extern ergänzt"));
    }
}
