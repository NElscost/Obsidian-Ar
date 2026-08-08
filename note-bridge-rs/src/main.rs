use std::io::SeekFrom;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, SystemTime},
};

use anyhow::{bail, Context, Result};
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
use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymphoniaError,
    formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};
use symphonia::default::{get_codecs, get_probe};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
    process::Command,
    sync::RwLock,
};
use tokio_util::io::ReaderStream;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use walkdir::WalkDir;

#[derive(Clone)]
struct AppState {
    token: Arc<str>,
    vault: Arc<PathBuf>,
    graph: Option<Arc<PathBuf>>,
    pending: Option<Arc<PathBuf>>,
    graph_cache: Arc<RwLock<GraphCache>>,
    note_cache: Arc<RwLock<HashMap<String, CachedNote>>>,
    asset_cache: Arc<RwLock<HashMap<String, PathBuf>>>,
    waveform_cache: Arc<RwLock<HashMap<String, CachedWaveform>>>,
    video_cache: Arc<RwLock<HashMap<String, CachedVideo>>>,
    remote_client: reqwest::Client,
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

#[derive(Clone)]
struct CachedWaveform {
    modified: SystemTime,
    size: u64,
    response: WaveformResponse,
}

#[derive(Clone)]
struct CachedVideo {
    modified: SystemTime,
    size: u64,
    compatible_path: PathBuf,
}

const BRIDGE_API_VERSION: u32 = 2;

fn is_allowed_web_origin(origin: &HeaderValue) -> bool {
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(uri) = origin.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(scheme) = uri.scheme_str() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };

    if scheme.eq_ignore_ascii_case("https") {
        return true;
    }

    if !scheme.eq_ignore_ascii_case("http") {
        return false;
    }

    matches!(
        authority.host().to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | "[::1]"
    )
}

#[cfg(test)]
mod origin_tests {
    use super::*;

    #[test]
    fn accepts_any_https_host() {
        assert!(is_allowed_web_origin(&HeaderValue::from_static(
            "https://example.github.io"
        )));
        assert!(is_allowed_web_origin(&HeaderValue::from_static(
            "https://visualizador.example:8443"
        )));
    }

    #[test]
    fn accepts_http_only_for_local_development() {
        assert!(is_allowed_web_origin(&HeaderValue::from_static(
            "http://localhost:3001"
        )));
        assert!(is_allowed_web_origin(&HeaderValue::from_static(
            "http://127.0.0.1:3001"
        )));
        assert!(!is_allowed_web_origin(&HeaderValue::from_static(
            "http://visualizador.example"
        )));
    }

    #[test]
    fn rejects_non_web_and_opaque_origins() {
        assert!(!is_allowed_web_origin(&HeaderValue::from_static("null")));
        assert!(!is_allowed_web_origin(&HeaderValue::from_static(
            "file://local"
        )));
    }

    #[test]
    fn waveform_is_normalized_to_requested_size() {
        let waveform = normalize_waveform(&[0.0, 0.25, 0.5, 1.0], 8);
        assert_eq!(waveform.len(), 8);
        assert_eq!(waveform.iter().copied().max(), Some(255));
    }

    #[test]
    fn empty_waveform_is_silent() {
        assert_eq!(normalize_waveform(&[], 4), vec![0, 0, 0, 0]);
    }
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformResponse {
    duration: f64,
    samples: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteImageRequest {
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NoteResponse {
    path: String,
    title: String,
    content: Arc<str>,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveGraph {
    generated_at: String,
    nodes: Vec<LiveNode>,
    links: Vec<LiveLink>,
}

#[derive(Serialize)]
struct LiveNode {
    id: String,
    label: String,
    color: String,
    val: u32,
}

#[derive(Serialize)]
struct LiveLink {
    source: String,
    target: String,
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
    let Some(graph_path) = &state.graph else {
        let notes = vault_note_paths(state.vault.as_ref())?;
        let count = notes.len();
        state.graph_cache.write().await.notes = notes;
        return Ok(count);
    };
    let metadata = tokio::fs::metadata(graph_path.as_ref()).await?;
    let modified = metadata.modified().ok();
    {
        let cache = state.graph_cache.read().await;
        if cache.modified == modified && cache.size == metadata.len() {
            return Ok(cache.notes.len());
        }
    }
    let bytes = tokio::fs::read(graph_path.as_ref()).await?;
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

fn vault_note_paths(vault: &Path) -> Result<HashSet<String>> {
    Ok(WalkDir::new(vault)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| entry.file_name() != ".obsidian")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        })
        .filter_map(|entry| entry.path().strip_prefix(vault).ok().map(normalize_path))
        .collect())
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn note_key(value: &str) -> String {
    let normalized = value
        .replace('\\', "/")
        .trim()
        .trim_start_matches("./")
        .to_lowercase();
    normalized
        .strip_suffix(".md")
        .unwrap_or(&normalized)
        .to_string()
}

fn note_label(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn folder_color(path: &str) -> String {
    const PALETTE: [&str; 12] = [
        "#78a9ff", "#7bdcb5", "#d9a7ff", "#ff9f9f", "#ffd166", "#64d8ff", "#b8e986", "#ffb86b",
        "#8be9fd", "#bd93f9", "#50fa7b", "#ff79c6",
    ];
    let folder = path.split('/').next().unwrap_or("");
    let hash = folder.bytes().fold(2_166_136_261_u32, |value, byte| {
        (value ^ u32::from(byte)).wrapping_mul(16_777_619)
    });
    PALETTE[hash as usize % PALETTE.len()].to_string()
}

fn wikilink_targets(content: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut offset = 0;
    while let Some(start) = content[offset..].find("[[") {
        let body_start = offset + start + 2;
        let Some(end) = content[body_start..].find("]]") else {
            break;
        };
        let body_end = body_start + end;
        let target = content[body_start..body_end]
            .split('|')
            .next()
            .unwrap_or("")
            .split('#')
            .next()
            .unwrap_or("")
            .trim();
        if !target.is_empty() {
            targets.push(target.to_string());
        }
        offset = body_end + 2;
    }
    targets
}

fn markdown_link_targets(content: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut offset = 0;
    while let Some(start) = content[offset..].find("](") {
        let body_start = offset + start + 2;
        let Some(end) = content[body_start..].find(')') else {
            break;
        };
        let body_end = body_start + end;
        let target = content[body_start..body_end]
            .split('#')
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('<')
            .trim_matches('>')
            .replace("%20", " ");
        if target.to_lowercase().ends_with(".md")
            && !target.contains("://")
            && !target.starts_with('#')
        {
            targets.push(target);
        }
        offset = body_end + 1;
    }
    targets
}

fn resolve_wikilink(
    source: &str,
    target: &str,
    exact: &HashMap<String, String>,
    by_stem: &HashMap<String, Option<String>>,
) -> Option<String> {
    let key = note_key(target);
    if let Some(path) = exact.get(&key) {
        return Some(path.clone());
    }
    let source_parent = Path::new(source).parent().unwrap_or_else(|| Path::new(""));
    let relative = normalize_path(&source_parent.join(target));
    if let Some(path) = exact.get(&note_key(&relative)) {
        return Some(path.clone());
    }
    let stem = Path::new(target)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(target)
        .to_lowercase();
    by_stem.get(&stem).and_then(Clone::clone)
}

fn scan_live_graph(vault: &Path) -> Result<LiveGraph> {
    let mut paths = vault_note_paths(vault)?.into_iter().collect::<Vec<_>>();
    paths.sort_unstable();
    let mut exact = HashMap::new();
    let mut by_stem: HashMap<String, Option<String>> = HashMap::new();
    for path in &paths {
        exact.insert(note_key(path), path.clone());
        let stem = note_label(path).to_lowercase();
        by_stem
            .entry(stem)
            .and_modify(|value| *value = None)
            .or_insert_with(|| Some(path.clone()));
    }

    let mut links = HashSet::new();
    let mut degree = HashMap::<String, u32>::new();
    for source in &paths {
        let content = fs::read_to_string(vault.join(source)).unwrap_or_default();
        let targets = wikilink_targets(&content)
            .into_iter()
            .chain(markdown_link_targets(&content));
        for raw_target in targets {
            let Some(target) = resolve_wikilink(source, &raw_target, &exact, &by_stem) else {
                continue;
            };
            if source == &target || !links.insert((source.clone(), target.clone())) {
                continue;
            }
            *degree.entry(source.clone()).or_default() += 1;
            *degree.entry(target).or_default() += 1;
        }
    }

    let nodes = paths
        .into_iter()
        .map(|path| LiveNode {
            label: note_label(&path),
            color: folder_color(&path),
            val: degree.get(&path).copied().unwrap_or(0).clamp(1, 12),
            id: path,
        })
        .collect();
    let mut links = links
        .into_iter()
        .map(|(source, target)| LiveLink { source, target })
        .collect::<Vec<_>>();
    links.sort_unstable_by(|left, right| {
        (&left.source, &left.target).cmp(&(&right.source, &right.target))
    });
    Ok(LiveGraph {
        generated_at: format!("{:?}", SystemTime::now()),
        nodes,
        links,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_wikilinks_without_aliases_or_headings() {
        assert_eq!(
            wikilink_targets("[[Nota A|apelido]] e ![[Pasta/Nota B#Seção]]"),
            vec!["Nota A", "Pasta/Nota B"]
        );
    }

    #[test]
    fn extracts_only_markdown_note_links() {
        assert_eq!(
            markdown_link_targets(
                "[nota](Pasta/Minha%20Nota.md#Parte) [site](https://example.com)"
            ),
            vec!["Pasta/Minha Nota.md"]
        );
    }

    #[test]
    fn resolves_unique_note_by_stem() {
        let exact = HashMap::from([(
            "exemplos/tópicos/conceito".to_string(),
            "Exemplos/Tópicos/Conceito.md".to_string(),
        )]);
        let by_stem = HashMap::from([(
            "conceito".to_string(),
            Some("Exemplos/Tópicos/Conceito.md".to_string()),
        )]);
        assert_eq!(
            resolve_wikilink("Outra.md", "Conceito", &exact, &by_stem),
            Some("Exemplos/Tópicos/Conceito.md".to_string())
        );
    }

    #[test]
    fn allows_images_audio_and_video_but_rejects_other_assets() {
        assert!(asset_extension_allowed(Path::new("imagem.webp")));
        assert!(asset_extension_allowed(Path::new("gravacao.mp3")));
        assert!(asset_extension_allowed(Path::new("voz.opus")));
        assert!(asset_extension_allowed(Path::new("demonstracao.mp4")));
        assert!(asset_extension_allowed(Path::new("captura.webm")));
        assert!(!asset_extension_allowed(Path::new("script.exe")));
        assert!(!asset_extension_allowed(Path::new("nota.md")));
        assert!(compatibility_video_candidate(Path::new("video.mp4")));
        assert!(compatibility_video_candidate(Path::new("video.mov")));
        assert!(!compatibility_video_candidate(Path::new("video.webm")));
    }

    #[test]
    fn parses_http_byte_ranges() {
        let range = HeaderValue::from_static("bytes=100-199");
        assert_eq!(parse_byte_range(Some(&range), 1000), Ok(Some((100, 199))));
        let open = HeaderValue::from_static("bytes=900-");
        assert_eq!(parse_byte_range(Some(&open), 1000), Ok(Some((900, 999))));
        let suffix = HeaderValue::from_static("bytes=-125");
        assert_eq!(parse_byte_range(Some(&suffix), 1000), Ok(Some((875, 999))));
        let invalid = HeaderValue::from_static("bytes=1000-");
        assert_eq!(parse_byte_range(Some(&invalid), 1000), Err(()));
    }

    #[test]
    fn remote_image_proxy_is_restricted_to_wikimedia_https() {
        assert!(wikimedia_image_url_allowed(
            &reqwest::Url::parse(
                "https://commons.wikimedia.org/wiki/Special:FilePath/Papyrus66.jpg"
            )
            .unwrap()
        ));
        assert!(wikimedia_image_url_allowed(
            &reqwest::Url::parse("https://upload.wikimedia.org/example.jpg").unwrap()
        ));
        assert!(!wikimedia_image_url_allowed(
            &reqwest::Url::parse("http://commons.wikimedia.org/example.jpg").unwrap()
        ));
        assert!(!wikimedia_image_url_allowed(
            &reqwest::Url::parse("https://commons.wikimedia.org.evil.test/example.jpg").unwrap()
        ));
    }
}

async fn live_graph(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let started = Instant::now();
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let vault = state.vault.clone();
    match tokio::task::spawn_blocking(move || scan_live_graph(vault.as_ref())).await {
        Ok(Ok(graph)) => {
            let notes = graph
                .nodes
                .iter()
                .map(|node| node.id.clone())
                .collect::<HashSet<_>>();
            state.graph_cache.write().await.notes.extend(notes);
            println!(
                "[GRAPH] grafo dinâmico: {} nós, {} conexões ({} ms).",
                graph.nodes.len(),
                graph.links.len(),
                started.elapsed().as_millis()
            );
            (StatusCode::OK, Json(graph)).into_response()
        }
        Ok(Err(err)) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
        Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

async fn note_is_allowed(state: &AppState, path: &str) -> Result<bool> {
    refresh_graph(state).await?;
    Ok(state.graph_cache.read().await.notes.contains(path))
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    match refresh_graph(&state).await {
        Ok(notes) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "notes": notes,
                "apiVersion": BRIDGE_API_VERSION,
                "capabilities": ["video-transcode", "byte-ranges", "waveform"]
            })),
        )
            .into_response(),
        Err(err) => error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    }
}

async fn verify(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    match refresh_graph(&state).await {
        Ok(notes) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "notes": notes,
                "apiVersion": BRIDGE_API_VERSION,
                "capabilities": ["video-transcode", "byte-ranges", "waveform"]
            })),
        )
            .into_response(),
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

fn asset_extension_allowed(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some(
            "aac"
                | "avif"
                | "flac"
                | "gif"
                | "jpg"
                | "jpeg"
                | "m4a"
                | "m4v"
                | "mov"
                | "mp3"
                | "mp4"
                | "oga"
                | "ogg"
                | "ogv"
                | "opus"
                | "png"
                | "svg"
                | "wav"
                | "webm"
                | "webp"
        )
    )
}

fn compatibility_video_candidate(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase())
            .as_deref(),
        Some("m4v" | "mov" | "mp4")
    )
}

async fn compatible_video_asset(state: &AppState, path: &Path) -> Result<PathBuf> {
    if !compatibility_video_candidate(path) {
        return Ok(path.to_path_buf());
    }
    let metadata = tokio::fs::metadata(path).await?;
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let cache_key = path.to_string_lossy().to_string();
    if let Some(cached) = state
        .video_cache
        .read()
        .await
        .get(&cache_key)
        .filter(|cached| cached.modified == modified && cached.size == metadata.len())
        .cloned()
    {
        return Ok(cached.compatible_path);
    }
    let probe = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .await;
    let codec = match probe {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .trim()
            .to_ascii_lowercase(),
        _ => return Ok(path.to_path_buf()),
    };
    if !matches!(codec.as_str(), "av1" | "hevc" | "h265") {
        let compatible_path = path.to_path_buf();
        state.video_cache.write().await.insert(
            cache_key,
            CachedVideo {
                modified,
                size: metadata.len(),
                compatible_path: compatible_path.clone(),
            },
        );
        return Ok(compatible_path);
    }
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    metadata
        .modified()
        .unwrap_or(SystemTime::UNIX_EPOCH)
        .hash(&mut hasher);
    let cache_dir = env::temp_dir().join("obsidian-ar-video-cache");
    tokio::fs::create_dir_all(&cache_dir).await?;
    let output_path = cache_dir.join(format!("{:016x}.mp4", hasher.finish()));
    if tokio::fs::metadata(&output_path)
        .await
        .map(|cached| cached.len() > 0)
        .unwrap_or(false)
    {
        state.video_cache.write().await.insert(
            cache_key,
            CachedVideo {
                modified,
                size: metadata.len(),
                compatible_path: output_path.clone(),
            },
        );
        return Ok(output_path);
    }

    let partial_path = output_path.with_extension(format!(
        "partial-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    println!(
        "[VIDEO] convertendo codec {codec} para H.264: {}",
        path.display()
    );
    let status = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(path)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(&partial_path)
        .status()
        .await;
    match status {
        Ok(status) if status.success() => {
            if tokio::fs::rename(&partial_path, &output_path)
                .await
                .is_err()
            {
                let _ = tokio::fs::remove_file(&output_path).await;
                tokio::fs::rename(&partial_path, &output_path).await?;
            }
            println!("[VIDEO] cache H.264 pronto: {}", output_path.display());
            state.video_cache.write().await.insert(
                cache_key,
                CachedVideo {
                    modified,
                    size: metadata.len(),
                    compatible_path: output_path.clone(),
                },
            );
            Ok(output_path)
        }
        Ok(status) => {
            let _ = tokio::fs::remove_file(&partial_path).await;
            bail!("FFmpeg não conseguiu converter o vídeo ({status}).")
        }
        Err(err) => {
            let _ = tokio::fs::remove_file(&partial_path).await;
            bail!("Este vídeo usa {codec}; instale FFmpeg para convertê-lo para H.264: {err}")
        }
    }
}

fn parse_byte_range(value: Option<&HeaderValue>, total: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(value) = value else { return Ok(None) };
    let value = value.to_str().map_err(|_| ())?;
    let spec = value.strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') || total == 0 {
        return Err(());
    }
    let (start, end) = spec.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        let start = total.saturating_sub(suffix);
        return Ok(Some((start, total - 1)));
    }
    let start = start.parse::<u64>().map_err(|_| ())?;
    if start >= total {
        return Err(());
    }
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(total - 1)
    };
    if end < start {
        return Err(());
    }
    Ok(Some((start, end)))
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
            if path.starts_with(state.vault.as_ref()) && asset_extension_allowed(&path) {
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
                    && asset_extension_allowed(entry.path())
            })
            .map(|entry| entry.into_path())
    })
    .await?
    .context("Mídia não encontrada no vault.")?;
    state.asset_cache.write().await.insert(key, found.clone());
    Ok(found)
}

const WAVEFORM_SAMPLE_COUNT: usize = 512;
const WAVEFORM_CHUNK_FRAMES: usize = 1024;

fn normalize_waveform(chunks: &[f32], target: usize) -> Vec<u8> {
    if target == 0 {
        return Vec::new();
    }
    if chunks.is_empty() {
        return vec![0; target];
    }
    let mut reduced = Vec::with_capacity(target);
    for index in 0..target {
        let start = index * chunks.len() / target;
        let mut end = (index + 1) * chunks.len() / target;
        if end <= start {
            end = (start + 1).min(chunks.len());
        }
        let slice = &chunks[start.min(chunks.len() - 1)..end];
        reduced.push(slice.iter().sum::<f32>() / slice.len() as f32);
    }
    let peak = reduced.iter().copied().fold(0.0_f32, f32::max);
    if peak <= f32::EPSILON {
        return vec![0; target];
    }
    reduced
        .into_iter()
        .map(|value| ((value / peak).clamp(0.0, 1.0) * 255.0).round() as u8)
        .collect()
}

fn analyze_audio_waveform(path: &Path) -> Result<WaveformResponse> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("Não foi possível abrir o áudio: {}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = get_probe().format(
        &hint,
        stream,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    )?;
    let mut format = probed.format;
    // Em contêineres de vídeo, default_track() normalmente escolhe a faixa de
    // imagem. A forma de onda deve procurar explicitamente uma faixa de áudio.
    let track = format
        .tracks()
        .iter()
        .find(|track| track.codec_params.sample_rate.is_some())
        .context("A mídia não contém uma faixa de áudio decodificável.")?;
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.unwrap_or(48_000).max(1);
    let mut decoder = get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
    let mut chunks = Vec::new();
    let mut chunk_sum = 0.0_f32;
    let mut chunk_frames = 0_usize;
    let mut total_frames = 0_u64;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => return Err(error.into()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => return Err(error.into()),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count().max(1);
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        samples.copy_interleaved_ref(decoded);
        for frame in samples.samples().chunks(channels) {
            chunk_sum += frame.iter().map(|sample| sample.abs()).sum::<f32>() / channels as f32;
            chunk_frames += 1;
            total_frames += 1;
            if chunk_frames == WAVEFORM_CHUNK_FRAMES {
                chunks.push(chunk_sum / chunk_frames as f32);
                chunk_sum = 0.0;
                chunk_frames = 0;
            }
        }
    }
    if chunk_frames > 0 {
        chunks.push(chunk_sum / chunk_frames as f32);
    }
    Ok(WaveformResponse {
        duration: total_frames as f64 / sample_rate as f64,
        samples: normalize_waveform(&chunks, WAVEFORM_SAMPLE_COUNT),
    })
}

async fn read_waveform(
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
    let path = match resolve_asset(&state, &note_path, &payload.asset_path).await {
        Ok(path) => path,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let key = path.to_string_lossy().to_string();
    if let Some(cached) = state
        .waveform_cache
        .read()
        .await
        .get(&key)
        .filter(|cached| cached.modified == modified && cached.size == metadata.len())
        .cloned()
    {
        return Json(cached.response).into_response();
    }
    let analysis_path = path.clone();
    let response =
        match tokio::task::spawn_blocking(move || analyze_audio_waveform(&analysis_path)).await {
            Ok(Ok(response)) => response,
            Ok(Err(err)) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
            Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
        };
    state.waveform_cache.write().await.insert(
        key,
        CachedWaveform {
            modified,
            size: metadata.len(),
            response: response.clone(),
        },
    );
    Json(response).into_response()
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
        Ok(path) => {
            let path = match compatible_video_asset(&state, &path).await {
                Ok(path) => path,
                Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
            };
            match File::open(&path).await {
                Ok(mut file) => {
                    let content_length = file.metadata().await.ok().map(|metadata| metadata.len());
                    let range = match content_length {
                        Some(total) => match parse_byte_range(headers.get(header::RANGE), total) {
                            Ok(range) => range,
                            Err(()) => {
                                return Response::builder()
                                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                                    .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                                    .body(Body::empty())
                                    .unwrap();
                            }
                        },
                        None => None,
                    };
                    let (status, body_length) = if let Some((start, end)) = range {
                        if let Err(err) = file.seek(SeekFrom::Start(start)).await {
                            return error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string());
                        }
                        (StatusCode::PARTIAL_CONTENT, Some(end - start + 1))
                    } else {
                        (StatusCode::OK, content_length)
                    };
                    let mut response = Response::builder()
                        .status(status)
                        .header(
                            header::CONTENT_TYPE,
                            mime_guess::from_path(&path)
                                .first_or_octet_stream()
                                .as_ref(),
                        )
                        .header(header::CACHE_CONTROL, "private, max-age=300")
                        .header(header::ACCEPT_RANGES, "bytes");
                    if let (Some((start, end)), Some(total)) = (range, content_length) {
                        response = response.header(
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total}"),
                        );
                    }
                    if let Some(length) = body_length {
                        response = response.header(header::CONTENT_LENGTH, length);
                    }
                    let stream = if let Some(length) = body_length {
                        ReaderStream::new(file.take(length))
                    } else {
                        ReaderStream::new(file.take(u64::MAX))
                    };
                    response.body(Body::from_stream(stream)).unwrap()
                }
                Err(err) => error(StatusCode::NOT_FOUND, err.to_string()),
            }
        }
        Err(err) => error(StatusCode::NOT_FOUND, err.to_string()),
    }
}

fn wikimedia_image_url_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && matches!(
            url.host_str()
                .map(|host| host.to_ascii_lowercase())
                .as_deref(),
            Some("commons.wikimedia.org" | "upload.wikimedia.org")
        )
}

async fn read_remote_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RemoteImageRequest>,
) -> Response {
    const MAX_IMAGE_BYTES: u64 = 12 * 1024 * 1024;
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let url = match reqwest::Url::parse(&payload.url) {
        Ok(url) if wikimedia_image_url_allowed(&url) => url,
        _ => {
            return error(
                StatusCode::BAD_REQUEST,
                "Somente imagens HTTPS do Wikimedia são permitidas.",
            )
        }
    };
    let response = match state.remote_client.get(url).send().await {
        Ok(response) => response,
        Err(err) => return error(StatusCode::BAD_GATEWAY, err.to_string()),
    };
    if !response.status().is_success() || !wikimedia_image_url_allowed(response.url()) {
        return error(
            StatusCode::BAD_GATEWAY,
            "O Wikimedia recusou a imagem ou redirecionou para outro domínio.",
        );
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if !content_type.to_ascii_lowercase().starts_with("image/") {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "A resposta remota não é uma imagem.",
        );
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_IMAGE_BYTES)
    {
        return error(StatusCode::PAYLOAD_TOO_LARGE, "Imagem remota excede 12 MB.");
    }
    let bytes = match response.bytes().await {
        Ok(bytes) if bytes.len() as u64 <= MAX_IMAGE_BYTES => bytes,
        Ok(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "Imagem remota excede 12 MB."),
        Err(err) => return error(StatusCode::BAD_GATEWAY, err.to_string()),
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "private, max-age=86400")
        .header(header::CONTENT_LENGTH, bytes.len())
        .body(Body::from(bytes))
        .unwrap()
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
    let graph = env::var_os("SPACE_GRAPH_PATH")
        .map(PathBuf::from)
        .filter(|path| path.is_file());
    let pending = env::var_os("SPACE_PENDING_OPTIMIZATION_PATH").map(PathBuf::from);
    let state = AppState {
        token,
        vault: Arc::new(vault),
        graph: graph.map(Arc::new),
        pending: pending.map(Arc::new),
        graph_cache: Default::default(),
        note_cache: Default::default(),
        asset_cache: Default::default(),
        waveform_cache: Default::default(),
        video_cache: Default::default(),
        remote_client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("Obsidian-Ar/1.0")
            .build()?,
    };
    refresh_graph(&state).await?;
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _request| {
            is_allowed_web_origin(origin)
        }))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::HeaderName::from_static("cf-access-client-id"),
            header::HeaderName::from_static("cf-access-client-secret"),
        ]);
    let app = Router::new()
        .route("/health", get(health))
        .route("/verify", get(verify))
        .route("/graph", get(live_graph))
        .route("/pending-optimization", get(pending_optimization))
        .route("/note", post(read_note))
        .route("/asset", post(read_asset))
        .route("/waveform", post(read_waveform))
        .route("/remote-image", post(read_remote_image))
        .layer(DefaultBodyLimit::max(16_384))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    println!("Obsidian Note Bridge Axum: http://127.0.0.1:{port}");
    println!("CORS: qualquer visualizador HTTPS (HTTP somente em localhost)");
    println!("Cache automático por data de modificação; aguardando pedidos do Quest...");
    axum::serve(listener, app).await?;
    Ok(())
}
