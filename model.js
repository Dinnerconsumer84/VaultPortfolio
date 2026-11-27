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

  const clock = new THREE.Clock();
  let mixer;

  // model file, next to this script
  new GLTFLoader().load(new URL(SETTINGS.model, import.meta.url).href, (gltf) => {
    const model = gltf.scene;

    // center + frame, measured before pivot rotation applies
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.position.sub(box.getCenter(new THREE.Vector3()));
    camera.position.set(0, 0, size.length() * 1.2 / SETTINGS.zoom);
    camera.lookAt(0, 0, 0);

    pivot.add(model);

    // offset
    pivot.position.set(SETTINGS.position.x * size.y, SETTINGS.position.y * size.y, 0);

    // idle loop
    if (gltf.animations.length) {
      mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();
    }
  });

  // cursor, relative to block center
  const mouse = { x: 0, y: 0 };
  window.addEventListener("mousemove", (e) => {
    const r = container.getBoundingClientRect();
    mouse.x = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    mouse.y = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
  });

  const follow = { x: 0, y: 0 };

  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (mixer) mixer.update(dt);

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
