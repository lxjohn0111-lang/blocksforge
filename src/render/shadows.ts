// Two-cascade sun shadow maps. Cascades are stabilised by snapping their
// centre to whole shadow-map texels in light space, so they don't shimmer.

import * as THREE from 'three';
import { shared } from './shaderlib';

export const SHADOW_LAYER = 1;

interface Cascade {
  rt: THREE.WebGLRenderTarget;
  cam: THREE.OrthographicCamera;
  radius: number;
  size: number;
  matrix: THREE.Matrix4;
}

const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

function dummyDepth() {
  const d = new THREE.DepthTexture(1, 1);
  d.compareFunction = THREE.LessEqualCompare;
  d.needsUpdate = true;
  return d;
}

export class ShadowSystem {
  cascades: Cascade[] = [];
  private dummy = dummyDepth();
  enabled = true;
  private frame = 0;
  private lightView = new THREE.Matrix4();
  private tmp = new THREE.Vector3();

  constructor(size: number, r0 = 26, r1 = 110) {
    this.build(size, r0, r1);
  }

  build(size: number, r0: number, r1: number) {
    for (const c of this.cascades) c.rt.dispose();
    this.cascades = [];
    for (const [i, radius] of [r0, r1].entries()) {
      const s = i === 0 ? size : Math.max(1024, size);
      const depth = new THREE.DepthTexture(s, s);
      depth.type = THREE.UnsignedIntType;
      depth.compareFunction = THREE.LessEqualCompare;
      depth.minFilter = THREE.LinearFilter;
      depth.magFilter = THREE.LinearFilter;
      depth.needsUpdate = true;
      const rt = new THREE.WebGLRenderTarget(s, s, {
        depthTexture: depth,
        depthBuffer: true,
        type: THREE.UnsignedByteType,
        format: THREE.RedFormat,
        generateMipmaps: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, 600);
      cam.layers.set(SHADOW_LAYER);
      this.cascades.push({ rt, cam, radius, size: s, matrix: new THREE.Matrix4() });
    }
    shared.uShadowMap0.value = this.cascades[0].rt.depthTexture;
    shared.uShadowMap1.value = this.cascades[1].rt.depthTexture;
    shared.uShadowParams.value.set(1 / this.cascades[0].size, 1 / this.cascades[1].size, 1, 0);
    shared.uShadowRange.value.set(r0 * 0.92, r1 * 0.92);
  }

  private place(c: Cascade, center: THREE.Vector3, lightDir: THREE.Vector3) {
    // stable light basis
    const up = Math.abs(lightDir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const eye = this.tmp.copy(center).addScaledVector(lightDir, 300);
    this.lightView.lookAt(eye, center, up);
    // snap: express center in light basis (rotation only), round to texel
    const texel = (c.radius * 2) / c.size;
    const inv = this.lightView.clone().transpose(); // rotation inverse
    const lc = center.clone().applyMatrix4(inv);
    lc.x = Math.round(lc.x / texel) * texel;
    lc.y = Math.round(lc.y / texel) * texel;
    const snapped = lc.applyMatrix4(this.lightView);
    c.cam.position.copy(snapped).addScaledVector(lightDir, 300);
    c.cam.up.copy(up);
    c.cam.lookAt(snapped);
    c.cam.updateMatrixWorld(true);
    c.cam.updateProjectionMatrix();
    c.matrix.multiplyMatrices(BIAS, c.cam.projectionMatrix).multiply(c.cam.matrixWorldInverse);
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, forward: THREE.Vector3, lightDir: THREE.Vector3) {
    if (!this.enabled) {
      shared.uShadowsOn.value = 0;
      return;
    }
    shared.uShadowsOn.value = 1;
    this.frame++;
    const camPos = camera.position;
    const fwd = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    for (let i = 0; i < this.cascades.length; i++) {
      const c = this.cascades[i];
      // far cascade updates every other frame to save time
      if (i === 1 && this.frame % 2 === 0) continue;
      const center = camPos.clone().addScaledVector(fwd, c.radius * 0.45);
      this.place(c, center, lightDir);
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(c.rt);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, false);
      // never sample a depth texture while it is the render target
      shared.uShadowMap0.value = this.dummy;
      shared.uShadowMap1.value = this.dummy;
      shared.uShadowPass.value = 1;
      renderer.render(scene, c.cam);
      shared.uShadowPass.value = 0;
      shared.uShadowMap0.value = this.cascades[0].rt.depthTexture;
      shared.uShadowMap1.value = this.cascades[1].rt.depthTexture;
      renderer.setRenderTarget(prevTarget);
    }
    shared.uShadowMat0.value.copy(this.cascades[0].matrix);
    shared.uShadowMat1.value.copy(this.cascades[1].matrix);
  }

  dispose() {
    for (const c of this.cascades) c.rt.dispose();
  }
}
