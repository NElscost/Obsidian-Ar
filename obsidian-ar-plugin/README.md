# Meta Quest Sync

Meta Quest Sync connects an Obsidian desktop vault to the **Obsidian AR**
WebXR experience on Meta Quest. From Obsidian, it exports the vault graph,
starts the local bridge and HTTPS tunnel, and displays a QR code for pairing.

The WebXR viewer, Rust bridge and cross-platform orchestration live in the
[Obsidian-Ar project](https://github.com/NElscost/Obsidian-Ar). This repository
contains only the Obsidian community plugin and its release artifacts.

## Requirements

- Obsidian desktop;
- Git, Node.js 22.13+ and Rust/Cargo;
- `cloudflared` available on `PATH`;
- FFmpeg (`ffmpeg` and `ffprobe`) for AV1/HEVC video compatibility;
- a local clone of [NElscost/Obsidian-Ar](https://github.com/NElscost/Obsidian-Ar);
- Meta Quest with an up-to-date WebXR browser and hand tracking.

The recommended direct-graph mode does not require Blender, Obsidian CLI or the
3D Graph New plugin.

The plugin uses the same Node.js bridge launcher on Windows, Linux, and macOS.
If a GUI-launched Obsidian cannot find Node.js, set an absolute path in
**Settings → Meta Quest Sync → Node.js executable**. The companion project
README lists package commands for each operating system.

## Usage

1. Install and enable **Meta Quest Sync** in Obsidian.
2. Clone the companion project:

   ```sh
   git clone https://github.com/NElscost/Obsidian-Ar.git
   ```

3. Open **Settings → Meta Quest Sync** and select the absolute path of that
   clone.
4. Keep the default HTTPS viewer and choose **Cloudflare Quick Tunnel** for a
   temporary session.
5. Select **Start AR**, then open the generated QR code on the Quest.

The plugin creates the graph snapshot, compiles the Rust bridge when needed,
starts the bridge and tunnel, and places the session credentials inside the URL
fragment. The token is not persisted by the plugin.

## Self-hosting

The default setup uses the hosted WebXR viewer and a local Rust backend exposed
through Cloudflare Tunnel. Both endpoints are configurable:

- you can host the WebXR viewer on any HTTPS server and set its address in
  **Settings → Meta Quest Sync → HTTPS viewer**;
- you can self-host the backend and point the plugin at your own URL;
- for a persistent backend address, configure a Cloudflare Named Tunnel in the
  companion project and select it in the plugin settings.

The viewer and backend may use different domains. The backend still requires
the session token and only accepts compatible HTTPS origins.

## Commands

- Start AR session;
- Show session QR code;
- Refresh graph snapshot;
- Stop AR session.

## Privacy and network access

Meta Quest Sync reads note paths and links through the Obsidian API to generate
the graph. It starts local `cargo`, bridge and `cloudflared` processes through
the companion project. The bridge exposes requested note content and media to
the paired Quest through an HTTPS Cloudflare Tunnel.

Anyone holding both the temporary bridge URL and session token can access the
allowed endpoints while the session is active. Keep them private and stop the
session when finished. The plugin has no telemetry, advertising, payment flow
or account system.

See the [main project documentation](https://github.com/NElscost/Obsidian-Ar)
for tunnel configuration, platform notes, WebXR gestures, troubleshooting and
the optional glTF pipeline.

## Development

```sh
npm ci
npm test
npm run build
```

The GitHub release tag must exactly match `manifest.json` and include
`main.js`, `manifest.json` and `styles.css`.

## License

[MIT](LICENSE)
