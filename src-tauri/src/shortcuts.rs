use crate::{err, Result, Store};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub const DEFAULT: &str = "Control+Shift+Space";
pub const OPTIONS: [&str; 3] = [DEFAULT, "Control+Alt+Shift+KeyN", "Control+Alt+Shift+Space"];
#[derive(Clone, Serialize)]
pub struct Status {
    pub shortcut: String,
    pub active: bool,
    pub error: Option<String>,
}
pub struct Shortcuts {
    status: Mutex<Status>,
    held: AtomicBool,
}

pub fn setup(app: &tauri::AppHandle) -> Result<()> {
    let saved: Option<String> = app
        .state::<Store>()
        .connection
        .lock()
        .map_err(err)?
        .query_row(
            "SELECT value FROM settings WHERE key='capture-shortcut'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let shortcut = saved
        .filter(|s| OPTIONS.contains(&s.as_str()))
        .unwrap_or_else(|| DEFAULT.into());
    let result = app.global_shortcut().register(shortcut.as_str());
    let status = Status { shortcut, active: result.is_ok(), error: result.err().map(|_| "Tastenkürzel ist belegt oder Windows konnte es nicht registrieren. Wähle unter Einstellungen eine andere Kombination.".into()) };
    app.manage(Shortcuts {
        status: Mutex::new(status),
        held: AtomicBool::new(false),
    });
    Ok(())
}
pub fn handle(app: &tauri::AppHandle, event: ShortcutState) {
    let Some(state) = app.try_state::<Shortcuts>() else {
        return;
    };
    if event == ShortcutState::Released {
        state.held.store(false, Ordering::SeqCst);
        return;
    }
    if state.held.swap(true, Ordering::SeqCst) {
        return;
    }
    capture(app);
}
pub fn capture(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = crate::widget_mode(app.clone(), "edit".into());
        let _ = w.emit("quick-capture", ());
    }
}
#[tauri::command]
pub fn shortcut_status(app: tauri::AppHandle) -> Result<Status> {
    Ok(app.state::<Shortcuts>().status.lock().map_err(err)?.clone())
}
#[tauri::command]
pub fn shortcut_set(app: tauri::AppHandle, shortcut: String) -> Result<Status> {
    if !OPTIONS.contains(&shortcut.as_str()) {
        return Err("Nicht unterstütztes Tastenkürzel".into());
    }
    let state = app.state::<Shortcuts>();
    let mut status = state.status.lock().map_err(err)?;
    if status.active && status.shortcut == shortcut {
        return Ok(status.clone());
    }
    // Never release a working shortcut before its replacement is reserved.
    app.global_shortcut().register(shortcut.as_str()).map_err(|_| "Diese Kombination ist belegt oder kann nicht registriert werden. Das bisherige Kürzel bleibt unverändert.".to_string())?;
    let store = app.state::<Store>();
    let saved = (|| -> Result<()> {
        store.connection.lock().map_err(err)?.execute("INSERT INTO settings(key,value) VALUES('capture-shortcut',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![shortcut]).map_err(err)?;
        Ok(())
    })();
    if let Err(e) = saved {
        let _ = app.global_shortcut().unregister(shortcut.as_str());
        return Err(err(e));
    }
    if status.active {
        if let Err(e) = app.global_shortcut().unregister(status.shortcut.as_str()) {
            let _ = app.global_shortcut().unregister(shortcut.as_str());
            let _ = store.connection.lock().map_err(err)?.execute(
                "UPDATE settings SET value=?1 WHERE key='capture-shortcut'",
                params![status.shortcut],
            );
            return Err(err(e));
        }
    }
    *status = Status {
        shortcut,
        active: true,
        error: None,
    };
    state.held.store(false, Ordering::SeqCst);
    let result = status.clone();
    drop(status);
    let _ = app.emit("shortcut-changed", &result);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn supported_shortcuts_parse_and_are_distinct() {
        let parsed: Vec<tauri_plugin_global_shortcut::Shortcut> =
            OPTIONS.iter().map(|s| s.parse().unwrap()).collect();
        assert_eq!(parsed.len(), 3);
        assert_ne!(parsed[0], parsed[1]);
        assert_ne!(parsed[1], parsed[2]);
        assert_ne!(parsed[0], parsed[2]);
    }
}
