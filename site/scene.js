// Site copy (adds an optional camera `distance`; rendering otherwise unchanged). Vendored from ~/Projects/afterlight/src/scene.js (sha256 b8cbbedd19ac666e…) on 2026-09-26.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const CELL = 1.08, HALF = CELL / 2, HEIGHT = .39;
const AMBER = 0xf0b769, ICE = 0x8dd4ed;
const sidePoint = (entry) => [new THREE.Vector3(0, HEIGHT, -HALF), new THREE.Vector3(HALF, HEIGHT, 0), new THREE.Vector3(0, HEIGHT, HALF), new THREE.Vector3(-HALF, HEIGHT, 0)][entry];
const center = (row, col) => new THREE.Vector3((col - 2.5) * CELL, 0, (row - 2.5) * CELL);

// Each channel is an exact quarter-circle between two side midpoints.
function channelPoints(a, b, segments = 28) {
  const start = sidePoint(a), end = sidePoint(b);
  const corner = new THREE.Vector3(start.x + end.x, HEIGHT, start.z + end.z);
  const v0 = start.clone().sub(corner), v1 = end.clone().sub(corner);
  const angle = Math.atan2(v0.x * v1.z - v0.z * v1.x, v0.dot(v1));
  const initial = Math.atan2(v0.z, v0.x);
  return Array.from({ length: segments + 1 }, (_, i) => {
    const theta = initial + angle * i / segments;
    return new THREE.Vector3(corner.x + HALF * Math.cos(theta), HEIGHT, corner.z + HALF * Math.sin(theta));
  });
}
function rounded(w, h, d, radius = .08) { return new RoundedBoxGeometry(w, h, d, 4, radius); }
function glowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'), g = ctx.createRadialGradient(64, 64, 1, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.15, 'rgba(255,255,255,.7)'); g.addColorStop(.4, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
function labelTexture(text) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#a5b3c1'; ctx.font = '400 44px "Avenir Next", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 32, 33);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

export function createScene(container, { onTile = () => {}, onHover = () => {}, distance = 1 } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0b1420'); scene.fog = new THREE.FogExp2('#0b1420', .033);
  const camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
  camera.position.set(2.4, 12.8, 9.5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.2;
  renderer.domElement.setAttribute('aria-label', 'Interactive three dimensional Afterlight game board');
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  container.appendChild(renderer.domElement);
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(800, 800), .29, .55, 1.25); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = .075; controls.enablePan = false;
  controls.minDistance = 8; controls.maxDistance = 23; controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI * .4;
  controls.target.set(0, 0, 0); controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  function positionCamera(x, y, z) {
    // Flush a drag's remaining momentum before installing the fixed view.
    // Otherwise damping keeps orbiting after a reset/top-view action.
    const damping = controls.enableDamping;
    controls.enableDamping = false; controls.update();
    controls.target.set(0, .12, 0); camera.position.set(x, y, z); camera.up.set(0, 1, 0);
    controls.update(); controls.enableDamping = damping;
  }
  function resetCamera() { positionCamera(2.4 * distance, 12.8 * distance, 9.5 * distance); }
  resetCamera();
  scene.add(new THREE.HemisphereLight(0xc7dff5, 0x10151e, 2.2));
  const key = new THREE.DirectionalLight(0xe7edff, 4); key.position.set(-4, 10, 3); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = key.shadow.camera.bottom = -6;
  key.shadow.camera.right = key.shadow.camera.top = 6; key.shadow.normalBias = .025; key.shadow.bias = -.0002; key.shadow.radius = 5; scene.add(key);
  const rim = new THREE.DirectionalLight(0x8ebed9, 2); rim.position.set(4, 4, -6); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x080f19, roughness: .9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -.52; floor.receiveShadow = true; scene.add(floor);
  const board = new THREE.Group(); scene.add(board);
  const plinth = new THREE.Mesh(rounded(7.28, .48, 7.28, .16), new THREE.MeshStandardMaterial({ color: 0x14212d, roughness: .48, metalness: .35 }));
  plinth.position.y = -.09; plinth.castShadow = plinth.receiveShadow = true; board.add(plinth);
  const undercut = new THREE.Mesh(rounded(6.94, .18, 6.94, .13), new THREE.MeshStandardMaterial({ color: 0x080e16, roughness: .6, metalness: .4 }));
  undercut.position.y = -.38; undercut.castShadow = true; board.add(undercut);
  const topPlate = new THREE.Mesh(rounded(6.69, .1, 6.69, .07), new THREE.MeshStandardMaterial({ color: 0x0c151f, roughness: .45 }));
  topPlate.position.y = .165; topPlate.receiveShadow = true; board.add(topPlate);

  const tiles = [], hitMeshes = [];
  const tileGeometry = rounded(1.015, .17, 1.015, .055);
  const grooveMaterial = new THREE.MeshStandardMaterial({ color: 0x08141e, roughness: .8 });
  const routeMaterial = new THREE.MeshStandardMaterial({ color: 0x99bdc6, emissive: 0x6bafc1, emissiveIntensity: .35, metalness: .2, roughness: .38 });
  const channelGeometries = [[0, 1], [2, 3]].map(([a, b]) => {
    const curve = new THREE.CatmullRomCurve3(channelPoints(a, b));
    return [new THREE.TubeGeometry(curve, 32, .068, 8, false), new THREE.TubeGeometry(curve, 32, .025, 8, false)];
  });
  for (let i = 0; i < 36; i++) {
    const root = new THREE.Group(); root.position.copy(center(Math.floor(i / 6), i % 6)); board.add(root);
    const material = new THREE.MeshStandardMaterial({ color: 0x2c4050, roughness: .34, metalness: .25, emissive: 0x000000 });
    const mesh = new THREE.Mesh(tileGeometry, material); mesh.position.y = .295; mesh.castShadow = mesh.receiveShadow = true; mesh.userData.index = i; root.add(mesh); hitMeshes.push(mesh);
    const channel = new THREE.Group(); root.add(channel);
    for (const [grooveGeo, routeGeo] of channelGeometries) {
      const groove = new THREE.Mesh(grooveGeo, grooveMaterial); groove.scale.y = .075; groove.position.y = HEIGHT * (1 - .075) - .004; channel.add(groove);
      const route = new THREE.Mesh(routeGeo, routeMaterial); route.scale.y = .5; route.position.y = HEIGHT * .5 + .002; channel.add(route);
    }
    const marker = new THREE.Mesh(new THREE.RingGeometry(.063, .079, 24), new THREE.MeshBasicMaterial({ color: 0xebf4f1, transparent: true, opacity: .34, side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.y = .383; marker.visible = false; root.add(marker);
    tiles.push({ root, mesh, channel, marker });
  }
  // The collectors are actual raised light wells, outside the playing surface.
  for (const side of [0, 1]) {
    const color = side ? ICE : AMBER, x = side ? 3.51 : -3.51;
    const well = new THREE.Mesh(rounded(.17, .1, 5.94, .06), new THREE.MeshStandardMaterial({ color: 0x080e17, roughness: .4, metalness: .7 })); well.position.set(x, .2, 0); board.add(well);
    const lightBar = new THREE.Mesh(rounded(.047, .035, 5.8, .016), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.8, roughness: .3 })); lightBar.position.set(x, .265, 0); board.add(lightBar);
    const light = new THREE.PointLight(color, 2.4, 4, 2); light.position.set(x, 1, 0); scene.add(light);
  }
  for (let i = 0; i < 6; i++) {
    const material = new THREE.MeshBasicMaterial({ map: labelTexture(String.fromCharCode(65 + i)), transparent: true, depthWrite: false });
    const label = new THREE.Mesh(new THREE.PlaneGeometry(.24, .24), material); label.rotation.x = -Math.PI / 2; label.position.set((i - 2.5) * CELL, .165, 3.49); board.add(label);
    const north = label.clone(); north.position.z = -3.49; board.add(north);
    const rowMaterial = new THREE.MeshBasicMaterial({ map: labelTexture(String(i + 1)), transparent: true, depthWrite: false });
    const west = new THREE.Mesh(new THREE.PlaneGeometry(.23, .23), rowMaterial); west.rotation.x = -Math.PI / 2; west.position.set(-3.35, .27, (i - 2.5) * CELL); board.add(west);
    const east = west.clone(); east.position.x = 3.35; board.add(east);
  }
  const glow = glowTexture();
  const dustPositions = new Float32Array(54 * 3);
  for (let i = 0; i < 54; i++) {
    // Seeded placement keeps screenshots and resets visually consistent.
    dustPositions[i * 3] = Math.sin(i * 127.13) * 9;
    dustPositions[i * 3 + 1] = .7 + (Math.sin(i * 47.79) + 1) * 1.5;
    dustPositions[i * 3 + 2] = Math.cos(i * 78.17) * 8;
  }
  const dustGeometry = new THREE.BufferGeometry(); dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xaac6da, size: .045, map: glow, transparent: true, opacity: .13, depthWrite: false, blending: THREE.AdditiveBlending })); scene.add(dust);
  const sparkGeometry = new THREE.SphereGeometry(.079, 20, 14);
  const sparkMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaffff, emissiveIntensity: 3.4, roughness: .12 });
  const sparksGroup = new THREE.Group(); board.add(sparksGroup);
  const sparkObjects = new Map();
  function makeSpark(id) {
    const group = new THREE.Group(), core = new THREE.Mesh(sparkGeometry, sparkMaterial); group.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xcceffc, transparent: true, opacity: .48, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(.63, .63, 1); group.add(halo);
    const foot = new THREE.Mesh(new THREE.RingGeometry(.115, .125, 32), new THREE.MeshBasicMaterial({ color: 0xcceffc, transparent: true, opacity: .22, side: THREE.DoubleSide })); foot.rotation.x = -Math.PI / 2; foot.position.y = -.064; group.add(foot);
    const cueGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -.045, .1), new THREE.Vector3(0, -.045, .27),
      new THREE.Vector3(0, -.045, .27), new THREE.Vector3(-.043, -.045, .21),
      new THREE.Vector3(0, -.045, .27), new THREE.Vector3(.043, -.045, .21),
    ]);
    const cue = new THREE.LineSegments(cueGeometry, new THREE.LineBasicMaterial({ color: 0xe5f7fc, transparent: true, opacity: .66 }));
    group.add(cue); group.userData.entryCue = cue;
    sparksGroup.add(group); sparkObjects.set(id, group); return group;
  }
  function sparkPosition(spark) { return sidePoint(spark.entry).add(center(spark.row, spark.col)).add(new THREE.Vector3(0, .092, 0)); }
  let state = null, selection = null, hovered = null, previewTile = null, reduced = false, animating = false, dead = false;
  let preview = new THREE.Group(); board.add(preview);
  function refreshTiles() {
    const occupied = new Set((state?.sparks || []).map(s => s.row * 6 + s.col));
    tiles.forEach((tile, index) => {
      const selected = selection === index, hover = hovered === index && !occupied.has(index);
      tile.mesh.material.color.setHex(selected ? 0x4b6270 : hover ? 0x3b5262 : 0x2c4050);
      tile.mesh.material.emissive.setHex(selected ? 0x18282a : hover ? 0x071018 : 0x000000);
      tile.marker.visible = occupied.has(index);
    });
  }
  function setState(next) {
    clearPreview();
    state = next;
    tiles.forEach((tile, i) => { tile.channel.rotation.y = next.tiles[i] * Math.PI / 2; tile.root.position.y = 0; });
    const active = new Set(next.sparks.map(s => s.id));
    for (const [id, object] of sparkObjects) {
      if (!active.has(id)) {
        sparksGroup.remove(object); sparkObjects.delete(id);
        object.traverse(child => {
          if ((child.isMesh || child.isLineSegments) && child.geometry !== sparkGeometry) child.geometry.dispose();
          if (child.material && child.material !== sparkMaterial) child.material.dispose();
        });
      }
    }
    for (const spark of next.sparks) {
      const object = sparkObjects.get(spark.id) || makeSpark(spark.id);
      object.position.copy(sparkPosition(spark)); object.scale.setScalar(1); object.visible = true;
      object.userData.entryCue.rotation.y = -spark.entry * Math.PI / 2;
      object.userData.entryCue.visible = true;
    }
    refreshTiles();
  }
  function setSelection(index) { if (index !== selection) clearPreview(); selection = index; refreshTiles(); }
  function clearPreview() {
    if (previewTile !== null && state) tiles[previewTile].channel.rotation.y = state.tiles[previewTile] * Math.PI / 2;
    previewTile = null;
    for (const object of preview.children) { object.geometry?.dispose(); if (object.material) { for (const m of Array.isArray(object.material) ? object.material : [object.material]) m.dispose(); } }
    preview.clear();
  }
  function eventPoints(event) {
    const c = center(event.from.row, event.from.col);
    const points = channelPoints(event.from.entry, event.exit).map(p => p.add(c).add(new THREE.Vector3(0, .092, 0)));
    if (event.score !== null) {
      const end = points.at(-1).clone(); end.x = event.score === 0 ? -3.53 : 3.53; points.push(end);
    }
    return points;
  }
  function setPreview(result) {
    clearPreview();
    if (!result || animating) return;
    if (state && selection !== null && !state.sparks.some(spark => spark.row * 6 + spark.col === selection)) {
      previewTile = selection;
      tiles[selection].channel.rotation.y = (1 - state.tiles[selection]) * Math.PI / 2;
    }
    for (const event of result.events) {
      const points = eventPoints(event), color = event.score === null ? 0xc5e4ea : event.score === 0 ? AMBER : ICE;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color, transparent: true, opacity: .72, dashSize: .045, gapSize: .035, depthTest: false })); line.computeLineDistances(); preview.add(line);
      const ring = new THREE.Mesh(new THREE.RingGeometry(.081, .104, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .64, side: THREE.DoubleSide, depthTest: false })); ring.position.copy(points.at(-1)); ring.rotation.x = -Math.PI / 2; preview.add(ring);
    }
  }
  const ease = t => t * t * (3 - 2 * t);
  function tween(duration, update) {
    return new Promise(resolve => {
      const start = performance.now();
      const tick = now => { if (dead) { resolve(); return; } const p = Math.min(1, (now - start) / duration); update(ease(p), p); if (p < 1) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    });
  }
  async function animateMove(before, result, selected, { duration = 1250 } = {}) {
    if (animating || dead) return;
    animating = true; clearPreview(); setState(before);
    if (reduced) { setState(result.state); animating = false; return; }
    try {
      if (selected !== null && selected !== undefined) {
        const tile = tiles[selected], start = tile.channel.rotation.y;
        await tween(duration * .22, t => { tile.channel.rotation.y = start + t * Math.PI / 2; tile.root.position.y = Math.sin(t * Math.PI) * .065; });
        tile.root.position.y = 0;
      }
      const paths = result.events.map(event => ({ event, curve: new THREE.CatmullRomCurve3(eventPoints(event)), object: sparkObjects.get(event.id) }));
      for (const { object } of paths) if (object) object.userData.entryCue.visible = false;
      await tween(duration * .58, (t, raw) => {
        for (const { event, curve, object } of paths) {
          if (!object) continue;
          object.position.copy(curve.getPointAt(t));
          if (event.score !== null) object.scale.setScalar(1 + Math.sin(raw * Math.PI) * .35 - Math.max(0, (raw - .87) / .13));
        }
      });
      const counts = new Map(); result.events.forEach(e => { const i = e.from.row * 6 + e.from.col; counts.set(i, (counts.get(i) || 0) + 1); });
      const rotations = [...counts].filter(([, n]) => n % 2).map(([i]) => ({ tile: tiles[i], from: tiles[i].channel.rotation.y }));
      await tween(duration * .2, t => { for (const { tile, from } of rotations) tile.channel.rotation.y = from + Math.PI / 2 * t; });
      setState(result.state);
    } finally { animating = false; }
  }
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let down = null;
  function tileAt(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera); return raycaster.intersectObjects(hitMeshes, false)[0]?.object.userData.index ?? null;
  }
  function move(event) {
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) down.dragged = true;
    const index = tileAt(event);
    if (hovered !== index) { hovered = index; refreshTiles(); onHover(index); }
    renderer.domElement.style.cursor = down?.dragged ? 'grabbing' : index !== null ? 'pointer' : 'grab';
  }
  function pointerDown(event) { down = { x: event.clientX, y: event.clientY, button: event.button, dragged: false }; }
  function pointerUp(event) {
    const previous = down; down = null;
    if (previous && previous.button === 0 && !previous.dragged && !animating) { const index = tileAt(event); if (index !== null) onTile(index); }
  }
  function leave() { hovered = null; refreshTiles(); onHover(null); }
  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointerleave', leave);
  const resize = new ResizeObserver(() => {
    const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }); resize.observe(container);
  let frame = 0;
  function render() { if (dead) return; if (!reduced) dust.rotation.y = Math.sin(performance.now() * .000025) * .06; controls.update(); composer.render(); frame = requestAnimationFrame(render); }
  render();
  return {
    setState, setSelection, setPreview, animateMove, resetCamera,
    setTopView(top) { if (top) positionCamera(0, 15.9 * distance, .01); else resetCamera(); },
    setDistance(value) { distance = value; resetCamera(); },
    getCameraPosition() { return { x: camera.position.x, y: camera.position.y, z: camera.position.z }; },
    setReducedMotion(value) { reduced = Boolean(value); controls.enableDamping = !reduced; },
    getTileScreenPosition(index) { const p = center(Math.floor(index / 6), index % 6); p.y = HEIGHT; p.project(camera); const rect = canvas.getBoundingClientRect(); return { x: rect.left + (p.x + 1) / 2 * rect.width, y: rect.top + (1 - p.y) / 2 * rect.height }; },
    dispose() {
      dead = true; cancelAnimationFrame(frame); resize.disconnect(); controls.dispose();
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointerleave', leave);
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) for (const m of Array.isArray(object.material) ? object.material : [object.material]) { materials.add(m); if (m.map) textures.add(m.map); } });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); composer.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}
