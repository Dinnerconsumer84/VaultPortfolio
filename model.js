import * as THREE from "https://esm.sh/three@0.170.0";
import { GLTFLoader } from "https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js";
import { EffectComposer } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/ShaderPass.js";

export function createModel(id, SETTINGS) {
  const container = document.getElementById(id);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(SETTINGS.viewSize, SETTINGS.viewSize);

  // float centered on block, click-through
  const view = renderer.domElement;
  view.style.position = "absolute";
  view.style.left = "50%";
  view.style.top = "50%";
  view.style.transform = "translate(-50%, -50%)";
  view.style.pointerEvents = "none";
  container.appendChild(view);

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

  // cursor, relative to block center
  const mouse = { x: 0, y: 0 };
  window.addEventListener("mousemove", (e) => {
    const r = container.getBoundingClientRect();
    mouse.x = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    mouse.y = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
  });

  // flinch on click: opt-in via SETTINGS.flinch (true or { angle, push, side, snap, stiffness, damping })
  // snap = seconds for the hit to push out; stiffness/damping = the spring back to rest
  const FL = SETTINGS.flinch
    ? { angle: 14, push: 0.12, side: 0.08, snap: 0.05, stiffness: 160, damping: 11, ...(SETTINGS.flinch === true ? {} : SETTINGS.flinch) }
    : null;
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
      flinchGroup.rotation.set(spring.rx[0], spring.ry[0], 0);
      flinchGroup.position.set(spring.px[0], spring.py[0], spring.pz[0]).multiplyScalar(modelHeight);
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
    view.style.transform = `translate(calc(-50% + ${follow.x}px), calc(-50% + ${follow.y}px))`;

    composer.render(dt);
  });
}
