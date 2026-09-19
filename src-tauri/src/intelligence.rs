use crate::{err, Result, Store};
use base64::Engine;
use rusqlite::params;
use serde_json::Value;
use tauri::State;
fn server_credential(server: &str) -> Result<keyring::Entry> {
    if !server.starts_with("https://") && !server.starts_with("http://127.0.0.1:") {
        return Err("Ungültiger Server".into());
    }
    keyring::Entry::new("Notto.ServerSession", server).map_err(err)
}
#[tauri::command]
pub fn server_session_get(server: String) -> Result<Option<String>> {
    match server_credential(&server)?.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(err(e)),
    }
}
#[tauri::command]
pub fn server_session_set(server: String, secret: String) -> Result<()> {
    let entry = server_credential(&server)?;
    if secret.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    } else {
        entry.set_password(&secret).map_err(err)
    }
}

fn credential() -> Result<keyring::Entry> {
    keyring::Entry::new("Notto.OpenAI", "api-key").map_err(err)
}
#[tauri::command]
pub fn ai_key_status() -> Result<bool> {
    match credential()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(err(e)),
    }
}
#[tauri::command]
pub fn ai_set_key(key: String) -> Result<()> {
    if key.is_empty() {
        match credential()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(err(e)),
        }
    } else {
        if key.len() > 1024 || key.contains(char::is_whitespace) {
            return Err("Ungültiger Schlüssel".into());
        }
        credential()?.set_password(&key).map_err(err)
    }
}
#[tauri::command]
pub async fn ai_models() -> Result<Vec<String>> {
    let key = credential()?
        .get_password()
        .map_err(|_| "Bitte zuerst einen OpenAI-Schlüssel hinterlegen.".to_string())?;
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(err)?
        .get("https://api.openai.com/v1/models")
        .bearer_auth(key)
        .send()
        .await
        .map_err(err)?;
    if !response.status().is_success() {
        return Err(format!(
            "Die OpenAI-Modellliste konnte nicht geladen werden ({}).",
            response.status()
        ));
    }
    let value: Value = response.json().await.map_err(err)?;
    let data = value["data"].as_array().ok_or("Ungültige Modellliste")?;
    Ok(data
        .iter()
        .filter_map(|m| m["id"].as_str().map(String::from))
        .collect())
}
#[tauri::command]
pub async fn ai_request(endpoint: String, mut body: Value) -> Result<Value> {
    if !["responses", "embeddings", "audio/transcriptions"].contains(&endpoint.as_str()) {
        return Err("Unzulässiger API-Aufruf".into());
    }
    if body.to_string().len() > 20 * 1024 * 1024 {
        return Err("Anfrage zu groß".into());
    }
    let key = credential()?
        .get_password()
        .map_err(|_| "Bitte den KI-Schlüssel in Notto hinterlegen.".to_string())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(err)?;
    let request = client
        .post(format!("https://api.openai.com/v1/{endpoint}"))
        .bearer_auth(key);
    let response = if endpoint == "audio/transcriptions" {
        let data = base64::engine::general_purpose::STANDARD
            .decode(body["audio"].as_str().unwrap_or(""))
            .map_err(err)?;
        if data.len() > 12 * 1024 * 1024 {
            return Err("Aufnahme zu groß".into());
        }
        let mime = body["mime"].as_str().unwrap_or("audio/webm");
        let name = if mime.starts_with("audio/mp4") {
            "recording.mp4"
        } else {
            "recording.webm"
        };
        let part = reqwest::multipart::Part::bytes(data)
            .file_name(name)
            .mime_str(mime)
            .map_err(err)?;
        request
            .multipart(
                reqwest::multipart::Form::new()
                    .text("model", "gpt-transcribe")
                    .part("file", part),
            )
            .send()
            .await
    } else {
        if endpoint == "responses" {
            body["store"] = false.into();
            body["max_output_tokens"] = 4000.into();
            body["max_tool_calls"] = 2.into();
        }
        request.json(&body).send().await
    }
    .map_err(err)?;
    let status = response.status();
    let value: Value = response.json().await.map_err(err)?;
    if !status.is_success() {
        return Err(format!(
            "KI-Anfrage fehlgeschlagen ({status}): {}",
            value["error"]["message"]
                .as_str()
                .unwrap_or("Unbekannter Fehler")
        ));
    }
    Ok(value)
}
fn table(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS knowledge(scope TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,PRIMARY KEY(scope,id));").map_err(err)
}
#[tauri::command]
pub fn knowledge_list(scope: String, store: State<Store>) -> Result<Vec<Value>> {
    let conn = store.connection.lock().map_err(err)?;
    table(&conn)?;
    let mut stmt = conn
        .prepare("SELECT document FROM knowledge WHERE scope=?1")
        .map_err(err)?;
    let rows = stmt
        .query_map([scope], |row| row.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
        .collect()
}
#[tauri::command]
pub fn knowledge_put(
    scope: String,
    id: String,
    document: Value,
    store: State<Store>,
) -> Result<()> {
    if document["scope"].as_str() != Some(&scope) || document["id"].as_str() != Some(&id) {
        return Err("Ungültiger Datensatz".into());
    }
    let conn = store.connection.lock().map_err(err)?;
    table(&conn)?;
    conn.execute("INSERT INTO knowledge(scope,id,document) VALUES(?1,?2,?3) ON CONFLICT(scope,id) DO NOTHING", params![scope,id,document.to_string()]).map_err(err)?;
    Ok(())
}
