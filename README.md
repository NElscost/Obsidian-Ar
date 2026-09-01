# Obsidian AR

Explore an Obsidian vault as an interactive 3D graph in mixed reality on Meta
Quest. The **Meta Quest Sync** community plugin exports the graph, starts the
local Rust bridge, creates an HTTPS tunnel, and displays a QR code for pairing.

## Features

- graph generated directly from vault notes and links, without Blender;
- passthrough or an optional equirectangular 360° panorama up to 8192×4096, adaptively downsampled for Quest GPU memory;
- WebXR hit testing and anchors;
- hand gestures for placement, scale, rotation, selection, and pagination;
- fuzzy keyboard search with selectable 3D suggestions;
- Markdown, tables, LaTeX, Mermaid diagrams, code, images, audio, and video in a 3D note window;
- ChemRender3D-compatible molecular blocks and embeds (`.pdb`, `.cif`, `.mmcif`, `.mol`, `.sdf`, `.xyz`, or `3dmol`) rendered with instanced WebXR geometry;
- FASTA sequence comparison for `.fasta`, `.fa`, `.faa`, and `.fna` attachments or fenced `fasta` blocks;
- spatial HRTF audio, audio/video waveform seeking, and media bookmarks;
- cached note rendering and preprocessing to reduce frame drops;
- progress reporting with elapsed and estimated remaining time;
- grouped hub navigation for vaults with thousands of notes;
- Windows, Linux, and macOS bridge launchers;
- optional legacy glTF/Blender pipeline for advanced users.

## System requirements

- Obsidian Desktop with the **Meta Quest Sync** community plugin;
- Git;
- Node.js 22.13 or newer (Node.js 24 LTS recommended);
- Rust installed through `rustup`;
- CMake and LLVM/libclang (build-time only, for the local speech engine);
- `cloudflared` available on `PATH`;
- FFmpeg, including `ffmpeg` and `ffprobe`, for Quest-compatible conversion of
  AV1/HEVC video attachments;
- a Meta Quest with hand tracking and an up-to-date WebXR browser.

Blender, ADB, Obsidian CLI, and **3D Graph New** are not required for the
recommended direct-graph mode. `yt-dlp` is used only when a YouTube card is
selected for playback inside the 3D video window.

### Windows packages

Open PowerShell or Windows Terminal as Administrator:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Kitware.CMake -e
winget install --id LLVM.LLVM -e
winget install --id Cloudflare.cloudflared -e
winget install --id Gyan.FFmpeg -e
winget install --id yt-dlp.yt-dlp -e
```

Close and reopen Obsidian after installation so its process receives the new
`PATH`. Confirm with:

```powershell
git --version
node --version
cargo --version
cloudflared --version
ffmpeg -version
ffprobe -version
yt-dlp --version
```

### macOS packages

Install [Homebrew](https://brew.sh/) and then run:

```sh
brew install git node rustup cmake llvm cloudflared ffmpeg yt-dlp yt-dlp
rustup-init -y
```

Restart Obsidian. If an Obsidian instance launched from Finder cannot find
Node.js, set **Node.js executable** in the plugin to `/opt/homebrew/bin/node`
on Apple Silicon or `/usr/local/bin/node` on Intel Macs.

### Linux packages

For Debian or Ubuntu:

```sh
sudo apt update
sudo apt install -y git curl build-essential cmake clang libclang-dev ffmpeg yt-dlp
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

Install a current Node.js LTS release from
[nodejs.org](https://nodejs.org/en/download) and install `cloudflared` from the
[official Cloudflare package repository](https://developers.cloudflare.com/tunnel/downloads/).
On Fedora/RHEL, use the equivalent development tools and FFmpeg packages; on
Arch Linux, `cloudflared` is available through `pacman`.

Flatpak and Snap builds of Obsidian may prevent the plugin from launching host
executables. Prefer the AppImage, `.deb`, `.rpm`, or another non-sandboxed
desktop build.

## Installation

Install **Meta Quest Sync** from **Settings → Community plugins** in Obsidian.
Then clone the bridge and viewer project once:

```sh
git clone https://github.com/NElscost/Obsidian-Ar.git
cd Obsidian-Ar
```

The plugin builds the optimized Rust bridge automatically during the first AR
session and whenever its source changes.

## Start an AR session

In **Settings → Meta Quest Sync**:

1. select the absolute path of the cloned `Obsidian-Ar` folder;
2. keep the default HTTPS viewer or provide a compatible self-hosted viewer;
3. keep **Node.js executable** as `node`, or provide an absolute path;
4. choose **Cloudflare Quick Tunnel** for testing;
5. select **Start AR** and open the QR code on the Quest.

The QR code carries the temporary bridge URL and session token directly to the
viewer. No clipboard transfer is required.

## Quest controls

Keep **Build the graph directly from the vault** enabled on the start page.
Wait for graph processing to complete, then enter AR.

- pinch once to place the graph;
- use two pinches to scale and rotate it;
- point with the palm ray and pinch to open a note;
- close four fingers and swipe the thumb to change pages;
- while viewing the main graph, perform two thumb taps within 650 ms to open
  a fully immersive 3D keyboard; point with the palm ray and pinch to type;
- the keyboard button in the AR HUD opens the same smaller 3D fallback without leaving WebXR; its pin control can anchor it in space;
- typed search accepts partial titles and shows up to five selectable results in a side panel; pinning uses a smaller keyboard, and selecting a result redraws only that note and up to 96 direct neighbours;
  the matched note pulses, and the back node restores the complete graph;
- use the 3D controls to pin, navigate, play media, or close the note;
- select a labeled node in the note's local graph to replace both panels with
  the corresponding note and its neighborhood;
- select a hub to expand a large graph, and use **Back to overview** to return.

The simultaneous node budget is configurable from 800 to 1200. Vaults above
that budget are grouped into expandable hubs to preserve Quest performance.

### Molecular structures

ChemRender3D-compatible structures can be opened from vault embeds or a `3dmol` block:

`````md
![[proteins/hemoglobin.pdb]]

```3dmol
CC(=O)OC1=CC=CC=C1C(=O)O
`````

SMILES coordinates are requested from the NCI CACTUS resolver, cached persistently on the headset, and generated by a lightweight local fallback when offline. Atom and residue labels are bounded to protect frame time.

The viewer loads only when selected. It uses instanced atoms and bonds, supports pinch rotation, two-hand scaling, compact scale controls, and a placement control for an independent WebXR anchor. Large structures are capped to protect Quest performance. PDB and mmCIF protein files stay in the vault and are read through the local bridge.

### FASTA sequence comparison

FASTA attachments and inline blocks can be compared inside the reading window:


`````md
![[sequences/alignment.fasta]]

```fasta
>human
MVLSPADKTNVKAAWGKVGAHAGEYGAEAL
>mouse
MVLSAADKTNVKAIWGKVGAHAGEYGAEAL
`````

The lightweight viewer colors residues by biochemical group, outlines differences from the selected reference, calculates consensus and per-position conservation, and supports horizontal/vertical paging. Pinching a residue reports its sequence, position, identity, and conservation. The bridge only exposes explicitly referenced FASTA assets; parsed alignments are bounded and cached in the Quest session. The parser and renderer live in an independent module so an Obsidian community plugin can reuse the same data model later.

## Community plugin compatibility

Status: ✅ adapted and usable in AR · 🟡 adapted with a subset of the upstream plugin features · 🧪 experimental.

| Status | Obsidian community plugin / syntax | WebXR adaptation |
| --- | --- | --- |
| ✅ | [Meta Quest Sync](https://github.com/nelscost/meta-quest-sync) | Companion plugin that starts the bridge, exports the graph and opens the Quest pairing flow. |
| ✅ | [Audio Player](https://github.com/noonesimg/obsidian-audio-player) | Fenced `audio-player` blocks become selectable cards with spatial audio, waveform, seeking and bookmarks. Multiple tracks in one block are supported. |
| ✅ | [Timestamp Notes](https://github.com/juliang22/ObsidianTimestampNotes) | Timestamp markers seek the corresponding audio or video and preserve their labels. |
| ✅ | [Chronos](https://github.com/clairefro/obsidian-plugin-chronos) | Timelines render as selectable 2D cards and as an optional anchored/rotatable 3D timeline. |
| 🟡 | [ChemRender3D](https://github.com/ruzx/chemrender3d) | Molecules, proteins and nucleic acids open in transparent interactive 3D windows; common PDB/mmCIF and SMILES representations are supported, but not every upstream rendering preset. |
| ✅ | [Chesser](https://github.com/SilentVoid13/Chesser) | FEN and PGN blocks open an interactive board with navigation and automatic replay. |
| ✅ | [Obsidian Avatar](https://github.com/maradotwebp/obsidian-avatar) | Avatar blocks are reproduced in the rasterized reading window. |
| ✅ | [Advanced Codeblock](https://community.obsidian.md/plugins/obsidian-advanced-codeblock) | Language highlighting, line numbers and highlighted line ranges are preserved in the reading window. |
| ✅ | [Stock Blocks](https://github.com/sandypockets/stock-blocks) | Stock blocks render as transparent charts whose data is refreshed through the local bridge. |
| 🟡 | [RubikCubeAlgoView](https://github.com/Altarok/RubikCubeAlgoView) | Compatible Rubik algorithm blocks open an optimized interactive cube with playback, rotation, scaling and anchoring; the AR renderer is an independent implementation. |
| 🟡 | 3D Graph New | The legacy graph-export workflow remains supported, while the recommended mode builds the graph directly from the vault. |
| 🟡 | `music-abc` / ABC notation plugins | ABC blocks render a score, synchronized note highlight, spatial synthesis, transport controls and an optional Synthesia view. |

Formats implemented directly by Obsidian AR — such as Mermaid, FASTA, SMILES, MIDI, gene-code diagrams and ordinary Markdown media embeds — do not require those community plugins to be installed.

## Media support

Audio is connected to a Web Audio `PannerNode` using the HRTF model, so its
position follows the anchored 3D note window. Video is streamed with HTTP byte
ranges through a short-lived, random media ticket, avoiding a full in-memory
Blob on the Quest. When WebXR Media Layers are available, the browser compositor
receives the video directly; otherwise the viewer uses one GPU-backed
`THREE.VideoTexture` and stops drawing that texture while it is outside the
field of view. Opening a video never rebuilds the graph.

Quest browser support differs by headset generation. When an MP4/MOV attachment
uses AV1/HEVC, exceeds 1280×720, or has an unusually high bitrate, the Rust
bridge invokes FFmpeg once to create a Quest profile (H.264/AAC, at most 720p
and about 3.5 Mbps) in the operating system's temporary cache. The vault file is
never modified and subsequent opens reuse the cached copy. For the lowest
startup cost, encode attachments as MP4/H.264/AAC or WebM/VP9/Opus.

Audio and video attachments share the same seek bar. Point and pinch to jump to
a position, keep the pinch held while moving to scrub, and release to store a
bookmark. Local and allowed remote videos use one GPU-only ambilight mesh driven by
tiny 24x14 edge-color samples generated once per second by the Rust bridge. For
YouTube, the bridge reuses the same cached 720p MP4 prepared for playback, so no
second download is required. The halo uses a soft environmental gradient and
fades on the side facing the reading panel. Its rounded distance field avoids a
rectangular glow edge. Optional snow, rain, and cosmic dust with occasional shooting stars share a 320-particle GPU field, one draw call, depth
occlusion, and frustum culling; weather remains disabled by default and only runs
inside AR. A user-selected ambient audio file loops during reading, pauses while
note audio or video is playing, and resumes afterward. YouTube links written as Markdown
links, embeds, or plain URLs become selectable media cards. The
preprocessing queue prioritizes notes containing video, fenced code blocks, and
LaTeX so their first open is less likely to interrupt XR.

Advanced Codeblock syntax is rendered in the reading panel and its 3D texture.
Append `nums` after the fence language to show line numbers and use braces for
highlighted lines or ranges:

````md
```typescript nums {1, 3-5}
const graph = await loadGraph();
render(graph);
```
````

The viewer keeps the existing bounded syntax highlighting and adds numbering
and line backgrounds only to blocks that request them, avoiding extra DOM work
for ordinary fenced code blocks.

MIDI attachments can be presented as a lightweight Synthesia-style piano roll:

````md
```midiviz
midi: Song.mid
```
````

Opening the note only renders a selectable card. The Rust bridge parses the MIDI
after that card is selected, caches the compact event list by file modification
time and size, and performs the work outside the Quest thread. The AR panel uses
one instanced keyboard and one instanced note mesh, displays at most 320 upcoming
notes, and refreshes its temporal window only a few times per second. Selecting
the card also opens a lazily drawn score panel to the left. A fixed 12-voice Web
Audio pool plays the visible events through a spatial HRTF panner, while a note-
density waveform below the Synthesia panel supports seeking and bookmarks. Long
or malformed note durations are visually capped and clipped to the panel. The
score redraws only when playback enters another four-measure page. Closing or switching media
disposes the meshes, textures, oscillators, and waveform immediately. This keeps
MIDI independent from LaTeX, code, image, audio, and video rendering in the same
note.

The bridge preserves the MIDI tempo map, time and key-signature metadata,
PPQ timing, adaptive quantization, hand assignment,
polyphonic voices, enharmonic spelling, measures, dots, rests, stems, ledger
lines and ties. Exact event times remain separate from the quantized score, so
engraving improvements do not alter playback synchronization. The score texture
is rebuilt only when playback enters another four-measure page.

Rubik's Cube algorithms can be embedded as an interactive 3D window:

````md
```rubik
algorithm: R U R' U'
speed: 0.42
autoplay: true
```
````

Use `case: oll` when the algorithm solves an OLL case. The viewer applies the
inverse sequence without animation to construct the starting case, defaults the
U face to yellow and D to white, then animates the supplied solution. Lowercase
wide turns, M/E/S slices and x/y/z rotations are supported. The rasterized card
uses the same prepared state as the interactive cube.

The block also accepts `solution:`, a 54-character `facelets:` state in
URFDLB order, per-face color overrides such as `colorU: #ffffff`, nine stickers
per face (`U: UUUUUUUUU`) and corner overrides such as `URF: URF`. Invalid
or physically impossible solver states are rejected. Previous, play/pause,
next, reset and solve controls are available in AR. Only the moving layer is
updated during animation; the two-phase 3×3 solver is MIT-licensed, bundled
locally and initialized inside a Web Worker, keeping its tables and search off
the Quest rendering thread. Wide turns and standard U/R/F/D/L/B prime/double
notation are supported.

The viewer starts in English and includes a language selector for Portuguese, Spanish, French, Italian, and Romanian.

During AR, use the keyboard search to find notes by title. Selecting a suggested result with a pinch opens the note through the same cached bridge path used by the main graph.
Keyboard keys support both fingertip touch and palm-ray pinch. The SURF control arms hit-test placement on a real surface, while PIN keeps the existing free-space anchor workflow.
Surface placement aligns the keyboard to the camera without mirroring; its results panel remains upright and accepts fingertip touch.

The local note graph is deliberately bounded to 27 neighbors. It uses one
instanced node mesh, one line geometry, and one text atlas, without starting a
second force simulation. Virtual hands are loaded lazily through IWSDK's XR
input visual layer; if it is unavailable, the viewer falls back to Three.js hand
models. Gesture recognition remains independent, so a visual-hand failure does
not disable selection or microgestures.

## Permanent tunnels

Quick Tunnels are temporary. For recurring use, configure:

1. a Cloudflare Named Tunnel targeting `http://127.0.0.1:8765`;
2. a Cloudflare Access self-hosted application;
3. a Service Token with a `Service Auth` policy;
4. an `OPTIONS` bypass for browser preflight requests.

Select **Named Tunnel** in the plugin and provide the public hostname and tunnel
token file. The viewer also accepts Cloudflare Access client credentials.

## Privacy and networking

The plugin reads note metadata and links to build the graph, starts local
`cargo`, bridge, and `cloudflared` processes, and writes local logs, graph data,
and ephemeral tokens inside the clone. Note contents and attachments are sent
only when requested by the paired Quest.

Anyone holding both the active tunnel URL and session token can reach the
allowed bridge endpoints while the session is running. Do not publish those
credentials, and stop the session when finished. The project has no telemetry,
advertising, payment system, or first-party account.

## Troubleshooting

### `Failed to fetch`

Quick Tunnel DNS can take a few seconds to propagate. Retry once, or stop and
start the session to obtain a fresh URL. Use a Named Tunnel for a stable address.

### Remote video quality and allowed platforms

The bridge accepts remote downloads only from an explicit hostname allowlist. Configure it in `note-bridge.config.json`:

```json
"remoteVideoHosts": ["youtube.com", "youtu.be", "streamable.com"],
"remoteVideoMaxHeight": 720,
"remoteVideoMaxSizeMb": 256
```

Add a hostname only when you trust that platform. Wildcards and an unrestricted “allow all” mode are intentionally unsupported. Subdomains of an allowed hostname are accepted. Full HD can be enabled with `remoteVideoMaxHeight: 1080`; 720p remains the default because it downloads faster, uses less cache, and is usually sufficient for the Quest video window. The hard limits are 1080p and 512 MB.

### A video is black

Restart the AR session after updating this repository so the Rust bridge is
rebuilt. Confirm that both `ffmpeg` and `ffprobe` are available. The first open
of an AV1/HEVC attachment may take longer while the H.264 cache is generated;
the bridge console prints `[VIDEO]` progress messages.

If the media button stays red, another bridge may still own port `8765` with an
old token or executable. Stop the old session and start AR again from Meta Quest
Sync. Clicking the red button retries preparation after the bridge is restarted.

### The bridge does not compile

```sh
node --version
cargo --version
cloudflared --version
ffmpeg -version
cargo build --release --manifest-path ./note-bridge-rs/Cargo.toml
```

### Node.js is not found on macOS or Linux

Set an absolute **Node.js executable** path in the plugin. Common values are
`/opt/homebrew/bin/node`, `/usr/local/bin/node`, and `/usr/bin/node`.

## Development

```sh
npm ci --prefix ./sites-space-ar
npm test --prefix ./sites-space-ar

cargo test --manifest-path ./note-bridge-rs/Cargo.toml
```

The Axum bridge lives in `note-bridge-rs` and the WebXR viewer in
`sites-space-ar`. Meta Quest Sync is maintained separately at
[github.com/NElscost/meta-quest-sync](https://github.com/NElscost/meta-quest-sync).

## Optional glTF mode

Direct graph generation is the recommended path. The legacy pipeline remains
available in `Scripts/Update-SpaceModel.ps1` for users who want to export
`Space.gltf` and `Space.bin`, run offline mesh optimization, or use a prepared
Blender scene. This pipeline is still more automated on Windows than on Linux
or macOS.

## Current limitations

- Obsidian Desktop must remain open because the plugin starts local processes;
- WebXR anchors and hand microgestures depend on Quest Browser support;
- a very large note can cause a short pause during its first render;
- the first AV1/HEVC video open requires local transcoding;
- graph extraction does not reproduce every filter from third-party graph
  plugins;
- the optional Blender pipeline is not fully cross-platform.


### Curved media windows and ambilight

The note and video surfaces use lightweight segmented curved geometry. Local videos expose their own close control and keep playing while a neighboring note is opened from the local graph. Their waveform, seek position, and bookmarks remain attached below the video window; audio-only waveforms remain below the reading window.

For local vault videos, the Rust bridge asks FFmpeg for a 24×14 RGB stream at one frame per second, averages the four border bands, caches the result by file modification time, and sends only the compact color timeline to the Quest. The WebXR shader interpolates those four colors at runtime, avoiding repeated video texture samples for the ambilight effect. FFmpeg is therefore required for this optimization.
