import * as THREE from 'three';
import { shared, makeNoiseTexture, MAX_POINT_LIGHTS } from './shaderlib';
import { createSkyMesh } from './materials';
import { ShadowSystem } from './shadows';
import { PostFX } from './post';
import { Atmosphere } from './atmosphere';
import { ChunkRenderer, WATER_LAYER, FX_LAYER } from './chunkRenderer';
import { buildTextures } from './textures';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface GraphicsSettings {
  quality: Quality;
  fov: number;
  renderScale: number;
  viewDistance: number;
  shadows: boolean;
  bloom: boolean;
  godRays: boolean;
  ssr: boolean;
  fxaa: boolean;
}

export const QUALITY_PRESETS: Record<Quality, Omit<GraphicsSettings, 'fov' | 'quality'> & { shadowSize: number }> = {
  low: { renderScale: 0.7, viewDistance: 140, shadows: false, bloom: false, godRays: false, ssr: false, fxaa: true, shadowSize: 1024 },
  medium: { renderScale: 0.85, viewDistance: 210, shadows: true, bloom: true, godRays: false, ssr: false, fxaa: true, shadowSize: 1024 },
  high: { renderScale: 1, viewDistance: 270, shadows: true, bloom: true, godRays: true, ssr: true, fxaa: true, shadowSize: 2048 },
  ultra: { renderScale: 1, viewDistance: 340, shadows: true, bloom: true, godRays: true, ssr: true, fxaa: true, shadowSize: 4096 },
};

interface PointLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  radius: number;
  life: number;
  maxLife: number;
}

export class Engine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  skyScene = new THREE.Scene();
  vmScene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  vmCamera: THREE.PerspectiveCamera;
  post = new PostFX();
  shadows: ShadowSystem;
  atmosphere = new Atmosphere();
  chunks: ChunkRenderer | null = null;
  sky = createSkyMesh();
  lights: PointLight[] = [];
  showViewmodel = true;
  baseFov = 78;
  fovScale = 1;
  vmFov = 62;
  settings: GraphicsSettings;
  private shadowSize: number;
  private width = 1;
  private height = 1;
  frameTimeAvg = 16;
  /** effects that should not cast shadows (layer FX) etc. */
  readonly fxLayer = FX_LAYER;

  constructor(public canvas: HTMLCanvasElement, settings: GraphicsSettings) {
    this.settings = { ...settings };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.08, 600);
    this.vmCamera = new THREE.PerspectiveCamera(this.vmFov, 1, 0.01, 10);
    this.camera.layers.set(0);
    buildTextures();
    shared.uNoiseTex.value = makeNoiseTexture(256);
    const preset = QUALITY_PRESETS[settings.quality];
    this.shadowSize = preset.shadowSize;
    this.shadows = new ShadowSystem(this.shadowSize);
    this.skyScene.add(this.sky.mesh);
    this.applySettings(settings);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  applySettings(s: GraphicsSettings) {
    this.settings = { ...s };
    const preset = QUALITY_PRESETS[s.quality];
    if (preset.shadowSize !== this.shadowSize) {
      this.shadowSize = preset.shadowSize;
      this.shadows.build(this.shadowSize, 26, 110);
    }
    this.shadows.enabled = s.shadows;
    this.post.settings.bloom = s.bloom;
    this.post.settings.godRays = s.godRays;
    this.post.settings.fxaa = s.fxaa;
    this.post.settings.renderScale = s.renderScale;
    this.baseFov = s.fov;
    shared.uViewDist.value = s.viewDistance;
    this.camera.far = s.viewDistance + 60;
    this.camera.updateProjectionMatrix();
    if (this.chunks) {
      this.chunks.viewDistance = s.viewDistance;
      this.chunks.waterMat.uniforms.uSSR.value = s.ssr ? 1 : 0;
    }
    this.resize();
  }

  setChunks(c: ChunkRenderer | null) {
    if (this.chunks) this.scene.remove(this.chunks.group);
    this.chunks = c;
    if (c) {
      c.viewDistance = this.settings.viewDistance;
      c.waterMat.uniforms.uSSR.value = this.settings.ssr ? 1 : 0;
      this.scene.add(c.group);
    }
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.post.resize(w, h);
  }

  addLight(pos: THREE.Vector3, color: THREE.Color, radius: number, life: number) {
    this.lights.push({ pos: pos.clone(), color: color.clone(), radius, life, maxLife: life });
  }

  private uploadLights(dt: number) {
    const cam = this.camera.position;
    this.lights = this.lights.filter((l) => (l.life -= dt) > 0);
    const sorted = this.lights
      .map((l) => ({ l, d: l.pos.distanceToSquared(cam) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_POINT_LIGHTS);
    const arr = shared.uPL.value;
    sorted.forEach(({ l }, i) => {
      const f = l.life / l.maxLife;
      arr[i * 2].set(l.pos.x, l.pos.y, l.pos.z, l.radius);
      arr[i * 2 + 1].set(l.color.r * f, l.color.g * f, l.color.b * f, 1);
    });
    shared.uPLCount.value = sorted.length;
  }

  render(dt: number, timeNow: number) {
    const t0 = performance.now();
    const r = this.renderer;
    this.atmosphere.update(dt, this.post);
    shared.uTime.value = timeNow;
    this.post.uniforms.uTime.value = timeNow;
    this.camera.fov = this.baseFov * this.fovScale;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    shared.uCamPos.value.copy(this.camera.position);
    this.uploadLights(dt);
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    if (this.chunks) this.chunks.update(this.camera.position.x, this.camera.position.z, 5);

    // shadows
    this.shadows.update(r, this.scene, this.camera, fwd, this.atmosphere.lightDir);

    // sky
    const post = this.post;
    r.setRenderTarget(post.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    const vp = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.sky.material.uniforms.uInvViewProj.value.copy(vp).invert();
    r.render(this.skyScene, this.camera);

    // opaque world
    this.camera.layers.set(0);
    r.render(this.scene, this.camera);

    // water
    post.copyForWater(r, this.camera.near, this.camera.far);
    if (this.chunks) {
      this.chunks.waterMat.uniforms.uScene.value = post.copyRT.texture;
      this.chunks.waterMat.uniforms.uResolution.value.set(post.width, post.height);
      this.chunks.waterMat.uniforms.uProjMat.value.copy(this.camera.projectionMatrix);
    }
    r.setRenderTarget(post.sceneRT);
    this.camera.layers.set(WATER_LAYER);
    r.render(this.scene, this.camera);
    // transparent effects
    this.camera.layers.set(FX_LAYER);
    r.render(this.scene, this.camera);
    this.camera.layers.set(0);

    // first-person viewmodel
    if (this.showViewmodel && this.vmScene.children.length) {
      r.clearDepth();
      this.vmCamera.position.copy(this.camera.position);
      this.vmCamera.quaternion.copy(this.camera.quaternion);
      this.vmCamera.fov = this.vmFov;
      this.vmCamera.updateProjectionMatrix();
      this.vmCamera.updateMatrixWorld();
      r.render(this.vmScene, this.vmCamera);
    }

    // sun on screen for god rays
    let sunScreen: THREE.Vector3 | null = null;
    let sunVis = 0;
    const sd = this.atmosphere.sunDir;
    const facing = fwd.dot(sd);
    if (facing > 0 && this.atmosphere.sunVisible > 0) {
      sunScreen = this.camera.position.clone().addScaledVector(sd, 500).project(this.camera);
      const off = Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y));
      sunVis = this.atmosphere.sunVisible * Math.min(1, facing * 1.5) * (1 - Math.min(1, Math.max(0, off - 1) * 0.8)) * 0.55;
    }
    post.render(r, sunScreen, sunVis);
    const ft = performance.now() - t0;
    this.frameTimeAvg = this.frameTimeAvg * 0.95 + ft * 0.05;
  }

  /** Render a static frame of any scene to a data URL (used for icons). */
  get size() {
    return { w: this.width, h: this.height };
  }
}
