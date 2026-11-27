import * as THREE from "https://esm.sh/three@0.170.0";
import { GLTFLoader } from "https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/ShaderPass.js";

// ---- flying sparks, shared by all models on the page (every model reads them to get lit) ----
// they live on the page, not in a canvas, so they can cross the whole screen
const sparks = [];
const SPARK_GLOW_TIME = 0.8; // s, glow fades to a plain spark over this
const WHITE = new THREE.Color("#ffffff");
const rand = (a, b) => a + Math.random() * (b - a);
let sparkLoop = 0;

// cfg: particleTexture url, particleColors, particleCount, particleSize, particleSpeed, particleGravity, layer
function spawnSparks(x, y, away, cfg) {
  const [lo, hi] = cfg.particleCount;
  const count = Math.floor(rand(lo, hi + 1));
  for (let i = 0; i < count; i++) {
    const base = new THREE.Color(cfg.particleColors[Math.floor(Math.random() * cfg.particleColors.length)]);
    // glow color: own color, black glows white (black light would be nothing)
    const glow = base.getHex() === 0 ? WHITE.clone() : base.clone();
    const s = cfg.particleSize * rand(0.7, 1.3);
    // outer: position + glow (filter must sit outside the mask or the mask cuts the glow off); inner: tinted texture
    const el = document.createElement("div");
    const inner = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed", left: "0", top: "0", width: `${s}px`, height: `${s}px`,
      pointerEvents: "none", zIndex: 101 + cfg.layer, willChange: "transform, filter",
    });
    Object.assign(inner.style, {
      width: "100%", height: "100%",
      maskImage: cfg.particleTexture, webkitMaskImage: cfg.particleTexture,
      maskSize: "contain", webkitMaskSize: "contain",
      maskRepeat: "no-repeat", webkitMaskRepeat: "no-repeat",
      maskPosition: "center", webkitMaskPosition: "center",
    });
    el.appendChild(inner);
    document.body.appendChild(el);
    const a = away + rand(-0.9, 0.9); // spread around the throw direction
    const v = rand(...cfg.particleSpeed);
    sparks.push({
      el, inner, s, x, y, base, glow, age: 0, g: 1, gravity: cfg.particleGravity,
      rot: rand(0, 360), spin: rand(-720, 720),
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - rand(150, 350), // slight upward pop before falling
    });
  }
  if (!sparkLoop) {
    let last = performance.now();
    const tick = (now) => {
      updateSparks(THREE.MathUtils.clamp((now - last) / 1000, 0, 1 / 30));
      last = now;
      sparkLoop = sparks.length ? requestAnimationFrame(tick) : 0;
    };
    sparkLoop = requestAnimationFrame(tick);
  }
}

const tmpColor = new THREE.Color();
function updateSparks(h) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.age += h;
    p.vy += p.gravity * h;
    p.x += p.vx * h;
    p.y += p.vy * h;
    p.rot += p.spin * h;
    // gone once below the screen or off either side (above the top is fine, gravity brings it back)
    if (p.y - p.s > window.innerHeight || p.x + p.s < 0 || p.x - p.s > window.innerWidth) {
      p.el.remove();
      sparks.splice(i, 1);
      continue;
    }
    // glow: starts hot (glow color, mixed toward white), cools to its own color, halo shrinks away
    p.g = Math.max(0, 1 - p.age / SPARK_GLOW_TIME);
    const g = p.g * p.g;
    tmpColor.copy(p.base).lerp(p.glow.clone().lerp(WHITE, 0.5), g);
    p.inner.style.backgroundColor = `#${tmpColor.getHexString()}`;
    p.el.style.filter = g > 0.01
      ? `drop-shadow(0 0 ${(p.s * 0.3 * g).toFixed(1)}px #ffffff) drop-shadow(0 0 ${(p.s * 0.8 * g).toFixed(1)}px #${p.glow.getHexString()}) drop-shadow(0 0 ${(p.s * 1.2 * g).toFixed(1)}px #${p.glow.getHexString()})`
      : "none";
    p.el.style.transform = `translate(${p.x - p.s / 2}px, ${p.y - p.s / 2}px) rotate(${p.rot}deg)`;
  }
}

export function createModel(id, SETTINGS) {
  const container = document.getElementById(id);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(SETTINGS.viewSize, SETTINGS.viewSize);

  // dock on scroll: opt-in via SETTINGS.dock (true or { visible })
  // visible = share of the head showing at the top once docked
  const DK = SETTINGS.dock
    ? { visible: 0.33, ...(SETTINGS.dock === true ? {} : SETTINGS.dock) }
    : null;

  // float centered on block, click-through
  const view = renderer.domElement;
  view.style.pointerEvents = "none";
  if (DK) {
    // pinned to the screen, outside any section, so it can travel across sections
    view.style.position = "fixed";
    view.style.left = "0";
    view.style.top = "0";
    view.style.zIndex = 100 + SETTINGS.layer;
    view.style.willChange = "transform";
    document.body.appendChild(view);
  } else {
    view.style.position = "absolute";
    view.style.left = "50%";
    view.style.top = "50%";
    view.style.transform = "translate(-50%, -50%)";
    container.appendChild(view);
  }

  // layer among models
  container.closest(".fe-block").style.setProperty("z-index", 100 + SETTINGS.layer, "important");

  // filter, from header
  const F = window.FILTER;
  const dpr = renderer.getPixelRatio();
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.setSize(SETTINGS.viewSize, SETTINGS.viewSize);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(SETTINGS.viewSize * dpr, SETTINGS.viewSize * dpr) },
      pixelSize: { value: F.pixelSize * dpr },
      levels: { value: F.levels },
      shadowsOnly: { value: F.shadowsOnly ? 1 : 0 },
      threshold: { value: F.threshold },
    },
    vertexShader: F.vertexShader,
    fragmentShader: F.fragmentShader,
  }));

  // lights, from header preset
  for (const s of Object.values(window.LIGHTING[SETTINGS.lighting])) {
    if (!s.on) continue;
    const light = new THREE.DirectionalLight(s.color, s.strength);
    light.position.set(...s.position);
    scene.add(light);
  }

  const pivot = new THREE.Group();
  scene.add(pivot);

  // flinch layer, sits inside pivot so it stacks on top of the look rotation
  const flinchGroup = new THREE.Group();
  pivot.add(flinchGroup);

  const clock = new THREE.Clock();
  let mixer, idleAction, flinchAction;
  let model;
  let modelHeight = 1;
  let headPx = 0; // head height on screen in px, for docking

  // model file, next to this script
  new GLTFLoader().load(new URL(SETTINGS.model, import.meta.url).href, (gltf) => {
    model = gltf.scene;

    // center + frame, measured before pivot rotation applies
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    modelHeight = size.y;
    model.position.sub(box.getCenter(new THREE.Vector3()));
    camera.position.set(0, 0, size.length() * 1.2 / SETTINGS.zoom);
    camera.lookAt(0, 0, 0);

    flinchGroup.add(model);

    // offset
    pivot.position.set(SETTINGS.position.x * size.y, SETTINGS.position.y * size.y, 0);

    // px per world unit at the head's depth, for docking
    const worldPx = SETTINGS.viewSize / (2 * camera.position.z * Math.tan((camera.fov / 2) * Math.PI / 180));
    headPx = size.y * worldPx;
    headOffsetPx.x = pivot.position.x * worldPx;
    headOffsetPx.y = pivot.position.y * worldPx;

    // idle loop, plus optional one-shot "flinch" clip
    const clips = gltf.animations;
    if (clips.length) {
      mixer = new THREE.AnimationMixer(model);
      const flinchClip = THREE.AnimationClip.findByName(clips, "flinch");
      const idleClip = THREE.AnimationClip.findByName(clips, "head-idle") ?? clips.find((c) => c !== flinchClip);
      if (idleClip) idleAction = mixer.clipAction(idleClip).play();
      if (flinchClip) {
        flinchAction = mixer.clipAction(flinchClip);
        flinchAction.setLoop(THREE.LoopOnce, 1);
        flinchAction.clampWhenFinished = true; // hold last frame while fading back
        mixer.addEventListener("finished", (e) => {
          if (e.action === flinchAction && idleAction) {
            idleAction.enabled = true; // three.js disables an action once it has faded out to 0
            idleAction.crossFadeFrom(flinchAction, 0.25, false);
          }
        });
      }
    }
  });

  // cursor in screen px; turned into an offset from the head every frame, so scrolling updates the look too
  const cursor = { x: null, y: null };
  window.addEventListener("mousemove", (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  });
  const mouse = { x: 0, y: 0 };
  const headOffsetPx = { x: 0, y: 0 }; // SETTINGS.position on screen, px (up = +y)
  // flinch on click: opt-in via SETTINGS.flinch (true or { angle, push, side, snap, stiffness, damping })
  // snap = seconds for the hit to push out; stiffness/damping = the spring back to rest
  const FL = SETTINGS.flinch
    ? {
        angle: 14, push: 0.12, side: 0.08, snap: 0.05, stiffness: 160, damping: 11,
        sparkColor: "#ffd6dc", sparkStrength: 60, sparkTime: 0.12, // light flash at the hit point
        // flying sparks: white texture tinted with a random color, thrown out from the hit, falling with gravity
        particleTexture: "spark_texture.png", particleColors: ["#2B21B8", "#C92222", "#000000"],
        particleCount: [2, 4], particleSize: 16, particleSpeed: [350, 650], particleGravity: 1800,
        ...(SETTINGS.flinch === true ? {} : SETTINGS.flinch),
      }
    : null;
  // spark: one point light, dark until a hit (created up front so the first click doesn't stall on a shader rebuild)
  const spark = FL ? new THREE.PointLight(FL.sparkColor, 0, 0, 2) : null;
  if (spark) flinchGroup.add(spark);
  let sparkT = Infinity;

  const sparkCfg = FL && {
    ...FL, layer: SETTINGS.layer,
    particleTexture: `url("${new URL(FL.particleTexture, import.meta.url).href}")`,
  };
  function spawnParticles(x, y) {
    // throw direction: away from the head's center, through the hit point
    const r = view.getBoundingClientRect();
    const away = Math.atan2(y - (r.top + r.height / 2 - headOffsetPx.y), x - (r.left + r.width / 2 + headOffsetPx.x));
    spawnSparks(x, y, away, sparkCfg);
  }

  // spark light: a few pooled point lights that follow the glowing sparks nearest this model
  // (pooled up front so a click never triggers a shader rebuild)
  const SPARK_LIGHTS = 4;
  const sparkLightStrength = SETTINGS.sparkLight ?? 10; // 0 = this model ignores spark light
  const sparkLights = [];
  for (let i = 0; i < (sparkLightStrength ? SPARK_LIGHTS : 0); i++) {
    const l = new THREE.PointLight(0xffffff, 0, 0, 2);
    scene.add(l);
    sparkLights.push(l);
  }
  const rayDir = new THREE.Vector3();
  function updateSparkLights(r) {
    if (!sparkLights.length) return;
    // glowing sparks, nearest to this canvas first
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const near = sparks
      .filter((p) => p.g > 0)
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
    const zFront = modelHeight * 0.4; // a bit in front of the model so it lights the visible side
    for (let i = 0; i < sparkLights.length; i++) {
      const l = sparkLights[i];
      const p = near[i];
      if (!p) { l.intensity = 0; continue; }
      // screen point -> ray through this camera -> plane just in front of the model
      rayDir.set(((p.x - r.left) / r.width) * 2 - 1, -((p.y - r.top) / r.height) * 2 + 1, 0.5)
        .unproject(camera).sub(camera.position).normalize();
      l.position.copy(camera.position).addScaledVector(rayDir, (zFront - camera.position.z) / rayDir.z);
      l.color.copy(p.glow);
      l.intensity = sparkLightStrength * (modelHeight * 0.1) ** 2 * p.g * p.g;
    }
  }
  // damped springs [value, velocity]: tilt x/y (radians), knockback x/y/z (model heights)
  const spring = { rx: [0, 0], ry: [0, 0], px: [0, 0], py: [0, 0], pz: [0, 0] };
  // push-out phase: each spring eases from its value at click time to start + kick
  const snap = { t: Infinity, from: {}, kick: {} };
  // scale kicks to the peak the spring alone would reach, so distances match the angle/push/side tuning before snap existed
  const peakScale = FL ? (() => {
    const w = Math.sqrt(FL.stiffness);
    const z = Math.min(FL.damping / (2 * w), 0.999);
    const r = Math.sqrt(1 - z * z);
    return Math.exp(-(z / r) * Math.atan2(r, z));
  })() : 1;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  // canvas is click-through, so listen on window and raycast against the model
  if (FL) window.addEventListener("pointerdown", (e) => {
    if (!model) return;
    const r = view.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(model, true)[0];
    if (!hit) return;

    // where it was hit, relative to the head center (-1..1)
    const p = pivot.worldToLocal(hit.point.clone());
    const hx = THREE.MathUtils.clamp(p.x / (modelHeight / 2), -1, 1);
    const hy = THREE.MathUtils.clamp(p.y / (modelHeight / 2), -1, 1);

    // hit side recoils away; knockback goes back from the camera and away from the cursor (click right -> back left)
    const a = FL.angle * Math.PI / 180;
    const kick = { rx: -hy * a, ry: hx * a, px: -hx * FL.side, py: -hy * FL.side, pz: -FL.push };
    for (const key in spring) {
      snap.from[key] = spring[key][0];
      snap.kick[key] = kick[key] * peakScale;
    }
    snap.t = 0;

    // spark just off the surface at the hit, riding along with the head
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 0, 1);
    spark.position.copy(flinchGroup.worldToLocal(hit.point.clone().addScaledVector(n, modelHeight * 0.08)));
    sparkT = 0;
    spawnParticles(e.clientX, e.clientY);

    // baked "flinch" clip takes over from the idle, then hands back
    if (flinchAction) {
      flinchAction.reset().setEffectiveWeight(1).play();
      if (idleAction) flinchAction.crossFadeFrom(idleAction, 0.1, false);
    }
  });

  const follow = { x: 0, y: 0 };

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);

    // flinch springs (dt clamped so a background tab doesn't explode them)
    if (FL) {
      const h = Math.min(dt, 1 / 30);
      const snapTime = Math.max(FL.snap, 0.001); // snap: 0 = instant
      if (snap.t < snapTime) {
        // push out: fast ease-out to the knocked position, ends at rest so the return spring takes over from the peak
        snap.t = Math.min(snap.t + h, snapTime);
        const u = 1 - Math.pow(1 - snap.t / snapTime, 3);
        for (const key in spring) spring[key] = [snap.from[key] + snap.kick[key] * u, 0];
      } else {
        // return: spring back to rest
        for (const s of Object.values(spring)) {
          s[1] += (-FL.stiffness * s[0] - FL.damping * s[1]) * h;
          s[0] += s[1] * h;
        }
      }
      // spark: instant flash, fades out over sparkTime (strength scaled to model size so it reads the same on any model)
      sparkT += dt;
      const f = Math.max(0, 1 - sparkT / FL.sparkTime);
      spark.intensity = FL.sparkStrength * (modelHeight * 0.08) ** 2 * f * f;

      flinchGroup.rotation.set(spring.rx[0], spring.ry[0], 0);
      flinchGroup.position.set(spring.px[0], spring.py[0], spring.pz[0]).multiplyScalar(modelHeight);
    }

    // canvas center on screen: in the block, or eased toward the top-center dock as you scroll
    const cr = container.getBoundingClientRect();
    let cx = cr.left + cr.width / 2;
    let cy = cr.top + cr.height / 2;
    if (DK) {
      // rides up with the page until it reaches the dock, then stays there; scrolling back up reverses it
      // docked: head centered horizontally, only `visible` of it below the top edge
      const dockX = window.innerWidth / 2 - headOffsetPx.x;
      const dockY = headPx * (DK.visible - 0.5) + headOffsetPx.y;
      const restY = cy + window.scrollY; // where it sits with the page at the top
      const q = restY > dockY ? THREE.MathUtils.clamp(window.scrollY / (restY - dockY), 0, 1) : 1;
      cx += (dockX - cx) * q; // slides to center while rising
      cy = Math.max(cy, dockY);
    }

    // cursor relative to the head
    if (cursor.x !== null) {
      mouse.x = (cursor.x - (cx + headOffsetPx.x)) / (window.innerWidth / 2);
      mouse.y = (cursor.y - (cy - headOffsetPx.y)) / (window.innerHeight / 2);
    }

    // look, from header preset
    const lk = window.LOOK[SETTINGS.look];
    const deg = Math.PI / 180;
    const ex = Math.tanh(mouse.x * lk.falloff);
    const ey = Math.tanh(mouse.y * lk.falloff);
    const yaw = ex * lk.maxSide * deg;
    const pitch = ey < 0 ? ey * lk.maxUp * deg : ey * lk.maxDown * deg;
    const k = 1 - Math.exp(-lk.smoothing * dt);
    pivot.rotation.y += (yaw - pivot.rotation.y) * k;
    pivot.rotation.x += (pitch - pivot.rotation.x) * k;

    // move toward cursor
    follow.x += (ex * lk.mouse_following_distance - follow.x) * k;
    follow.y += (ey * lk.mouse_following_distance - follow.y) * k;
    view.style.transform = DK
      ? `translate(${cx - SETTINGS.viewSize / 2 + follow.x}px, ${cy - SETTINGS.viewSize / 2 + follow.y}px)`
      : `translate(calc(-50% + ${follow.x}px), calc(-50% + ${follow.y}px))`;

    updateSparkLights(view.getBoundingClientRect());
    composer.render(dt);
  });
}
