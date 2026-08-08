# Obsidian AR

Explore an Obsidian vault as an interactive 3D graph in mixed reality on Meta
Quest. The **Meta Quest Sync** community plugin exports the graph, starts the
local Rust bridge, creates an HTTPS tunnel, and displays a QR code for pairing.

## Features

- graph generated directly from vault notes and links, without Blender;
- passthrough or an optional equirectangular 360° panorama;
- WebXR hit testing and anchors;
- hand gestures for placement, scale, rotation, selection, and pagination;
- Markdown, tables, LaTeX, code, images, audio, and video in a 3D note window;
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
- `cloudflared` available on `PATH`;
- FFmpeg, including `ffmpeg` and `ffprobe`, for Quest-compatible conversion of
  AV1/HEVC video attachments;
- a Meta Quest with hand tracking and an up-to-date WebXR browser.

Blender, ADB, Obsidian CLI, and **3D Graph New** are not required for the
recommended direct-graph mode.

### Windows packages

Open PowerShell or Windows Terminal as Administrator:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Cloudflare.cloudflared -e
winget install --id Gyan.FFmpeg -e
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
```

### macOS packages

Install [Homebrew](https://brew.sh/) and then run:

```sh
brew install git node rustup cloudflared ffmpeg
rustup-init -y
```

Restart Obsidian. If an Obsidian instance launched from Finder cannot find
Node.js, set **Node.js executable** in the plugin to `/opt/homebrew/bin/node`
on Apple Silicon or `/usr/local/bin/node` on Intel Macs.

### Linux packages

For Debian or Ubuntu:

```sh
sudo apt update
sudo apt install -y git curl build-essential ffmpeg
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
- use the 3D controls to pin, navigate, play media, or close the note;
- select a labeled node in the note's local graph to replace both panels with
  the corresponding note and its neighborhood;
- select a hub to expand a large graph, and use **Back to overview** to return.

The simultaneous node budget is configurable from 800 to 1200. Vaults above
that budget are grouped into expandable hubs to preserve Quest performance.

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
bookmark. The preprocessing queue prioritizes notes containing video, fenced
code blocks, and LaTeX so their first open is less likely to interrupt XR.

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
npm ci --prefix ./obsidian-ar-plugin
npm test --prefix ./obsidian-ar-plugin
npm run build --prefix ./obsidian-ar-plugin

npm ci --prefix ./sites-space-ar
npm test --prefix ./sites-space-ar

cargo test --manifest-path ./note-bridge-rs/Cargo.toml
```

The Obsidian plugin lives in `obsidian-ar-plugin`, the Axum bridge in
`note-bridge-rs`, and the WebXR viewer in `sites-space-ar`.

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
