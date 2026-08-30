export function createSpectralTrailExtension(THREE, api) {
  const WIDTH = api.width * 0.78;
  const HEIGHT = api.height * 0.72;
  const BINS = 48;
  const LAYERS = 48;
  const NETWORK_PEAKS = 14;
  const SAMPLE_INTERVAL_MS = 66;
  const LIFETIME_SECONDS = 3.25;
  let group = null;
  let content = null;
  let points = null;
  let material = null;
  let network = null;
  let networkMaterial = null;
  let state = null;
  let controls = [];
  let anchor = null;
  let placement = false;
  let frequencyData = null;
  const temp = new THREE.Object3D();

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
        color.setHSL(0.52 + bin / BINS * 0.26, 0.86, 0.62);
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
          vColor = color;
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
    if (points) points.visible = true;
    if (network) network.visible = state.mode !== 0;
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
    group = content = points = material = network = networkMaterial = state = null;
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
    content.add(createNetwork());
    group.add(content);
    state = { scale: 1, autoRotate: false, mode: 0, drags: new Map(), layer: 0, lastSample: 0, previousPeaks: [] };
    applyMode();
    addControl("spectral-smaller", -0.072, "−");
    addControl("spectral-place", -0.036, "⌖", 0xffd166);
    addControl("spectral-rotate", 0, "↻", 0x63e6be);
    addControl("spectral-larger", 0.036, "+");
    addControl("spectral-mode", 0.072, "◇", 0xb197fc);
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
      amplitudes[bin] = frequencyData[sourceIndex] / 255;
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
      born.setX(index, state.mode === 1 && !isPeak ? -1000 : timeSeconds);
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
        color.setHSL(0.52 + a.bin / BINS * 0.26, 0.86, 0.62);
        lineColor.setXYZ(vertex, color.r, color.g, color.b);
        color.setHSL(0.52 + b.bin / BINS * 0.26, 0.86, 0.62);
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
    if (material) material.uniforms.time.value = time * 0.001;
    if (networkMaterial) networkMaterial.uniforms.time.value = time * 0.001;
    sample(time);
    if (anchor && frame && referenceSpace) {
      const pose = frame.getPose(anchor.anchorSpace, referenceSpace);
      if (pose) new THREE.Matrix4().fromArray(pose.transform.matrix).decompose(group.position, group.quaternion, temp.scale);
    }
    if (state.autoRotate && !state.drags.size && content) content.rotation.y += Math.min(0.012, (time - (state.lastFrame || time)) * 0.00018);
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

  return { open, dispose, update, handle, beginDrag, endDrag, isPlacementArmed: () => placement, place };
}
