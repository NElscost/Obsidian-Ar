export function createSpectralTrailExtension(THREE, api) {
  const WIDTH = api.width * 0.78;
  const HEIGHT = api.height * 0.72;
  const BINS = 48;
  const LAYERS = 48;
  const NETWORK_PEAKS = 28;
  const MAX_LABELS = 48;
  const MAX_LABEL_GLYPHS = 1024;
  const GLYPHS = "0123456789.kHzs %·";
  const SAMPLE_INTERVAL_MS = 66;
  const LIFETIME_SECONDS = 3.25;
  let group = null;
  let content = null;
  let points = null;
  let material = null;
  let network = null;
  let networkMaterial = null;
  let peakHighlights = null;
  let frequencyLabels = null;
  let state = null;
  let controls = [];
  let anchor = null;
  let placement = false;
  let frequencyData = null;
  let analysisData = null;
  let pcaPoints = null;
  let pcaNetwork = null;
  let pcaTimes = null;
  let filterGroup = null;
  let filterControls = [];
  let filterInput = "";
  let filterDisplay = null;
  let minHz = 0;
  let loadedFilterMediaKey = "";
  const temp = new THREE.Object3D();
  function frequencyRatioForHz(hz) {
    return THREE.MathUtils.clamp(Math.log2(Math.max(20, hz) / 20) / Math.log2(18000 / 20), 0, 1);
  }
  // Reference scale: dark blue at 2 kHz through the visible spectrum to white at 10 kHz.
  const frequencyStops = [0, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 18000].map(frequencyRatioForHz);
  const frequencyColors = [0x07146f, 0x07146f, 0x164cff, 0x9d28e8, 0xff29a8, 0xff3318, 0xffe600, 0x25ed00, 0x00efc8, 0xf5ffe8, 0xffffff].map((hex) => new THREE.Color(hex));
  function setFrequencyColor(color, ratio) {
    const value = THREE.MathUtils.clamp(ratio, 0, 1);
    let index = frequencyStops.findIndex((stop) => stop >= value) - 1;
    index = THREE.MathUtils.clamp(index, 0, frequencyStops.length - 2);
    const mix = THREE.MathUtils.clamp((value - frequencyStops[index]) / Math.max(0.0001, frequencyStops[index + 1] - frequencyStops[index]), 0, 1);
    return color.copy(frequencyColors[index]).lerp(frequencyColors[index + 1], mix);
  }

  function filterStorageKey() {
    const source = String(api.mediaKey?.() || "default");
    let hash = 2166136261;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return "space-ar:spectral-min-hz:" + (hash >>> 0).toString(36);
  }
  function syncStoredFilter(force = false) {
    const key = filterStorageKey();
    if (!force && key === loadedFilterMediaKey) return false;
    loadedFilterMediaKey = key;
    minHz = Math.max(0, Math.min(24000, Number(localStorage.getItem(key)) || 0));
    filterInput = minHz ? String(Math.round(minHz)) : "";
    return true;
  }
  function saveFilter() {
    minHz = Math.max(0, Math.min(24000, Number.parseFloat(filterInput) || 0));
    localStorage.setItem(filterStorageKey(), String(minHz));
    createPcaVisualization();
    api.message(minHz ? `Spectral Trail: ignoring frequencies at or below ${Math.round(minHz)} Hz.` : "Spectral Trail frequency filter disabled.");
  }
  function filterTexture(text, background = "#14233b") {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 96;
    const context = canvas.getContext("2d"); context.fillStyle = background; context.fillRect(0, 0, 256, 96);
    context.fillStyle = "#f5f8ff"; context.font = "700 40px Arial Narrow, sans-serif";
    context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 128, 50);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false; return texture;
  }
  function updateFilterDisplay() {
    if (!filterDisplay) return;
    filterDisplay.material.map?.dispose?.();
    filterDisplay.material.map = filterTexture((filterInput || "0") + " Hz", "#09111f");
    filterDisplay.material.needsUpdate = true;
  }
  function closeFilterKeyboard() {
    if (!filterGroup) return;
    api.removeControls(new Set(filterControls));
    const owned = new Set(filterControls); controls = controls.filter((item) => !owned.has(item));
    filterGroup.removeFromParent();
    filterGroup.traverse((object) => { object.geometry?.dispose?.(); object.material?.map?.dispose?.(); object.material?.dispose?.(); });
    filterGroup = filterDisplay = null; filterControls = [];
  }
  function addFilterKey(label, action, x, y, width = 0.052, color = "#26354d") {
    const key = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.044), new THREE.MeshBasicMaterial({ map: filterTexture(label, color), transparent: true, depthTest: true, depthWrite: false, toneMapped: false }));
    key.position.set(x, y, 0.065); key.renderOrder = 1025; key.userData.noteAction = action; key.userData.highlightScale = false;
    filterGroup.add(key); filterControls.push(key); controls.push(key); api.addControl(key);
  }
  function openFilterKeyboard() {
    if (!group) return; if (filterGroup) { closeFilterKeyboard(); return; }
    syncStoredFilter(); filterInput = minHz ? String(Math.round(minHz)) : "";
    filterGroup = new THREE.Group(); filterGroup.position.set(0, 0.035, 0.02); group.add(filterGroup);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.31), new THREE.MeshBasicMaterial({ color: 0x07111f, transparent: true, opacity: 0.88, depthTest: true, depthWrite: false }));
    panel.position.z = 0.055; panel.raycast = () => {}; filterGroup.add(panel);
    filterDisplay = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.052), new THREE.MeshBasicMaterial({ transparent: true, depthTest: true, depthWrite: false }));
    filterDisplay.position.set(0, 0.112, 0.064); filterDisplay.raycast = () => {}; filterGroup.add(filterDisplay); updateFilterDisplay();
    const keys = ["1","2","3","4","5","6","7","8","9"];
    keys.forEach((label,index)=>addFilterKey(label,"spectral-filter-key:"+label,(index%3-1)*0.062,0.052-Math.floor(index/3)*0.052));
    addFilterKey("⌫","spectral-filter-back",-0.062,-0.108,0.052,"#633548");
    addFilterKey("0","spectral-filter-key:0",0,-0.108);
    addFilterKey("OK","spectral-filter-apply",0.062,-0.108,0.052,"#167c68");
    api.message("Enter a minimum frequency. Values at or below it will be hidden from the 3D trail.");
  }

  function iconTexture(symbol) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = "#07111f";
    context.strokeStyle = "#07111f";
    context.lineWidth = 6;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.font = "700 38px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (symbol === "×") {
      context.beginPath(); context.moveTo(20, 20); context.lineTo(44, 44);
      context.moveTo(44, 20); context.lineTo(20, 44); context.stroke();
    } else if (symbol === "↻") {
      context.font = "700 42px system-ui"; context.fillText(symbol, 32, 31);
    } else if (symbol === "⌖") {
      context.beginPath(); context.arc(32, 32, 12, 0, Math.PI * 2); context.stroke();
      context.beginPath(); context.moveTo(32, 11); context.lineTo(32, 22);
      context.moveTo(32, 42); context.lineTo(32, 53); context.moveTo(11, 32);
      context.lineTo(22, 32); context.moveTo(42, 32); context.lineTo(53, 32); context.stroke();
    } else context.fillText(symbol, 32, 31);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  function createFrequencyLegend() {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 512;
    const context = canvas.getContext("2d", { alpha: true });
    const barX = 24, barY = 28, barWidth = 24, barHeight = 442;
    const gradient = context.createLinearGradient(0, barY + barHeight, 0, barY);
    const color = new THREE.Color();
    for (let step = 0; step <= 32; step += 1) {
      const displayRatio = step / 32;
      const hz = 2000 + displayRatio * 8000;
      setFrequencyColor(color, frequencyRatioForHz(hz));
      gradient.addColorStop(displayRatio, `#${color.getHexString()}`);
    }
    context.fillStyle = "rgba(4,9,17,.62)";
    context.beginPath();
    context.roundRect(8, 8, 176, 488, 18);
    context.fill();
    context.fillStyle = gradient;
    context.fillRect(barX, barY, barWidth, barHeight);
    context.strokeStyle = "rgba(255,255,255,.65)";
    context.lineWidth = 2;
    context.strokeRect(barX, barY, barWidth, barHeight);
    context.font = "700 20px Arial Narrow, Roboto Condensed, sans-serif";
    context.textBaseline = "middle";
    context.fillStyle = "#eef5ff";
    context.strokeStyle = "rgba(255,255,255,.78)";
    for (let tick = 0; tick <= 8; tick += 1) {
      const ratio = tick / 8;
      const y = barY + barHeight * (1 - ratio);
      const label = `${tick + 2}K Hz`;
      context.beginPath(); context.moveTo(barX + barWidth, y); context.lineTo(barX + barWidth + 9, y); context.stroke();
      context.save(); context.translate(barX + barWidth + 16, y); context.scale(0.76, 1); context.fillText(label, 0, 0); context.restore();
    }
    context.save();
    context.translate(166, 256);
    context.rotate(-Math.PI / 2);
    context.font = "700 20px Arial Narrow, Roboto Condensed, sans-serif";
    context.fillStyle = "rgba(238,245,255,.8)";
    context.textAlign = "center";
    context.scale(0.78, 1);
    context.fillText("FREQUENCY · Hz", 0, 0);
    context.restore();
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    const legend = new THREE.Mesh(
      new THREE.PlaneGeometry(0.068, HEIGHT * 0.47),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    legend.position.set(WIDTH / 2 - 0.045, -HEIGHT / 2 + 0.065 + HEIGHT * 0.235, 0.045);
    legend.renderOrder = 1020;
    legend.raycast = () => {};
    return legend;
  }

  function addControl(action, x, symbol, color = 0x8ba4c7) {
    const control = new THREE.Mesh(
      new THREE.CircleGeometry(0.016, 14),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, toneMapped: false })
    );
    control.position.set(x, -HEIGHT / 2 + 0.025, 0.035);
    control.renderOrder = 1021;
    control.userData.noteAction = action;
    const icon = new THREE.Mesh(
      new THREE.PlaneGeometry(0.022, 0.022),
      new THREE.MeshBasicMaterial({ map: iconTexture(symbol), transparent: true, depthTest: false, toneMapped: false })
    );
    icon.position.z = 0.003;
    icon.renderOrder = 1022;
    icon.raycast = () => {};
    control.add(icon);
    group.add(control);
    controls.push(control);
    api.addControl(control);
    return control;
  }

  function createParticles() {
    const count = BINS * LAYERS;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const born = new Float32Array(count);
    const color = new THREE.Color();
    born.fill(-1000);
    for (let layer = 0; layer < LAYERS; layer += 1) {
      for (let bin = 0; bin < BINS; bin += 1) {
        const index = layer * BINS + bin;
        positions[index * 3] = (bin / (BINS - 1) - 0.5) * WIDTH * 0.82;
        positions[index * 3 + 1] = -HEIGHT * 0.22;
        positions[index * 3 + 2] = 0;
        setFrequencyColor(color, bin / (BINS - 1));
        colors.set([color.r, color.g, color.b], index * 3);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("born", new THREE.BufferAttribute(born, 1));
    material = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        lifetime: { value: LIFETIME_SECONDS },
        depthSpeed: { value: 0.092 }
      },
      vertexShader: `
        attribute vec3 color;
        attribute float born;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float time;
        uniform float lifetime;
        uniform float depthSpeed;
        void main() {
          float age = time - born;
          float alive = step(0.0, age) * step(age, lifetime);
          float life = clamp(1.0 - age / lifetime, 0.0, 1.0) * alive;
          vec3 p = position;
          p.z -= max(age, 0.0) * depthSpeed;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = min(8.0, (3.0 + position.y * 18.0) * life * (0.55 / max(0.12, -mvPosition.z)));
          float reveal = smoothstep(0.0, 0.35, max(age, 0.0));
          vColor = mix(vec3(1.0), color, reveal);
          vAlpha = smoothstep(0.0, 0.16, life) * 0.9;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = dot(p, p);
          if (d > 0.25 || vAlpha <= 0.001) discard;
          float edge = 1.0 - smoothstep(0.12, 0.25, d);
          gl_FragColor = vec4(vColor, vAlpha * edge);
        }
      `
    });
    points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    return points;
  }

  function createPeakHighlights() {
    const positions = new Float32Array(NETWORK_PEAKS * 3);
    const colors = new Float32Array(NETWORK_PEAKS * 3);
    const strengths = new Float32Array(NETWORK_PEAKS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("strength", new THREE.BufferAttribute(strengths, 1));
    geometry.setDrawRange(0, 0);
    const peakMaterial = new THREE.ShaderMaterial({
      transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
      uniforms: { time: { value: 0 } },
      vertexShader: `
        attribute vec3 color; attribute float strength;
        varying vec3 vColor; varying float vStrength;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(24.0, (12.0 + strength * 10.0) * (0.55 / max(0.12, -mv.z)));
          vColor = color; vStrength = strength;
        }
      `,
      fragmentShader: `
        uniform float time; varying vec3 vColor; varying float vStrength;
        void main() {
          vec2 p = abs(gl_PointCoord - vec2(0.5));
          float square = max(p.x, p.y);
          if (square > 0.49) discard;
          float outer = 1.0 - smoothstep(0.445, 0.49, square);
          float inner = 1.0 - smoothstep(0.34, 0.385, square);
          float border = max(0.0, outer - inner);
          float core = 1.0 - smoothstep(0.045, 0.105, length(p));
          float pulse = 0.78 + 0.22 * sin(time * 5.0 + vStrength * 4.0);
          float alpha = max(border * (0.62 + vStrength * 0.38) * pulse, core * 0.96);
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.78), alpha);
        }
      `
    });
    peakHighlights = new THREE.Points(geometry, peakMaterial);
    peakHighlights.frustumCulled = false;
    return peakHighlights;
  }

  function createFrequencyLabels() {
    const canvas = document.createElement("canvas");
    const cell = 32;
    canvas.width = GLYPHS.length * cell;
    canvas.height = cell;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "600 21px Arial Narrow, Roboto Condensed, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (let index = 0; index < GLYPHS.length; index += 1) { context.save(); context.translate(index * cell + cell / 2, cell / 2); context.scale(0.96, 1); context.fillText(GLYPHS[index], 0, 0); context.restore(); }
    const atlas = new THREE.CanvasTexture(canvas);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.minFilter = THREE.LinearFilter;
    atlas.magFilter = THREE.LinearFilter;
    atlas.generateMipmaps = false;
    const geometry = new THREE.PlaneGeometry(0.0019, 0.0042);
    geometry.setAttribute("glyphIndex", new THREE.InstancedBufferAttribute(new Float32Array(MAX_LABEL_GLYPHS), 1));
    geometry.setAttribute("labelOffset", new THREE.InstancedBufferAttribute(new Float32Array(MAX_LABEL_GLYPHS * 2), 2));
    const labelMaterial = new THREE.ShaderMaterial({
      transparent: true, depthTest: true, depthWrite: false, toneMapped: false,
      uniforms: { atlas: { value: atlas }, cells: { value: GLYPHS.length } },
      vertexShader: `
        attribute float glyphIndex; attribute vec2 labelOffset; varying vec2 vUv;
        uniform float cells;
        void main() {
          vUv = vec2((glyphIndex + uv.x) / cells, uv.y);
          // GPU billboard: retain each glyph's local center but align its plane to the camera.
          vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          center.xy += position.xy + labelOffset;
          gl_Position = projectionMatrix * center;
        }
      `,
      fragmentShader: `
        uniform sampler2D atlas; varying vec2 vUv;
        void main() {
          float alpha = texture2D(atlas, vUv).a;
          if (alpha < 0.08) discard;
          gl_FragColor = vec4(0.93, 0.97, 1.0, alpha * 0.92);
        }
      `
    });
    frequencyLabels = new THREE.InstancedMesh(geometry, labelMaterial, MAX_LABEL_GLYPHS);
    frequencyLabels.count = 0;
    frequencyLabels.frustumCulled = false;
    frequencyLabels.renderOrder = 4;
    return frequencyLabels;
  }

  function updatePeakPresentation(peaks, analyser, labelPeaks = peaks) {
    if (!peakHighlights || !frequencyLabels) return;
    const peakPosition = peakHighlights.geometry.attributes.position;
    const peakColor = peakHighlights.geometry.attributes.color;
    const peakStrength = peakHighlights.geometry.attributes.strength;
    const color = new THREE.Color();
    peaks.forEach((peak, index) => {
      peakPosition.setXYZ(index, peak.x, peak.y, peak.z + 0.008);
      const colorRatio=Number.isFinite(peak.frequencyHz)?THREE.MathUtils.clamp(Math.log2(Math.max(20,peak.frequencyHz)/20)/Math.log2(18000/20),0,1):peak.bin/BINS;
      const reveal = Number.isFinite(peak.age) ? THREE.MathUtils.clamp(peak.age / 0.35, 0, 1) : 1;
      setFrequencyColor(color, colorRatio);
      color.setRGB(1 + (color.r - 1) * reveal, 1 + (color.g - 1) * reveal, 1 + (color.b - 1) * reveal);
      peakColor.setXYZ(index, color.r, color.g, color.b);
      peakStrength.setX(index, peak.amplitude);
    });
    peakHighlights.geometry.setDrawRange(0, peaks.length);
    peakPosition.needsUpdate = peakColor.needsUpdate = peakStrength.needsUpdate = true;

    // Label only strong, spatially separated peaks to keep the constellation readable.
    const dominant = peaks.reduce((best, peak) => !best || peak.amplitude > best.amplitude ? peak : best, null);
    // Every visible PCA point gets two billboard lines in one InstancedMesh.
    const selected = [...labelPeaks].sort((a, b) => b.amplitude - a.amplitude).slice(0, MAX_LABELS).sort((a, b) => (a.emissionTime ?? 0) - (b.emissionTime ?? 0));
    const glyphIndex = frequencyLabels.geometry.attributes.glyphIndex;
    const labelOffset = frequencyLabels.geometry.attributes.labelOffset;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const billboard = new THREE.Quaternion();
    let instance = 0;
    const sampleRate = analyser?.context?.sampleRate || 48000;
    const usable = Math.max(1, Math.floor((analyser?.frequencyBinCount || 128) * 0.72));
    for (const peak of selected) {
      const sourceIndex = Math.min(usable - 1, Math.floor(Math.pow(peak.bin / (BINS - 1), 1.55) * usable));
      const hz = Number.isFinite(peak.frequencyHz) ? peak.frequencyHz : sourceIndex * sampleRate / (analyser?.fftSize || 256);
      const frequencyLabel = hz >= 1000 ? `${(hz / 1000).toFixed(1)}kHz` : `${Math.round(hz)}Hz`;
      const topLabel = peak === dominant ? `${frequencyLabel} · ${Math.round(peak.amplitude * 100)}%` : frequencyLabel;
      const seconds = Math.max(0, Number(peak.emissionTime) || 0);
      const bottomLabel = `${seconds.toFixed(2)}s`;
      const spacing = 0.00147;
      const writeLine = (label, y) => {
        const width = label.length * spacing;
        for (let char = 0; char < label.length && instance < MAX_LABEL_GLYPHS; char += 1) {
          position.set(peak.x, peak.y, peak.z + 0.009);
          labelOffset.setXY(instance, -width / 2 + (char + 0.5) * spacing, y - peak.y);
          matrix.compose(position, billboard, scale);
          frequencyLabels.setMatrixAt(instance, matrix);
          glyphIndex.setX(instance, Math.max(0, GLYPHS.indexOf(label[char])));
          instance += 1;
        }
      };
      writeLine(topLabel, peak.y + 0.013);
      writeLine(bottomLabel, peak.y - 0.013);
    }
    frequencyLabels.count = instance;
    frequencyLabels.instanceMatrix.needsUpdate = true;
    glyphIndex.needsUpdate = true;
    labelOffset.needsUpdate = true;
  }

  function createNetwork() {
    // Sparse constellation: a bounded pair of local and temporal links per peak.
    const segmentCount = LAYERS * NETWORK_PEAKS * 2;
    const positions = new Float32Array(segmentCount * 6);
    const colors = new Float32Array(segmentCount * 6);
    const born = new Float32Array(segmentCount * 2);
    born.fill(-1000);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("born", new THREE.BufferAttribute(born, 1));
    networkMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        time: { value: 0 },
        lifetime: { value: LIFETIME_SECONDS },
        depthSpeed: { value: 0.092 }
      },
      vertexShader: `
        attribute vec3 color;
        attribute float born;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float time;
        uniform float lifetime;
        uniform float depthSpeed;
        void main() {
          float age = time - born;
          float alive = step(0.0, age) * step(age, lifetime);
          float life = clamp(1.0 - age / lifetime, 0.0, 1.0) * alive;
          vec3 p = position;
          p.z -= max(age, 0.0) * depthSpeed;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          vColor = color;
          vAlpha = smoothstep(0.0, 0.2, life) * 0.42;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          gl_FragColor = vec4(vColor, vAlpha);
        }
      `
    });
    network = new THREE.LineSegments(geometry, networkMaterial);
    network.frustumCulled = false;
    return network;
  }

  function applyMode() {
    if (!state) return;
    const pca = Boolean(analysisData?.points?.length);
    if (points) points.visible = !pca;
    if (network) network.visible = !pca && state.mode !== 0;
    if (peakHighlights) peakHighlights.visible = state.mode !== 0;
    if (frequencyLabels) frequencyLabels.visible = state.mode !== 0;
    if (pcaPoints) pcaPoints.visible = pca;
    if (pcaNetwork) pcaNetwork.visible = pca && state.mode !== 0;
  }

  function disposePcaVisualization() {
    for (const object of [pcaPoints,pcaNetwork]) { if(!object)continue; object.removeFromParent(); object.geometry?.dispose?.(); object.material?.dispose?.(); }
    pcaPoints=pcaNetwork=null; pcaTimes=null;
  }

  function createPcaVisualization() {
    disposePcaVisualization();
    const source=(analysisData?.points??[]).filter((point)=>Math.max(0,Number(point.frequencyHz)||0)>minHz);
    if(!content||!Array.isArray(source)||!source.length){applyMode();return;}
    const count=Math.min(source.length,32768),positions=new Float32Array(count*3),colors=new Float32Array(count*3),times=new Float32Array(count),sizes=new Float32Array(count); const color=new THREE.Color();
    for(let i=0;i<count;i++){const point=source[i],xyz=point.xyz??[0,0,0],hz=Math.max(20,Number(point.frequencyHz)||20),ratio=THREE.MathUtils.clamp(Math.log2(hz/20)/Math.log2(18000/20),0,1);positions[i*3]=(Number(xyz[0])||0)/32767*WIDTH*.43;positions[i*3+1]=(Number(xyz[1])||0)/32767*HEIGHT*.43;positions[i*3+2]=(Number(xyz[2])||0)/32767*.22;setFrequencyColor(color,ratio);colors.set([color.r,color.g,color.b],i*3);times[i]=(Number(point.timeMs)||0)/1000;sizes[i]=.65+(Number(point.amplitude)||0)/255*1.7;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setAttribute('emissionTime',new THREE.BufferAttribute(times,1));geometry.setAttribute('pointScale',new THREE.BufferAttribute(sizes,1)); pcaTimes=times;
    const uniforms={playback:{value:0},lifetime:{value:LIFETIME_SECONDS}};
    pcaPoints=new THREE.Points(geometry,new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,vertexColors:true,uniforms,vertexShader:`attribute float emissionTime;attribute float pointScale;varying vec3 vColor;varying float vAlpha;uniform float playback;uniform float lifetime;void main(){float age=playback-emissionTime;float alive=step(0.0,age)*step(age,lifetime);vAlpha=alive*clamp(1.0-age/lifetime,0.0,1.0);float reveal=smoothstep(0.0,.35,max(age,0.0));vColor=mix(vec3(1.0),color,reveal);vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=(3.5+5.5*pointScale)/max(.45,-mv.z);gl_Position=projectionMatrix*mv;}`,fragmentShader:`varying vec3 vColor;varying float vAlpha;void main(){vec2 p=abs(gl_PointCoord-vec2(.5));float edge=max(p.x,p.y);if(edge>.49||vAlpha<.002)discard;float border=smoothstep(.34,.43,edge);float core=1.0-smoothstep(.035,.10,length(p));float alpha=max(border*.92,core);if(alpha<.025)discard;gl_FragColor=vec4(mix(vColor,vec3(1.0),core*.72),vAlpha*alpha);}`}));pcaPoints.frustumCulled=false;pcaPoints.renderOrder=7;content.add(pcaPoints);
    if(count>1){const lp=new Float32Array((count-1)*6),lc=new Float32Array((count-1)*6),lt=new Float32Array((count-1)*2);for(let i=0;i<count-1;i++){lp.set(positions.subarray(i*3,i*3+3),i*6);lp.set(positions.subarray((i+1)*3,(i+1)*3+3),i*6+3);lc.set(colors.subarray(i*3,i*3+3),i*6);lc.set(colors.subarray((i+1)*3,(i+1)*3+3),i*6+3);lt[i*2]=lt[i*2+1]=times[i+1];}const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.BufferAttribute(lp,3));lg.setAttribute('color',new THREE.BufferAttribute(lc,3));lg.setAttribute('emissionTime',new THREE.BufferAttribute(lt,1));pcaNetwork=new THREE.LineSegments(lg,new THREE.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,vertexColors:true,uniforms:{playback:uniforms.playback,lifetime:uniforms.lifetime},vertexShader:`attribute float emissionTime;varying vec3 vColor;varying float vAlpha;uniform float playback;uniform float lifetime;void main(){float age=playback-emissionTime;vAlpha=step(0.0,age)*step(age,lifetime)*clamp(1.0-age/lifetime,0.0,1.0)*.5;vColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,fragmentShader:`varying vec3 vColor;varying float vAlpha;void main(){if(vAlpha<.002)discard;gl_FragColor=vec4(vColor,vAlpha);}`}));pcaNetwork.frustumCulled=false;pcaNetwork.renderOrder=6;content.add(pcaNetwork);}
    applyMode();
  }

  function setAnalysis(data) { analysisData=String(data?.method||'').startsWith('mfcc40-pca3')&&Array.isArray(data.points)?data:null; createPcaVisualization(); }

  function lowerBound(values,target){let lo=0,hi=values?.length||0;while(lo<hi){const mid=(lo+hi)>>>1;if(values[mid]<target)lo=mid+1;else hi=mid;}return lo;}

  function updatePcaWindow(playbackTime){
    if(!pcaTimes?.length)return;
    const start=lowerBound(pcaTimes,Math.max(0,playbackTime-LIFETIME_SECONDS));
    const end=lowerBound(pcaTimes,playbackTime+0.0001);
    pcaPoints?.geometry.setDrawRange(start,Math.max(0,end-start));
    if(pcaNetwork){const first=Math.max(0,start-1),last=Math.max(first,end-1);pcaNetwork.geometry.setDrawRange(first*2,Math.max(0,(last-first)*2));}
  }

  function updatePcaPresentation(playbackTime) {
    if(!analysisData?.points?.length||!state||state.mode===0)return;
    const previous=Number(state.pcaLabelAt);
    if(Number.isFinite(previous)&&playbackTime>=previous&&playbackTime-previous<.14)return;state.pcaLabelAt=playbackTime;
    const candidates=[];for(const point of analysisData.points){const t=(Number(point.timeMs)||0)/1000;if(t>playbackTime)break;if(t<playbackTime-LIFETIME_SECONDS)continue;const xyz=point.xyz??[0,0,0],hz=Math.max(20,Number(point.frequencyHz)||20);if(hz<=minHz)continue;const ratio=THREE.MathUtils.clamp(Math.log2(hz/20)/Math.log2(18000/20),0,1);candidates.push({bin:Math.round(ratio*(BINS-1)),frequencyHz:hz,emissionTime:t,age:playbackTime-t,amplitude:(Number(point.amplitude)||0)/255,x:(Number(xyz[0])||0)/32767*WIDTH*.43,y:(Number(xyz[1])||0)/32767*HEIGHT*.43,z:(Number(xyz[2])||0)/32767*.22});}
    const highlighted=[...candidates].sort((a,b)=>b.amplitude-a.amplitude).slice(0,NETWORK_PEAKS);updatePeakPresentation(highlighted,api.getAnalyser?.(),candidates);
  }


  function dispose() {
    if (anchor?.delete) anchor.delete();
    anchor = null;
    placement = false;
    api.disarmPlacement?.();
    api.removeControls(new Set(controls));
    api.unregister(group, false);
    if (group) {
      group.removeFromParent();
      group.traverse((object) => {
        object.geometry?.dispose?.();
        object.material?.map?.dispose?.();
        object.material?.dispose?.();
      });
    }
    closeFilterKeyboard();
    disposePcaVisualization();
    group = content = points = material = network = networkMaterial = peakHighlights = frequencyLabels = state = null;
    controls = [];
    frequencyData = null;
    api.layout();
  }

  function open() {
    if (group) { dispose(); return; }
    group = new THREE.Group();
    group.name = "spectral-trail-window";
    const dragSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(WIDTH * 0.9, HEIGHT * 0.72),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false })
    );
    dragSurface.position.z = 0.025;
    dragSurface.userData.noteAction = "spectral-drag";
    dragSurface.userData.highlightScale = false;
    dragSurface.userData.preserveOpacity = true;
    group.add(dragSurface);
    controls.push(dragSurface);
    api.addControl(dragSurface);
    content = new THREE.Group();
    content.position.z = 0.04;
    content.add(createParticles());
    content.add(createPeakHighlights());
    content.add(createFrequencyLabels());
    content.add(createNetwork());
    createPcaVisualization();
    // Virtual hands write depth at renderOrder 4. Draw the transparent graph
    // afterwards so its points, links and labels are correctly hidden by hands.
    content.traverse((object) => {
      if (!(object.isPoints || object.isLineSegments || object.isMesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const item of materials) {
        if (!item) continue;
        item.depthTest = true;
        item.depthWrite = false;
        item.needsUpdate = true;
      }
      object.renderOrder = Math.max(6, object.renderOrder || 0);
    });
    group.add(content);
    group.add(createFrequencyLegend());
    syncStoredFilter(true);
    state = { scale: 1, autoRotate: false, mode: 0, drags: new Map(), layer: 0, lastSample: 0, previousPeaks: [], visualTime: 0, lastFrame: performance.now(), pcaLabelAt: -1 };
    applyMode();
    addControl("spectral-smaller", -0.072, "−");
    addControl("spectral-place", -0.036, "⌖", 0xffd166);
    addControl("spectral-rotate", 0, "↻", 0x63e6be);
    addControl("spectral-larger", 0.036, "+");
    addControl("spectral-mode", 0.072, "◇", 0xb197fc);
    addControl("spectral-filter", 0.108, "Hz", 0x4dabf7);
    addControl("spectral-close", WIDTH / 2 - 0.022, "×", 0xff6b6b);
    api.register(group, WIDTH);
    api.message("Spectral Trail ready. Pinch-drag to rotate or use both hands to scale.");
  }

  function sample(time) {
    const analyser = api.getAnalyser?.();
    if (!analyser || !state || !points || time - state.lastSample < SAMPLE_INTERVAL_MS) return;
    state.lastSample = time;
    frequencyData ??= new Uint8Array(analyser.frequencyBinCount);
    if (frequencyData.length !== analyser.frequencyBinCount) frequencyData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(frequencyData);
    const position = points.geometry.attributes.position;
    const born = points.geometry.attributes.born;
    const timeSeconds = time * 0.001;
    const usable = Math.max(1, Math.floor(frequencyData.length * 0.72));
    const amplitudes = new Float32Array(BINS);
    for (let bin = 0; bin < BINS; bin += 1) {
      const sourceIndex = Math.min(usable - 1, Math.floor(Math.pow(bin / (BINS - 1), 1.55) * usable));
      const hz = sourceIndex * (analyser.context?.sampleRate || 48000) / (analyser.fftSize || 256);
      amplitudes[bin] = hz <= minHz ? 0 : frequencyData[sourceIndex] / 255;
    }

    const localPeaks = [];
    for (let bin = 1; bin < BINS - 1; bin += 1) {
      const amplitude = amplitudes[bin];
      if (amplitude >= 0.12 && amplitude >= amplitudes[bin - 1] && amplitude >= amplitudes[bin + 1]) {
        localPeaks.push({ bin, amplitude });
      }
    }
    localPeaks.sort((a, b) => b.amplitude - a.amplitude);
    if (localPeaks.length < 6) {
      const used = new Set(localPeaks.map((peak) => peak.bin));
      [...amplitudes.keys()]
        .sort((a, b) => amplitudes[b] - amplitudes[a])
        .some((bin) => {
          if (!used.has(bin) && amplitudes[bin] > 0.045) localPeaks.push({ bin, amplitude: amplitudes[bin] });
          return localPeaks.length >= 6;
        });
    }
    localPeaks.length = Math.min(localPeaks.length, NETWORK_PEAKS);
    localPeaks.sort((a, b) => a.bin - b.bin);
    const peakBins = new Set(localPeaks.map((peak) => peak.bin));

    for (let bin = 0; bin < BINS; bin += 1) {
      const amplitude = amplitudes[bin];
      const index = state.layer * BINS + bin;
      const isPeak = peakBins.has(bin);
      const descriptorDepth = isPeak ? Math.sin(bin * 1.73 + state.layer * 0.41) * (0.012 + amplitude * 0.038) : 0;
      position.setXYZ(
        index,
        (bin / (BINS - 1) - 0.5) * WIDTH * 0.82,
        -HEIGHT * 0.22 + Math.pow(amplitude, 1.35) * HEIGHT * 0.53,
        descriptorDepth
      );
      const sourceIndex = Math.min(usable - 1, Math.floor(Math.pow(bin / (BINS - 1), 1.55) * usable));
      const binHz = sourceIndex * (analyser.context?.sampleRate || 48000) / (analyser.fftSize || 256);
      born.setX(index, binHz <= minHz || (state.mode === 1 && !isPeak) ? -1000 : timeSeconds);
    }
    position.needsUpdate = true;
    born.needsUpdate = true;

    if (network) {
      const linePosition = network.geometry.attributes.position;
      const lineColor = network.geometry.attributes.color;
      const lineBorn = network.geometry.attributes.born;
      const segmentsPerLayer = NETWORK_PEAKS * 2;
      const firstSegment = state.layer * segmentsPerLayer;
      for (let slot = 0; slot < segmentsPerLayer; slot += 1) {
        const vertex = (firstSegment + slot) * 2;
        lineBorn.setX(vertex, -1000);
        lineBorn.setX(vertex + 1, -1000);
      }
      let slot = 0;
      const color = new THREE.Color();
      const pointFor = (peak) => {
        const index = state.layer * BINS + peak.bin;
        return { bin: peak.bin, amplitude: peak.amplitude, x: position.getX(index), y: position.getY(index), z: position.getZ(index) };
      };
      const currentPeaks = localPeaks.map(pointFor);
      const writeSegment = (a, b) => {
        if (slot >= segmentsPerLayer) return;
        const vertex = (firstSegment + slot) * 2;
        linePosition.setXYZ(vertex, a.x, a.y, a.z);
        linePosition.setXYZ(vertex + 1, b.x, b.y, b.z);
        setFrequencyColor(color, a.bin / (BINS - 1));
        lineColor.setXYZ(vertex, color.r, color.g, color.b);
        setFrequencyColor(color, b.bin / (BINS - 1));
        lineColor.setXYZ(vertex + 1, color.r, color.g, color.b);
        lineBorn.setX(vertex, timeSeconds);
        lineBorn.setX(vertex + 1, timeSeconds);
        slot += 1;
      };

      // Short links create clusters; broad frequency gaps stay visually independent.
      for (let index = 0; index < currentPeaks.length - 1; index += 1) {
        const a = currentPeaks[index];
        const b = currentPeaks[index + 1];
        if (b.bin - a.bin <= 9 && Math.abs(b.amplitude - a.amplitude) <= 0.42) writeSegment(a, b);
      }
      // One nearest predecessor per peak creates the fading 3D trail seen in timbre maps.
      for (const peak of currentPeaks) {
        let nearest = null;
        let distance = Infinity;
        for (const previous of state.previousPeaks) {
          const candidate = Math.abs(previous.bin - peak.bin);
          if (candidate < distance) { distance = candidate; nearest = previous; }
        }
        if (nearest && distance <= 5) writeSegment(peak, nearest);
      }
      state.previousPeaks = currentPeaks;
      updatePeakPresentation(currentPeaks, analyser);
      linePosition.needsUpdate = true;
      lineColor.needsUpdate = true;
      lineBorn.needsUpdate = true;
    }
    state.layer = (state.layer + 1) % LAYERS;
  }

  function beginDrag(event) {
    if (!state || !group) return false;
    const point = api.pinchPoint?.(event.frame, event.inputSource);
    if (!point) return false;
    state.drags.set(event.inputSource, { point: group.worldToLocal(point.clone()) });
    if (state.drags.size === 2) {
      const values = [...state.drags.values()];
      state.pinchDistance = values[0].point.distanceTo(values[1].point);
      state.pinchScale = state.scale;
    }
    return true;
  }

  function endDrag(source) {
    state?.drags?.delete(source);
    if (state?.drags?.size < 2) state.pinchDistance = 0;
  }

  function update(time, frame, referenceSpace) {
    if (!state || !group) return;
    if (syncStoredFilter()) createPcaVisualization();
    const frameDelta = Math.min(100, Math.max(0, time - (state.lastFrame || time)));
    const playing = api.isPlaying?.() ?? true;
    if (playing) state.visualTime += frameDelta;
    const visualTime = state.visualTime;
    if (material) material.uniforms.time.value = visualTime * 0.001;
    if (networkMaterial) networkMaterial.uniforms.time.value = visualTime * 0.001;
    if (peakHighlights) peakHighlights.material.uniforms.time.value = visualTime * 0.001;
    const playbackTime=Math.max(0,Number(api.currentTime?.())||0);
    if(pcaPoints)pcaPoints.material.uniforms.playback.value=playbackTime;
    if(pcaNetwork)pcaNetwork.material.uniforms.playback.value=playbackTime;
    if(analysisData?.points?.length){updatePcaWindow(playbackTime);updatePcaPresentation(playbackTime);}
    if (playing && !analysisData?.points?.length) sample(visualTime);
    if (anchor && frame && referenceSpace) {
      const pose = frame.getPose(anchor.anchorSpace, referenceSpace);
      if (pose) new THREE.Matrix4().fromArray(pose.transform.matrix).decompose(group.position, group.quaternion, temp.scale);
    }
    if (playing && state.autoRotate && !state.drags.size && content) content.rotation.y += Math.min(0.012, frameDelta * 0.00018);
    state.lastFrame = time;
    if (!state.drags.size || !frame) return;
    const values = [];
    for (const [source, drag] of state.drags) {
      const point = api.pinchPoint?.(frame, source);
      if (!point) { state.drags.delete(source); continue; }
      values.push({ drag, local: group.worldToLocal(point.clone()) });
    }
    if (values.length >= 2) {
      const distance = values[0].local.distanceTo(values[1].local);
      if (state.pinchDistance > 0) {
        state.scale = THREE.MathUtils.clamp(state.pinchScale * distance / state.pinchDistance, 0.45, 3.2);
        content.scale.setScalar(state.scale);
      }
    } else if (values.length === 1) {
      const { drag, local } = values[0];
      content.rotation.y += (local.x - drag.point.x) * 7;
      content.rotation.x = THREE.MathUtils.clamp(content.rotation.x - (local.y - drag.point.y) * 7, -1.35, 1.35);
      drag.point.copy(local);
    }
  }

  function startPlacement() {
    if (!group || placement) return;
    placement = true;
    state.drags.clear();
    api.unregister(group);
    api.scene.add(group);
    group.visible = false;
    api.armPlacement?.();
    api.message("Point at a surface and pinch to anchor the Spectral Trail.");
  }

  async function place(hit, event, referenceSpace) {
    if (!placement || !group || !referenceSpace) return false;
    const pose = hit?.getPose(referenceSpace);
    if (!pose) return false;
    const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const surfacePosition = new THREE.Vector3();
    matrix.decompose(surfacePosition, temp.quaternion, temp.scale);
    const cameraPosition = new THREE.Vector3();
    api.camera.getWorldPosition(cameraPosition);
    group.position.copy(surfacePosition).add(new THREE.Vector3(0, 0.2, 0));
    group.lookAt(cameraPosition.x, group.position.y, cameraPosition.z);
    group.visible = true;
    placement = false;
    api.disarmPlacement?.();
    if (event?.frame?.createAnchor) {
      try {
        anchor = await event.frame.createAnchor(
          new XRRigidTransform(
            { x: group.position.x, y: group.position.y, z: group.position.z },
            { x: group.quaternion.x, y: group.quaternion.y, z: group.quaternion.z, w: group.quaternion.w }
          ),
          referenceSpace
        );
      } catch (error) { console.warn("Spectral anchor unavailable; keeping a fixed pose.", error); }
    }
    api.message("Spectral Trail anchored.");
    return true;
  }

  function handle(action) {
    if (action === "spectral-drag") return true;
    if (action === "spectral-filter") { openFilterKeyboard(); return true; }
    if (action.startsWith("spectral-filter-key:")) { filterInput = (filterInput + action.slice(20)).replace(/^0+(?=\d)/, "").slice(0, 5); updateFilterDisplay(); return true; }
    if (action === "spectral-filter-back") { filterInput = filterInput.slice(0, -1); updateFilterDisplay(); return true; }
    if (action === "spectral-filter-apply") { saveFilter(); closeFilterKeyboard(); return true; }
    if (action === "spectral-toggle") { open(); return true; }
    if (!state) return false;
    if (action === "spectral-close") { dispose(); api.message("Spectral Trail closed."); }
    else if (action === "spectral-place") startPlacement();
    else if (action === "spectral-smaller" || action === "spectral-larger") {
      state.scale = THREE.MathUtils.clamp(state.scale * (action === "spectral-larger" ? 1.18 : 0.85), 0.45, 3.2);
      content.scale.setScalar(state.scale);
    } else if (action === "spectral-rotate") {
      state.autoRotate = !state.autoRotate;
      api.message(`Spectral rotation ${state.autoRotate ? "enabled" : "disabled"}.`);
    } else if (action === "spectral-mode") {
      state.mode = (state.mode + 1) % 3;
      applyMode();
      api.message(`Spectral view: ${["points", "network", "points + network"][state.mode]}.`);
    } else return false;
    return true;
  }

  return{ open, dispose, update, handle, beginDrag, endDrag, setAnalysis, isPlacementArmed: () => placement, place ,getObject:()=>group};}
