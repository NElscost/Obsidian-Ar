use std::{
    collections::{HashMap, HashSet},
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, SystemTime},
};

use anyhow::{Context, Result};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};
use walkdir::WalkDir;

#[derive(Clone)]
struct AppState {
    token: Arc<str>,
    vault: Arc<PathBuf>,
    graph: Arc<PathBuf>,
    pending: Option<Arc<PathBuf>>,
    graph_cache: Arc<RwLock<GraphCache>>,
    note_cache: Arc<RwLock<HashMap<String, CachedNote>>>,
    asset_cache: Arc<RwLock<HashMap<String, PathBuf>>>,
}

#[derive(Default)]
struct GraphCache {
    modified: Option<SystemTime>,
    size: u64,
    notes: HashSet<String>,
}

#[derive(Clone)]
struct CachedNote {
    modified: SystemTime,
    size: u64,
    content: Arc<str>,
}

#[derive(Deserialize)]
struct NoteRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetRequest {
    note_path: String,
    asset_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteResponse {
    path: String,
    title: String,
    content: Arc<str>,
    updated_at: String,
}

fn env_path(name: &str) -> Result<PathBuf> {
    env::var_os(name)
        .map(PathBuf::from)
        .with_context(|| format!("{name} é obrigatório"))
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value == format!("Bearer {token}"))
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    (status, Json(json!({ "error": message.into() }))).into_response()
}

fn normalize_note_path(value: &str) -> String {
    value.replace('\\', "/").trim_start_matches('/').to_string()
}

async fn refresh_graph(state: &AppState) -> Result<usize> {
    let metadata = tokio::fs::metadata(state.graph.as_ref()).await?;
    let modified = metadata.modified().ok();
    {
        let cache = state.graph_cache.read().await;
        if cache.modified == modified && cache.size == metadata.len() {
            return Ok(cache.notes.len());
        }
    }
    let bytes = tokio::fs::read(state.graph.as_ref()).await?;
    let graph: Value = serde_json::from_slice(&bytes)?;
    let notes = graph["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|node| node["id"].as_str())
        .map(normalize_note_path)
        .filter(|path| path.to_ascii_lowercase().ends_with(".md"))
        .collect::<HashSet<_>>();
    let count = notes.len();
    *state.graph_cache.write().await = GraphCache {
        modified,
        size: metadata.len(),
        notes,
    };
    println!("[GRAPH] lista atualizada sem reiniciar: {count} notas permitidas.");
    Ok(count)
}

async fn note_is_allowed(state: &AppState, path: &str) -> Result<bool> {
    refresh_graph(state).await?;
    Ok(state.graph_cache.read().await.notes.contains(path))
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match refresh_graph(&state).await {
        Ok(notes) => (StatusCode::OK, Json(json!({ "ok": true, "notes": notes }))).into_response(),
        Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

async fn verify(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    match refresh_graph(&state).await {
        Ok(notes) => (StatusCode::OK, Json(json!({ "ok": true, "notes": notes }))).into_response(),
        Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

async fn pending_optimization(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let Some(path) = &state.pending else {
        return (
            StatusCode::OK,
            Json(json!({ "generatedAt": null, "notes": [] })),
        )
            .into_response();
    };
    if let Err(err) = refresh_graph(&state).await {
        return error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string());
    }
    match tokio::fs::read(path.as_ref()).await {
        Ok(bytes) => {
            let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes);
            match serde_json::from_slice::<Value>(bytes) {
                Ok(mut value) => {
                    let allowed = state.graph_cache.read().await;
                    let notes = value["notes"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|entry| {
                            entry["path"]
                                .as_str()
                                .is_some_and(|path| allowed.notes.contains(path))
                        })
                        .cloned()
                        .collect::<Vec<_>>();
                    value["notes"] = Value::Array(notes);
                    (StatusCode::OK, Json(value)).into_response()
                }
                Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
            }
        }
        Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

async fn read_note(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<NoteRequest>,
) -> Response {
    let started = Instant::now();
    if !authorized(&headers, &state.token) {
        println!("[NOTE] pedido recusado: token inválido.");
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let path = normalize_note_path(&payload.path);
    println!("[NOTE] pedido recebido: {path}");
    match note_is_allowed(&state, &path).await {
        Ok(true) => {}
        Ok(false) => {
            return error(
                StatusCode::NOT_FOUND,
                "Nota não pertence ao grafo publicado.",
            )
        }
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
    let candidate = state.vault.join(Path::new(&path));
    let absolute = match tokio::fs::canonicalize(&candidate).await {
        Ok(path) if path.starts_with(state.vault.as_ref()) => path,
        _ => return error(StatusCode::BAD_REQUEST, "Caminho inválido."),
    };
    let metadata = match tokio::fs::metadata(&absolute).await {
        Ok(value) => value,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let cached = state.note_cache.read().await.get(&path).cloned();
    let content = if let Some(cached) =
        cached.filter(|item| item.modified == modified && item.size == metadata.len())
    {
        cached.content
    } else {
        match tokio::fs::read_to_string(&absolute).await {
            Ok(value) => {
                let value: Arc<str> = value.into();
                state.note_cache.write().await.insert(
                    path.clone(),
                    CachedNote {
                        modified,
                        size: metadata.len(),
                        content: value.clone(),
                    },
                );
                value
            }
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
        }
    };
    let title = Path::new(&path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Nota")
        .to_string();
    println!(
        "[NOTE] leitura OK via cache/arquivo: {path} ({} caracteres, {} ms)",
        content.len(),
        started.elapsed().as_millis()
    );
    Json(NoteResponse {
        path,
        title,
        content,
        updated_at: format!("{modified:?}"),
    })
    .into_response()
}

fn image_extension_allowed(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("avif" | "gif" | "jpg" | "jpeg" | "png" | "svg" | "webp")
    )
}

async fn resolve_asset(state: &AppState, note_path: &str, requested: &str) -> Result<PathBuf> {
    let normalized = requested
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
        .replace('\\', "/")
        .trim_start_matches("./")
        .to_string();
    let key = format!("{note_path}\n{normalized}");
    if let Some(path) = state.asset_cache.read().await.get(&key).cloned() {
        return Ok(path);
    }
    let note_dir = state
        .vault
        .join(note_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| state.vault.as_ref().clone());
    for candidate in [note_dir.join(&normalized), state.vault.join(&normalized)] {
        if let Ok(path) = tokio::fs::canonicalize(candidate).await {
            if path.starts_with(state.vault.as_ref()) && image_extension_allowed(&path) {
                state.asset_cache.write().await.insert(key, path.clone());
                return Ok(path);
            }
        }
    }
    let vault = state.vault.as_ref().clone();
    let wanted = Path::new(&normalized)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let found = tokio::task::spawn_blocking(move || {
        WalkDir::new(vault)
            .into_iter()
            .filter_map(Result::ok)
            .find(|entry| {
                entry.file_type().is_file()
                    && entry.file_name().to_string_lossy().to_ascii_lowercase() == wanted
                    && image_extension_allowed(entry.path())
            })
            .map(|entry| entry.into_path())
    })
    .await?
    .context("Imagem não encontrada no vault.")?;
    state.asset_cache.write().await.insert(key, found.clone());
    Ok(found)
}

async fn read_asset(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AssetRequest>,
) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let note_path = normalize_note_path(&payload.note_path);
    match note_is_allowed(&state, &note_path).await {
        Ok(true) => {}
        _ => return error(StatusCode::NOT_FOUND, "Nota não permitida."),
    }
    match resolve_asset(&state, &note_path, &payload.asset_path).await {
        Ok(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => Response::builder()
                .status(StatusCode::OK)
                .header(
                    header::CONTENT_TYPE,
                    mime_guess::from_path(&path)
                        .first_or_octet_stream()
                        .as_ref(),
                )
                .header(header::CACHE_CONTROL, "private, max-age=300")
                .body(Body::from(bytes))
                .unwrap(),
            Err(err) => error(StatusCode::NOT_FOUND, err.to_string()),
        },
        Err(err) => error(StatusCode::NOT_FOUND, err.to_string()),
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    let port = env::var("SPACE_NOTE_PORT")
        .unwrap_or_else(|_| "8765".into())
        .parse::<u16>()?;
    let token: Arc<str> = env::var("SPACE_NOTE_TOKEN")
        .context("SPACE_NOTE_TOKEN é obrigatório")?
        .into();
    let vault = tokio::fs::canonicalize(env_path("SPACE_VAULT_PATH")?).await?;
    let graph = env_path("SPACE_GRAPH_PATH")?;
    let pending = env::var_os("SPACE_PENDING_OPTIMIZATION_PATH").map(PathBuf::from);
    let allowed_origin =
        env::var("SPACE_ALLOWED_ORIGIN").context("SPACE_ALLOWED_ORIGIN é obrigatório")?;
    let origin = HeaderValue::from_str(&allowed_origin)?;
    let state = AppState {
        token,
        vault: Arc::new(vault),
        graph: Arc::new(graph),
        pending: pending.map(Arc::new),
        graph_cache: Default::default(),
        note_cache: Default::default(),
        asset_cache: Default::default(),
    };
    refresh_graph(&state).await?;
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);
    let app = Router::new()
        .route("/health", get(health))
        .route("/verify", get(verify))
        .route("/pending-optimization", get(pending_optimization))
        .route("/note", post(read_note))
        .route("/asset", post(read_asset))
        .layer(DefaultBodyLimit::max(16_384))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    println!("Obsidian Note Bridge Axum: http://127.0.0.1:{port}");
    println!("Cache automático por data de modificação; aguardando pedidos do Quest...");
    axum::serve(listener, app).await?;
    Ok(())
}
