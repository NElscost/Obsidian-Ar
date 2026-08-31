use std::io::SeekFrom;
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    hash::{DefaultHasher, Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, Instant, SystemTime},
};

use anyhow::{bail, Context, Result};
use axum::{
    body::Body,
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use midly::{MetaMessage, MidiMessage, Smf, Timing, TrackEventKind};
use notify::{RecursiveMode, Watcher};
use rand::RngCore;
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
    sync::{Mutex, RwLock},
};
use tokio_util::io::ReaderStream;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use walkdir::WalkDir;

static YOUTUBE_DOWNLOAD_LOCK: Mutex<()> = Mutex::const_new(());
static YOUTUBE_FAILURE_CACHE: OnceLock<RwLock<HashMap<String, (Instant, String)>>> =
    OnceLock::new();

fn youtube_failure_cache() -> &'static RwLock<HashMap<String, (Instant, String)>> {
    YOUTUBE_FAILURE_CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

#[derive(Clone)]
struct AppState {
    token: Arc<str>,
    vault: Arc<PathBuf>,
    graph: Option<Arc<PathBuf>>,
    pending: Option<Arc<PathBuf>>,
    graph_cache: Arc<RwLock<GraphCache>>,
    graph_revision: Arc<AtomicU64>,
    note_cache: Arc<RwLock<HashMap<String, CachedNote>>>,
    asset_cache: Arc<RwLock<HashMap<String, PathBuf>>>,
    waveform_cache: Arc<RwLock<HashMap<String, CachedWaveform>>>,
    midi_cache: Arc<RwLock<HashMap<String, CachedMidi>>>,
    ambilight_cache: Arc<RwLock<HashMap<String, CachedAmbilight>>>,
    video_cache: Arc<RwLock<HashMap<String, CachedVideo>>>,
    stock_cache: Arc<RwLock<HashMap<String, CachedStock>>>,
    media_tickets: Arc<RwLock<HashMap<String, MediaTicket>>>,
    remote_client: reqwest::Client,
    remote_video_hosts: Arc<HashSet<String>>,
    remote_video_max_height: u16,
    remote_video_max_size_mb: u64,
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
struct CachedMidi {
    modified: SystemTime,
    size: u64,
    response: MidiVizResponse,
}
#[derive(Clone)]
struct CachedAmbilight {
    modified: SystemTime,
    size: u64,
    response: AmbilightResponse,
}

#[derive(Clone)]
struct CachedVideo {
    modified: SystemTime,
    size: u64,
    compatible_path: PathBuf,
}

#[derive(Clone)]
struct CachedStock {
    expires_at: Instant,
    response: StockChartResponse,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StockChartRequest {
    symbol: String,
    days: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockPoint {
    timestamp: i64,
    open: f64,
    high: f64,
    low: f64,
    close: f64,
    volume: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StockChartResponse {
    symbol: String,
    name: String,
    currency: String,
    price: f64,
    change_percent: f64,
    updated_at: i64,
    points: Vec<StockPoint>,
}

#[derive(Clone)]
struct MediaTicket {
    path: PathBuf,
    expires_at: Instant,
}

const MEDIA_TICKET_TTL: Duration = Duration::from_secs(30 * 60);

fn bridge_capabilities(_state: &AppState) -> Vec<&'static str> {
    vec![
        "video-transcode",
        "byte-ranges",
        "media-tickets",
        "youtube-video",
        "remote-video",
        "waveform",
        "midi-viz",
        "video-ambilight",
        "stock-chart",
    ]
}

const BRIDGE_API_VERSION: u32 = 4;

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

fn start_graph_watcher(vault: Arc<PathBuf>, revision: Arc<AtomicU64>) {
    std::thread::spawn(move || {
        let callback_revision = revision.clone();
        let mut watcher =
            match notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                let Ok(event) = event else { return };
                if event.paths.iter().any(|path| {
                    path.extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
                }) {
                    callback_revision.fetch_add(1, Ordering::Relaxed);
                }
            }) {
                Ok(watcher) => watcher,
                Err(error) => {
                    eprintln!("[GRAPH] observador indisponível: {error}");
                    return;
                }
            };
        if let Err(error) = watcher.watch(vault.as_ref(), RecursiveMode::Recursive) {
            eprintln!("[GRAPH] não foi possível observar o vault: {error}");
            return;
        }
        println!("[GRAPH] atualização ao vivo ativa para notas e links.");
        loop {
            std::thread::park();
        }
    });
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

    #[test]
    fn ambilight_reduces_uniform_frame_to_four_equal_edges() {
        let frame = [12_u8, 34, 56].repeat(AMBILIGHT_WIDTH * AMBILIGHT_HEIGHT);
        let response = analyze_ambilight_frames(&frame);
        assert_eq!(response.frames.len(), 1);
        assert_eq!(
            response.frames[0],
            [12, 34, 56, 12, 34, 56, 12, 34, 56, 12, 34, 56]
        );
    }

    #[test]
    fn restricts_youtube_video_hosts() {
        assert!(remote_video_url_allowed("https://www.youtube.com/watch?v=abc", &default_remote_video_hosts()));
        assert!(remote_video_url_allowed("https://youtu.be/abc", &default_remote_video_hosts()));
        assert!(remote_video_url_allowed("https://streamable.com/abc123", &default_remote_video_hosts()));
        assert!(!remote_video_url_allowed("http://youtube.com/watch?v=abc", &default_remote_video_hosts()));
        assert!(!remote_video_url_allowed("https://youtube.com.evil.test/watch?v=abc", &default_remote_video_hosts()));
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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiVizNote {
    pitch: u8,
    start: f64,
    duration: f64,
    start_beat: f64,
    duration_beats: f64,
    velocity: u8,
    channel: u8,
    track: u16,
    quantized_start_beat: f64,
    quantized_duration_beats: f64,
    measure: u32,
    beat_in_measure: f64,
    hand: u8,
    voice: u8,
    spelling: String,
    dotted: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiTempoPoint {
    beat: f64,
    bpm: f64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiTimeSignaturePoint {
    beat: f64,
    numerator: u8,
    denominator: u8,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiKeySignaturePoint {
    beat: f64,
    sharps: i8,
    minor: bool,
    name: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiPlaybackEvent {
    time: f64,
    note: usize,
    on: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MidiVizResponse {
    title: String,
    duration: f64,
    track_count: usize,
    beats_per_measure: u8,
    beat_unit: u8,
    ppq: u64,
    tempo_map: Vec<MidiTempoPoint>,
    time_signatures: Vec<MidiTimeSignaturePoint>,
    key_signatures: Vec<MidiKeySignaturePoint>,
    notes: Vec<MidiVizNote>,
    playback_events: Vec<MidiPlaybackEvent>,
    score_pages: std::collections::BTreeMap<u32, Vec<usize>>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AmbilightResponse {
    interval: f32,
    width: usize,
    height: usize,
    frames: Vec<[u8; 12]>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteImageRequest {
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteVideoRequest {
    note_path: String,
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
    revision: u64,
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

fn scan_live_graph(vault: &Path, revision: u64) -> Result<LiveGraph> {
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
        revision,
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
        assert!(asset_extension_allowed(Path::new("estrutura.cif")));
        assert!(asset_extension_allowed(Path::new("alinhamento.fasta")));
        assert!(asset_extension_allowed(Path::new("proteina.faa")));
        assert!(asset_extension_allowed(Path::new("molecula.sdf")));
        assert!(asset_extension_allowed(Path::new("proteina.pdb")));
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
    fn remote_image_proxy_accepts_public_https_shape_only() {
        assert!(https_image_url_shape_allowed(
            &reqwest::Url::parse("https://images.example.com/banner.webp").unwrap()
        ));
        assert!(!https_image_url_shape_allowed(
            &reqwest::Url::parse("http://images.example.com/banner.webp").unwrap()
        ));
        assert!(!https_image_url_shape_allowed(
            &reqwest::Url::parse("https://localhost/banner.webp").unwrap()
        ));
        assert!(!https_image_url_shape_allowed(
            &reqwest::Url::parse("https://127.0.0.1/banner.webp").unwrap()
        ));
        assert!(!https_image_url_shape_allowed(
            &reqwest::Url::parse("https://images.example.com:8443/banner.webp").unwrap()
        ));
    }
}

async fn live_graph(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let started = Instant::now();
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let vault = state.vault.clone();
    let revision = state.graph_revision.load(Ordering::Relaxed);
    match tokio::task::spawn_blocking(move || scan_live_graph(vault.as_ref(), revision)).await {
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

async fn graph_status(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    Json(json!({
        "revision": state.graph_revision.load(Ordering::Relaxed)
    }))
    .into_response()
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
                "capabilities": bridge_capabilities(&state)
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
                "capabilities": bridge_capabilities(&state)
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
                | "fasta"
                | "fa"
                | "faa"
                | "fna"
                | "flac"
                | "gif"
                | "jpg"
                | "jpeg"
                | "m4a"
                | "m4v"
                | "mov"
                | "mid"
                | "midi"
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
                | "pdb"
                | "cif"
                | "mmcif"
                | "mol"
                | "sdf"
                | "xyz"
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
            "stream=codec_name,width,height,bit_rate",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .await;
    let stream = match probe {
        Ok(output) if output.status.success() => serde_json::from_slice::<Value>(&output.stdout)
            .ok()
            .and_then(|value| {
                value["streams"]
                    .as_array()
                    .and_then(|streams| streams.first())
                    .cloned()
            }),
        _ => return Ok(path.to_path_buf()),
    };
    let Some(stream) = stream else {
        return Ok(path.to_path_buf());
    };
    let codec = stream["codec_name"]
        .as_str()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let width = stream["width"].as_u64().unwrap_or_default();
    let height = stream["height"].as_u64().unwrap_or_default();
    let bitrate = stream["bit_rate"]
        .as_str()
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| stream["bit_rate"].as_u64())
        .unwrap_or_default();
    let needs_quest_profile = matches!(codec.as_str(), "av1" | "hevc" | "h265")
        || width > 1280
        || height > 720
        || bitrate > 4_000_000;
    if !needs_quest_profile {
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
    "quest-stream-v2".hash(&mut hasher);
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
        "[VIDEO] gerando perfil Quest H.264 (máx. 1280x720 / 3,5 Mbps) de {codec} {width}x{height}: {}",
        path.display(),
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
            "24",
            "-vf",
            "scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            "-maxrate",
            "3500k",
            "-bufsize",
            "7000k",
            "-g",
            "60",
            "-keyint_min",
            "30",
            "-sc_threshold",
            "0",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
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

const AMBILIGHT_WIDTH: usize = 24;
const AMBILIGHT_HEIGHT: usize = 14;
const AMBILIGHT_INTERVAL: f32 = 1.0;
const AMBILIGHT_MAX_FRAMES: usize = 3600;

fn average_rgb<I>(pixels: I) -> [u8; 3]
where
    I: Iterator<Item = [u8; 3]>,
{
    let mut sum = [0_u64; 3];
    let mut count = 0_u64;
    for pixel in pixels {
        sum[0] += pixel[0] as u64;
        sum[1] += pixel[1] as u64;
        sum[2] += pixel[2] as u64;
        count += 1;
    }
    if count == 0 {
        return [0, 0, 0];
    }
    [
        (sum[0] / count) as u8,
        (sum[1] / count) as u8,
        (sum[2] / count) as u8,
    ]
}

fn analyze_ambilight_frames(bytes: &[u8]) -> AmbilightResponse {
    let stride = AMBILIGHT_WIDTH * AMBILIGHT_HEIGHT * 3;
    let mut frames = Vec::with_capacity((bytes.len() / stride).min(AMBILIGHT_MAX_FRAMES));
    for frame in bytes.chunks_exact(stride).take(AMBILIGHT_MAX_FRAMES) {
        let pixel = |x: usize, y: usize| {
            let offset = (y * AMBILIGHT_WIDTH + x) * 3;
            [frame[offset], frame[offset + 1], frame[offset + 2]]
        };
        let band = 2;
        let top =
            average_rgb((0..band).flat_map(|y| (0..AMBILIGHT_WIDTH).map(move |x| pixel(x, y))));
        let right =
            average_rgb((0..AMBILIGHT_HEIGHT).flat_map(|y| {
                ((AMBILIGHT_WIDTH - band)..AMBILIGHT_WIDTH).map(move |x| pixel(x, y))
            }));
        let bottom = average_rgb(
            ((AMBILIGHT_HEIGHT - band)..AMBILIGHT_HEIGHT)
                .flat_map(|y| (0..AMBILIGHT_WIDTH).map(move |x| pixel(x, y))),
        );
        let left =
            average_rgb((0..AMBILIGHT_HEIGHT).flat_map(|y| (0..band).map(move |x| pixel(x, y))));
        frames.push([
            top[0], top[1], top[2], right[0], right[1], right[2], bottom[0], bottom[1], bottom[2],
            left[0], left[1], left[2],
        ]);
    }
    AmbilightResponse {
        interval: AMBILIGHT_INTERVAL,
        width: AMBILIGHT_WIDTH,
        height: AMBILIGHT_HEIGHT,
        frames,
    }
}

async fn analyze_video_ambilight(path: &Path) -> Result<AmbilightResponse> {
    let fps = format!("fps=1/{AMBILIGHT_INTERVAL},scale={AMBILIGHT_WIDTH}:{AMBILIGHT_HEIGHT}:force_original_aspect_ratio=decrease,pad={AMBILIGHT_WIDTH}:{AMBILIGHT_HEIGHT}:(ow-iw)/2:(oh-ih)/2");
    let output = Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(path)
        .args([
            "-an",
            "-vf",
            &fps,
            "-frames:v",
            &AMBILIGHT_MAX_FRAMES.to_string(),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ])
        .output()
        .await
        .context("FFmpeg não está disponível para analisar as bordas do vídeo.")?;
    if !output.status.success() {
        bail!(
            "FFmpeg não conseguiu gerar o ambilight: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(analyze_ambilight_frames(&output.stdout))
}

async fn read_video_ambilight(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AssetRequest>,
) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let note_path = normalize_note_path(&payload.note_path);
    if !matches!(note_is_allowed(&state, &note_path).await, Ok(true)) {
        return error(StatusCode::NOT_FOUND, "Nota não permitida.");
    }
    let path = if remote_video_url_allowed(&payload.asset_path, &state.remote_video_hosts) {
        let downloaded = match prepare_remote_video(&payload.asset_path, state.remote_video_max_height, state.remote_video_max_size_mb).await {
            Ok(path) => path,
            Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
        };
        match compatible_video_asset(&state, &downloaded).await {
            Ok(path) => path,
            Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
        }
    } else {
        match resolve_asset(&state, &note_path, &payload.asset_path).await {
            Ok(path)
                if compatibility_video_candidate(&path)
                    || matches!(
                        path.extension()
                            .and_then(|value| value.to_str())
                            .map(str::to_ascii_lowercase)
                            .as_deref(),
                        Some("webm" | "ogv")
                    ) =>
            {
                path
            }
            Ok(_) => {
                return error(
                    StatusCode::UNSUPPORTED_MEDIA_TYPE,
                    "O arquivo solicitado não é um vídeo.",
                )
            }
            Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
        }
    };
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let key = path.to_string_lossy().to_string();
    if let Some(cached) = state
        .ambilight_cache
        .read()
        .await
        .get(&key)
        .filter(|cached| cached.modified == modified && cached.size == metadata.len())
        .cloned()
    {
        return Json(cached.response).into_response();
    }
    println!(
        "[VIDEO] analisando bordas 24x14 para ambilight: {}",
        path.display()
    );
    let response = match analyze_video_ambilight(&path).await {
        Ok(response) => response,
        Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
    };
    println!(
        "[VIDEO] ambilight pronto: {} amostras.",
        response.frames.len()
    );
    state.ambilight_cache.write().await.insert(
        key,
        CachedAmbilight {
            modified,
            size: metadata.len(),
            response: response.clone(),
        },
    );
    Json(response).into_response()
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

fn parse_midi_file(path: &Path) -> Result<MidiVizResponse> {
    let bytes = fs::read(path)?;
    if bytes.len() > 16 * 1024 * 1024 {
        bail!("MIDI exceeds the 16 MB safety limit.");
    }
    let smf = Smf::parse(&bytes).context("Invalid MIDI file.")?;
    let ticks_per_beat = match smf.header.timing {
        Timing::Metrical(value) => u64::from(value.as_int()),
        Timing::Timecode(_, _) => bail!("SMPTE-timed MIDI is not supported yet."),
    };
    #[derive(Clone, Copy)]
    struct RawNoteEvent {
        tick: u64,
        track: u16,
        channel: u8,
        pitch: u8,
        velocity: u8,
        on: bool,
    }
    let mut events = Vec::new();
    let mut tempos = vec![(0_u64, 500_000_u32)];
    let mut final_tick = 0_u64;
    let mut beats_per_measure = 4_u8;
    let mut beat_unit = 4_u8;
    let mut time_signatures_raw = vec![(0_u64, 4_u8, 4_u8)];
    let mut key_signatures_raw = vec![(0_u64, 0_i8, false)];
    for (track_index, track) in smf.tracks.iter().enumerate() {
        let mut tick = 0_u64;
        for event in track {
            tick = tick.saturating_add(u64::from(event.delta.as_int()));
            final_tick = final_tick.max(tick);
            match event.kind {
                TrackEventKind::Meta(MetaMessage::Tempo(value)) => {
                    tempos.push((tick, value.as_int()))
                }
                TrackEventKind::Meta(MetaMessage::TimeSignature(numerator, denominator, _, _)) => {
                    beats_per_measure = numerator.max(1);
                    beat_unit = 2_u8.saturating_pow(u32::from(denominator.min(6)));
                    time_signatures_raw.push((tick, beats_per_measure, beat_unit));
                }
                TrackEventKind::Meta(MetaMessage::KeySignature(sharps, minor)) => {
                    key_signatures_raw.push((tick, sharps.clamp(-7, 7), minor))
                }
                TrackEventKind::Midi { channel, message } => match message {
                    MidiMessage::NoteOn { key, vel } => events.push(RawNoteEvent {
                        tick,
                        track: track_index as u16,
                        channel: channel.as_int(),
                        pitch: key.as_int(),
                        velocity: vel.as_int(),
                        on: vel.as_int() > 0,
                    }),
                    MidiMessage::NoteOff { key, .. } => events.push(RawNoteEvent {
                        tick,
                        track: track_index as u16,
                        channel: channel.as_int(),
                        pitch: key.as_int(),
                        velocity: 0,
                        on: false,
                    }),
                    _ => {}
                },
                _ => {}
            }
        }
    }
    tempos.sort_unstable_by_key(|entry| entry.0);
    tempos.dedup_by(|left, right| {
        if left.0 == right.0 {
            left.1 = right.1;
            true
        } else {
            false
        }
    });
    let mut tempo_segments = Vec::with_capacity(tempos.len());
    let mut segment_tick = 0_u64;
    let mut segment_seconds = 0_f64;
    let mut micros_per_beat = 500_000_u32;
    for &(tick, micros) in &tempos {
        segment_seconds += (tick.saturating_sub(segment_tick)) as f64 * micros_per_beat as f64
            / ticks_per_beat as f64
            / 1_000_000.0;
        tempo_segments.push((tick, segment_seconds, micros));
        segment_tick = tick;
        micros_per_beat = micros;
    }
    let tick_seconds = |tick: u64| {
        let mut segment = tempo_segments[0];
        for candidate in &tempo_segments {
            if candidate.0 > tick {
                break;
            }
            segment = *candidate;
        }
        segment.1
            + (tick.saturating_sub(segment.0)) as f64 * segment.2 as f64
                / ticks_per_beat as f64
                / 1_000_000.0
    };
    events.sort_unstable_by_key(|event| event.tick);
    let mut active: HashMap<(u16, u8, u8), Vec<(u64, u8)>> = HashMap::new();
    let mut notes = Vec::new();
    for event in events {
        let key = (event.track, event.channel, event.pitch);
        if event.on {
            active
                .entry(key)
                .or_default()
                .push((event.tick, event.velocity));
        } else if let Some(started) = active.get_mut(&key).and_then(Vec::pop) {
            let start = tick_seconds(started.0);
            let end = tick_seconds(event.tick.max(started.0 + 1));
            notes.push(MidiVizNote {
                pitch: event.pitch,
                start,
                duration: (end - start).max(0.02),
                start_beat: started.0 as f64 / ticks_per_beat as f64,
                duration_beats: event.tick.saturating_sub(started.0).max(1) as f64
                    / ticks_per_beat as f64,
                velocity: started.1,
                channel: event.channel,
                track: event.track,
                quantized_start_beat: 0.0,
                quantized_duration_beats: 0.0,
                measure: 0,
                beat_in_measure: 0.0,
                hand: 0,
                voice: 0,
                spelling: String::new(),
                dotted: false,
            });
        }
        if notes.len() > 50_000 {
            bail!("MIDI exceeds the 50,000-note safety limit.");
        }
    }
    for ((track, channel, pitch), starts) in active {
        for (tick, velocity) in starts {
            let start = tick_seconds(tick);
            notes.push(MidiVizNote {
                pitch,
                start,
                duration: (tick_seconds(final_tick) - start).max(0.02),
                start_beat: tick as f64 / ticks_per_beat as f64,
                duration_beats: final_tick.saturating_sub(tick).max(1) as f64
                    / ticks_per_beat as f64,
                velocity,
                channel,
                track,
                quantized_start_beat: 0.0,
                quantized_duration_beats: 0.0,
                measure: 0,
                beat_in_measure: 0.0,
                hand: 0,
                voice: 0,
                spelling: String::new(),
                dotted: false,
            });
        }
    }
    notes.sort_by(|left, right| left.start.total_cmp(&right.start));
    let mut pitches: Vec<u8> = notes.iter().map(|n| n.pitch).collect();
    pitches.sort_unstable();
    let split = pitches
        .get(pitches.len() / 2)
        .copied()
        .unwrap_or(60)
        .clamp(54, 66);
    let grids = [0.25_f64, 1.0 / 3.0, 0.125];
    let quantize = |beat: f64| {
        grids
            .iter()
            .map(|g| (beat / g).round() * g)
            .min_by(|a, b| (a - beat).abs().total_cmp(&(b - beat).abs()))
            .unwrap_or(beat)
    };
    let measure_beats = beats_per_measure as f64 * 4.0 / beat_unit as f64;
    key_signatures_raw.sort_by_key(|point| point.0);
    let sharp = [
        "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
    ];
    let flat = [
        "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
    ];
    let mut ends = [[0_f64; 3]; 2];
    for n in &mut notes {
        let start = quantize(n.start_beat);
        let length = (quantize(n.duration_beats).max(0.125) * 8.0).round() / 8.0;
        let hand = usize::from(n.pitch >= split);
        let mut voice = 0;
        for c in 0..3 {
            if ends[hand][c] <= start + 0.01 {
                voice = c;
                break;
            }
            if ends[hand][c] < ends[hand][voice] {
                voice = c
            }
        }
        ends[hand][voice] = start + length;
        n.quantized_start_beat = start;
        n.quantized_duration_beats = length;
        n.measure = (start / measure_beats).floor().max(0.0) as u32 + 1;
        n.beat_in_measure = start % measure_beats;
        n.hand = hand as u8;
        n.voice = voice as u8;
        let sharps = key_signatures_raw.iter().filter(|point| point.0 as f64 <= n.start_beat * ticks_per_beat as f64).last().map(|point| point.1).unwrap_or(0);
        n.spelling = (if sharps < 0 { flat } else { sharp })[(n.pitch % 12) as usize].to_string();
        n.dotted = [0.25, 0.5, 1.0, 2.0, 4.0]
            .iter()
            .any(|b| (length - b * 1.5).abs() < 0.04);
    }
    let key_name = |s: i8, m: bool| {
        const A: [&str; 15] = [
            "Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#",
        ];
        const B: [&str; 15] = [
            "Abm", "Ebm", "Bbm", "Fm", "Cm", "Gm", "Dm", "Am", "Em", "Bm", "F#m", "C#m", "G#m",
            "D#m", "A#m",
        ];
        let i = (s + 7).clamp(0, 14) as usize;
        if m {
            B[i]
        } else {
            A[i]
        }
    };
    let tempo_map = tempos
        .iter()
        .map(|(t, m)| MidiTempoPoint {
            beat: *t as f64 / ticks_per_beat as f64,
            bpm: 60_000_000.0 / f64::from(*m),
        })
        .collect();
    let time_signatures = time_signatures_raw
        .iter()
        .map(|(t, a, b)| MidiTimeSignaturePoint {
            beat: *t as f64 / ticks_per_beat as f64,
            numerator: *a,
            denominator: *b,
        })
        .collect();
    let key_signatures = key_signatures_raw
        .iter()
        .map(|(t, s, m)| MidiKeySignaturePoint {
            beat: *t as f64 / ticks_per_beat as f64,
            sharps: *s,
            minor: *m,
            name: key_name(*s, *m).to_string(),
        })
        .collect();
    let duration = notes
        .iter()
        .map(|note| note.start + note.duration)
        .fold(0.0_f64, f64::max);
    let (playback_events, score_pages) = midi_score_indices(&notes);
    Ok(MidiVizResponse {
        title: path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("MIDI")
            .to_string(),
        duration,
        track_count: smf.tracks.len(),
        beats_per_measure,
        beat_unit,
        ppq: ticks_per_beat,
        tempo_map,
        time_signatures,
        key_signatures,
        notes,
        playback_events,
        score_pages,
    })
}

fn midi_score_indices(notes: &[MidiVizNote]) -> (Vec<MidiPlaybackEvent>, std::collections::BTreeMap<u32, Vec<usize>>) {
    let mut events = Vec::with_capacity(notes.len() * 2);
    let mut pages = std::collections::BTreeMap::new();
    for (index, note) in notes.iter().enumerate() {
        events.push(MidiPlaybackEvent { time: note.start, note: index, on: true });
        events.push(MidiPlaybackEvent { time: note.start + note.duration.max(0.0), note: index, on: false });
        pages.entry(note.measure.saturating_sub(1) / 4).or_insert_with(Vec::new).push(index);
    }
    events.sort_by(|a, b| a.time.total_cmp(&b.time).then(a.on.cmp(&b.on)));
    (events, pages)
}

async fn read_midi(
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
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case("mid") && !extension.eq_ignore_ascii_case("midi") {
        return error(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "The selected asset is not a MIDI file.",
        );
    }
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let key = path.to_string_lossy().to_string();
    if let Some(cached) = state
        .midi_cache
        .read()
        .await
        .get(&key)
        .filter(|cached| cached.modified == modified && cached.size == metadata.len())
        .cloned()
    {
        return Json(cached.response).into_response();
    }
    let parse_path = path.clone();
    let response = match tokio::task::spawn_blocking(move || parse_midi_file(&parse_path)).await {
        Ok(Ok(response)) => response,
        Ok(Err(err)) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
        Err(err) => return error(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()),
    };
    println!(
        "[MIDI] visualization ready: {} notes, {:.1} s ({})",
        response.notes.len(),
        response.duration,
        path.display()
    );
    state.midi_cache.write().await.insert(
        key,
        CachedMidi {
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
            stream_media_file(&path, &headers, "private, max-age=300").await
        }
        Err(err) => error(StatusCode::NOT_FOUND, err.to_string()),
    }
}

async fn stream_media_file(path: &Path, headers: &HeaderMap, cache_control: &str) -> Response {
    let mut file = match File::open(path).await {
        Ok(file) => file,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
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
            mime_guess::from_path(path).first_or_octet_stream().as_ref(),
        )
        .header(header::CACHE_CONTROL, cache_control)
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
    let stream = ReaderStream::new(file.take(body_length.unwrap_or(u64::MAX)));
    response.body(Body::from_stream(stream)).unwrap()
}

fn default_remote_video_hosts() -> HashSet<String> {
    ["youtube.com", "youtu.be", "streamable.com"]
        .into_iter().map(str::to_string).collect()
}

fn remote_video_url_allowed(value: &str, allowed_hosts: &HashSet<String>) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else { return false; };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() || url.port().is_some_and(|port| port != 443) { return false; }
    let Some(host) = url.host_str().map(|host| host.trim_end_matches('.').to_ascii_lowercase()) else { return false; };
    if host.parse::<std::net::IpAddr>().is_ok() || host == "localhost" { return false; }
    allowed_hosts.iter().any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
}

async fn prepare_remote_video(url: &str, max_height: u16, max_size_mb: u64) -> Result<PathBuf> {
    if let Some((until, message)) = youtube_failure_cache().read().await.get(url).cloned() {
        if until > Instant::now() {
            bail!("{message}");
        }
    }
    let mut hasher = DefaultHasher::new();
    "remote-video-v7-configurable".hash(&mut hasher);
    max_height.hash(&mut hasher);
    max_size_mb.hash(&mut hasher);
    url.hash(&mut hasher);
    let cache_dir = env::temp_dir().join("obsidian-ar-youtube-cache");
    tokio::fs::create_dir_all(&cache_dir).await?;
    let output_path = cache_dir.join(format!("{:016x}.mp4", hasher.finish()));
    if tokio::fs::metadata(&output_path)
        .await
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false)
    {
        return Ok(output_path);
    }

    let _download_guard = YOUTUBE_DOWNLOAD_LOCK.lock().await;
    // Recheck after waiting: a preceding request may have failed while this one was queued.
    if let Some((until, message)) = youtube_failure_cache().read().await.get(url).cloned() {
        if until > Instant::now() {
            bail!("{message}");
        }
    }
    if tokio::fs::metadata(&output_path)
        .await
        .map(|metadata| metadata.len() > 0)
        .unwrap_or(false)
    {
        return Ok(output_path);
    }
    let partial_path = output_path.with_extension("download.mp4");
    let _ = tokio::fs::remove_file(&partial_path).await;

    println!("[REMOTE VIDEO] preparando vídeo compatível para a janela WebXR: {url}");
    let format_selector = format!("bv*[ext=mp4][vcodec^=avc1][height<={max_height}]+ba[ext=m4a]/bv*[ext=mp4][height<={max_height}]+ba/bv*[height<={max_height}]+ba/b[ext=mp4][height<={max_height}]/b[height<={max_height}]/22/18");
    let max_filesize = format!("{max_size_mb}M");
    let status = Command::new("yt-dlp")
        .args([
            "--no-playlist",
            "--no-progress",
            "--socket-timeout",
            "15",
            "--retries",
            "2",
            "--fragment-retries",
            "2",
            "--max-filesize",
            &max_filesize,
            "--format",
            &format_selector,
            "--merge-output-format",
            "mp4",
            "--output",
        ])
        .arg(&partial_path)
        .arg(url)
        .status()
        .await
        .context(
            "yt-dlp não está disponível. Instale-o para reproduzir vídeos remotos dentro da janela 3D.",
        )?;
    if !status.success() {
        let message = "A plataforma recusou a preparação temporariamente (limite ou verificação anti-bot). Aguarde alguns minutos e tente novamente.".to_string();
        youtube_failure_cache().write().await.insert(
            url.to_string(),
            (
                Instant::now() + Duration::from_secs(10 * 60),
                message.clone(),
            ),
        );
        bail!("{message}");
    }
    let metadata = tokio::fs::metadata(&partial_path)
        .await
        .context("yt-dlp terminou sem criar o arquivo de vídeo.")?;
    if metadata.len() == 0 || metadata.len() > max_size_mb * 1024 * 1024 {
        let _ = tokio::fs::remove_file(&partial_path).await;
        bail!("O vídeo remoto está vazio ou excede o limite configurado.");
    }
    tokio::fs::rename(&partial_path, &output_path)
        .await
        .context("Não foi possível finalizar o vídeo remoto no cache.")?;
    youtube_failure_cache().write().await.remove(url);
    Ok(output_path)
}

async fn create_youtube_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RemoteVideoRequest>,
) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let note_path = normalize_note_path(&payload.note_path);
    if !matches!(note_is_allowed(&state, &note_path).await, Ok(true)) {
        return error(StatusCode::NOT_FOUND, "Nota não permitida.");
    }
    if !remote_video_url_allowed(&payload.url, &state.remote_video_hosts) {
        return error(
            StatusCode::BAD_REQUEST,
            "Somente URLs HTTPS de plataformas de vídeo permitidas são aceitas.",
        );
    }
    let path = match prepare_remote_video(&payload.url, state.remote_video_max_height, state.remote_video_max_size_mb).await {
        Ok(path) => path,
        Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
    };
    let path = match compatible_video_asset(&state, &path).await {
        Ok(path) => path,
        Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
    };
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let waveform_path = path.clone();
    let waveform = tokio::task::spawn_blocking(move || analyze_audio_waveform(&waveform_path))
        .await
        .ok()
        .and_then(Result::ok);

    let mut random = [0u8; 32];
    rand::rng().fill_bytes(&mut random);
    let ticket = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let now = Instant::now();
    let mut tickets = state.media_tickets.write().await;
    tickets.retain(|_, entry| entry.expires_at > now);
    if tickets.len() >= 64 {
        if let Some(oldest) = tickets
            .iter()
            .min_by_key(|(_, entry)| entry.expires_at)
            .map(|(key, _)| key.clone())
        {
            tickets.remove(&oldest);
        }
    }
    tickets.insert(
        ticket.clone(),
        MediaTicket {
            path: path.clone(),
            expires_at: now + MEDIA_TICKET_TTL,
        },
    );
    println!(
        "[REMOTE VIDEO] janela 3D pronta: {} ({} bytes)",
        payload.url,
        metadata.len()
    );
    Json(json!({
        "url": format!("/media/{ticket}"),
        "expiresIn": MEDIA_TICKET_TTL.as_secs(),
        "contentType": "video/mp4",
        "size": metadata.len(),
        "waveform": waveform
    }))
    .into_response()
}
async fn create_media_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AssetRequest>,
) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let note_path = normalize_note_path(&payload.note_path);
    if !matches!(note_is_allowed(&state, &note_path).await, Ok(true)) {
        return error(StatusCode::NOT_FOUND, "Nota não permitida.");
    }
    let path = match resolve_asset(&state, &note_path, &payload.asset_path).await {
        Ok(path) if compatibility_video_candidate(&path) => path,
        Ok(_) => {
            return error(
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "O ticket é exclusivo para vídeo.",
            )
        }
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let path = match compatible_video_asset(&state, &path).await {
        Ok(path) => path,
        Err(err) => return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, err.to_string()),
    };
    let metadata = match tokio::fs::metadata(&path).await {
        Ok(metadata) => metadata,
        Err(err) => return error(StatusCode::NOT_FOUND, err.to_string()),
    };
    let mut random = [0u8; 32];
    rand::rng().fill_bytes(&mut random);
    let ticket = random
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let now = Instant::now();
    let mut tickets = state.media_tickets.write().await;
    tickets.retain(|_, entry| entry.expires_at > now);
    if tickets.len() >= 64 {
        if let Some(oldest) = tickets
            .iter()
            .min_by_key(|(_, entry)| entry.expires_at)
            .map(|(key, _)| key.clone())
        {
            tickets.remove(&oldest);
        }
    }
    tickets.insert(
        ticket.clone(),
        MediaTicket {
            path: path.clone(),
            expires_at: now + MEDIA_TICKET_TTL,
        },
    );
    println!(
        "[VIDEO] ticket temporário pronto: {} ({} bytes)",
        payload.asset_path,
        metadata.len()
    );
    Json(json!({
        "url": format!("/media/{ticket}"),
        "expiresIn": MEDIA_TICKET_TTL.as_secs(),
        "contentType": mime_guess::from_path(&path).first_or_octet_stream().as_ref(),
        "size": metadata.len()
    }))
    .into_response()
}

async fn read_media_ticket(
    State(state): State<AppState>,
    AxumPath(ticket): AxumPath<String>,
    headers: HeaderMap,
) -> Response {
    let now = Instant::now();
    let path = {
        let mut tickets = state.media_tickets.write().await;
        tickets.retain(|_, entry| entry.expires_at > now);
        let Some(entry) = tickets.get_mut(&ticket) else {
            return error(
                StatusCode::NOT_FOUND,
                "Ticket de mídia inválido ou expirado.",
            );
        };
        entry.expires_at = now + MEDIA_TICKET_TTL;
        entry.path.clone()
    };
    if let Some(range) = headers
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
    {
        println!("[VIDEO] streaming {range}");
    } else {
        println!("[VIDEO] streaming completo solicitado");
    }
    stream_media_file(&path, &headers, "private, no-store").await
}

fn public_remote_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            !(ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || ip.is_broadcast()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.octets()[0] == 0
                || (ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1])))
        }
        std::net::IpAddr::V6(ip) => {
            !(ip.is_loopback()
                || ip.is_unspecified()
                || ip.is_multicast()
                || ip.is_unique_local()
                || ip.is_unicast_link_local())
        }
    }
}

fn https_image_url_shape_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none_or(|port| port == 443)
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| !host.eq_ignore_ascii_case("localhost"))
        && url
            .host_str()
            .and_then(|host| host.parse::<std::net::IpAddr>().ok())
            .is_none_or(public_remote_ip)
}

async fn public_https_image_url_allowed(url: &reqwest::Url) -> bool {
    if !https_image_url_shape_allowed(url) {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    match tokio::net::lookup_host((host, 443)).await {
        Ok(addresses) => {
            let addresses = addresses.collect::<Vec<_>>();
            !addresses.is_empty()
                && addresses
                    .into_iter()
                    .all(|address| public_remote_ip(address.ip()))
        }
        Err(_) => false,
    }
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
    let mut url = match reqwest::Url::parse(&payload.url) {
        Ok(url) if public_https_image_url_allowed(&url).await => url,
        _ => {
            return error(
                StatusCode::BAD_REQUEST,
                "A imagem deve usar HTTPS público, sem acesso a redes locais.",
            )
        }
    };
    let response = {
        let mut redirects = 0_u8;
        loop {
            let response = match state.remote_client.get(url.clone()).send().await {
                Ok(response) => response,
                Err(err) => return error(StatusCode::BAD_GATEWAY, err.to_string()),
            };
            if response.status().is_redirection() {
                if redirects >= 5 {
                    return error(StatusCode::BAD_GATEWAY, "Redirecionamentos demais.");
                }
                let Some(location) = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                else {
                    return error(StatusCode::BAD_GATEWAY, "Redirecionamento sem destino.");
                };
                url = match url.join(location) {
                    Ok(next) if public_https_image_url_allowed(&next).await => next,
                    _ => {
                        return error(
                            StatusCode::BAD_GATEWAY,
                            "Redirecionamento de imagem inseguro.",
                        )
                    }
                };
                redirects += 1;
                continue;
            }
            break response;
        }
    };
    if !response.status().is_success() {
        return error(
            StatusCode::BAD_GATEWAY,
            "O servidor remoto recusou a imagem.",
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


fn valid_stock_symbol(symbol: &str) -> bool {
    !symbol.is_empty()
        && symbol.len() <= 32
        && symbol.bytes().all(|byte| byte.is_ascii_alphanumeric() || b"-._^=".contains(&byte))
}

async fn read_stock_chart(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<StockChartRequest>,
) -> Response {
    if !authorized(&headers, &state.token) {
        return error(StatusCode::UNAUTHORIZED, "Token inválido.");
    }
    let symbol = payload.symbol.trim().to_ascii_uppercase();
    if !valid_stock_symbol(&symbol) {
        return error(StatusCode::BAD_REQUEST, "Símbolo financeiro inválido.");
    }
    let days = payload.days.unwrap_or(30).clamp(2, 3650);
    let key = format!("{symbol}:{days}");
    if let Some(cached) = state.stock_cache.read().await.get(&key)
        .filter(|cached| cached.expires_at > Instant::now()).cloned()
    {
        return Json(cached.response).into_response();
    }
    let range = match days {
        0..=7 => "7d", 8..=31 => "1mo", 32..=93 => "3mo",
        94..=186 => "6mo", 187..=366 => "1y", 367..=732 => "2y",
        733..=1826 => "5y", _ => "10y",
    };
    let url = format!("https://query1.finance.yahoo.com/v8/finance/chart/{symbol}");
    let response = match state.remote_client.get(url)
        .query(&[("range", range), ("interval", "1d"), ("events", "div,splits")])
        .send().await
    {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => return error(StatusCode::BAD_GATEWAY, format!("Yahoo Finance: HTTP {}", response.status())),
        Err(err) => return error(StatusCode::BAD_GATEWAY, err.to_string()),
    };
    let json: Value = match response.json().await {
        Ok(value) => value,
        Err(err) => return error(StatusCode::BAD_GATEWAY, err.to_string()),
    };
    let Some(result) = json.pointer("/chart/result/0") else {
        let message = json.pointer("/chart/error/description").and_then(Value::as_str).unwrap_or("Cotação indisponível.");
        return error(StatusCode::BAD_GATEWAY, message);
    };
    let timestamps = result.get("timestamp").and_then(Value::as_array).cloned().unwrap_or_default();
    let quote = result.pointer("/indicators/quote/0").unwrap_or(&Value::Null);
    let values = |name: &str| quote.get(name).and_then(Value::as_array).cloned().unwrap_or_default();
    let opens = values("open"); let highs = values("high"); let lows = values("low");
    let closes = values("close"); let volumes = values("volume");
    let mut points = Vec::with_capacity(timestamps.len().min(512));
    for index in 0..timestamps.len() {
        let Some(close) = closes.get(index).and_then(Value::as_f64) else { continue };
        points.push(StockPoint {
            timestamp: timestamps[index].as_i64().unwrap_or_default(),
            open: opens.get(index).and_then(Value::as_f64).unwrap_or(close),
            high: highs.get(index).and_then(Value::as_f64).unwrap_or(close),
            low: lows.get(index).and_then(Value::as_f64).unwrap_or(close),
            close,
            volume: volumes.get(index).and_then(Value::as_u64).unwrap_or_default(),
        });
    }
    if points.is_empty() { return error(StatusCode::NOT_FOUND, "Yahoo Finance não retornou preços."); }
    if points.len() > usize::from(days) { points = points.split_off(points.len() - usize::from(days)); }
    let meta = result.get("meta").unwrap_or(&Value::Null);
    let price = meta.get("regularMarketPrice").and_then(Value::as_f64).unwrap_or_else(|| points.last().unwrap().close);
    let baseline = points.first().map(|point| point.close).unwrap_or(price);
    let response = StockChartResponse {
        symbol: symbol.clone(),
        name: meta.get("longName").or_else(|| meta.get("shortName")).and_then(Value::as_str).unwrap_or(&symbol).to_string(),
        currency: meta.get("currency").and_then(Value::as_str).unwrap_or("USD").to_string(),
        price,
        change_percent: if baseline.abs() > f64::EPSILON { (price - baseline) / baseline * 100.0 } else { 0.0 },
        updated_at: meta.get("regularMarketTime").and_then(Value::as_i64).unwrap_or_default(),
        points,
    };
    println!("[STOCK] {}: {} pontos ({})", response.symbol, response.points.len(), range);
    state.stock_cache.write().await.insert(key, CachedStock { expires_at: Instant::now() + Duration::from_secs(60), response: response.clone() });
    Json(response).into_response()
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
    let remote_video_hosts = env::var("SPACE_REMOTE_VIDEO_HOSTS")
        .ok().map(|value| value.split(',').map(|host| host.trim().trim_start_matches("*.").to_ascii_lowercase()).filter(|host| !host.is_empty()).collect::<HashSet<_>>())
        .filter(|hosts| !hosts.is_empty()).unwrap_or_else(default_remote_video_hosts);
    let remote_video_max_height = env::var("SPACE_REMOTE_VIDEO_MAX_HEIGHT").ok().and_then(|value| value.parse::<u16>().ok()).unwrap_or(720).clamp(360, 1080);
    let remote_video_max_size_mb = env::var("SPACE_REMOTE_VIDEO_MAX_SIZE_MB").ok().and_then(|value| value.parse::<u64>().ok()).unwrap_or(256).clamp(32, 512);
    let state = AppState {
        token,
        vault: Arc::new(vault),
        graph: graph.map(Arc::new),
        pending: pending.map(Arc::new),
        graph_cache: Default::default(),
        graph_revision: Arc::new(AtomicU64::new(1)),
        note_cache: Default::default(),
        asset_cache: Default::default(),
        waveform_cache: Default::default(),
        midi_cache: Default::default(),
        ambilight_cache: Default::default(),
        video_cache: Default::default(),
        stock_cache: Default::default(),
        media_tickets: Default::default(),
        remote_video_hosts: Arc::new(remote_video_hosts),
        remote_video_max_height,
        remote_video_max_size_mb,
        remote_client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Obsidian-Ar/1.0")
            .build()?,
    };
    start_graph_watcher(state.vault.clone(), state.graph_revision.clone());
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
    println!("Vídeo remoto: até {}p / {} MB; hosts: {:?}", state.remote_video_max_height, state.remote_video_max_size_mb, state.remote_video_hosts);
    let app = Router::new()
        .route("/health", get(health))
        .route("/verify", get(verify))
        .route("/graph", get(live_graph))
        .route("/graph/status", get(graph_status))
        .route("/pending-optimization", get(pending_optimization))
        .route("/note", post(read_note))
        .route("/asset", post(read_asset))
        .route("/media-ticket", post(create_media_ticket))
        .route("/youtube-ticket", post(create_youtube_ticket))
        .route("/media/{ticket}", get(read_media_ticket))
        .route("/waveform", post(read_waveform))
        .route("/midi", post(read_midi))
        .route("/video-ambilight", post(read_video_ambilight))
        .route("/stock-chart", post(read_stock_chart))
        .route("/remote-image", post(read_remote_image))
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

#[cfg(test)]
mod midi_score_index_tests {
    use super::*;
    fn note(start: f64, duration: f64, measure: u32) -> MidiVizNote {
        MidiVizNote { pitch:60,start,duration,start_beat:start,duration_beats:duration,
            velocity:100,channel:0,track:0,quantized_start_beat:start,
            quantized_duration_beats:duration,measure,beat_in_measure:0.0,
            hand:1,voice:0,spelling:"C".into(),dotted:false }
    }
    #[test]
    fn indices_preserve_chords_note_off_order_and_score_pages() {
        let notes=vec![note(0.0,1.0,1),note(0.0,2.0,1),note(1.0,1.0,5)];
        let (events,pages)=midi_score_indices(&notes);
        assert_eq!(events.len(),6);
        assert_eq!(pages.get(&0),Some(&vec![0,1]));
        assert_eq!(pages.get(&1),Some(&vec![2]));
        let boundary:Vec<_>=events.iter().filter(|e|e.time==1.0).collect();
        assert!(!boundary[0].on);
        assert!(boundary[1].on);
        assert_eq!(boundary[1].note,2);
    }
    #[test]
    fn indices_accept_empty_midi() {
        let (events,pages)=midi_score_indices(&[]);
        assert!(events.is_empty()&&pages.is_empty());
    }
}
