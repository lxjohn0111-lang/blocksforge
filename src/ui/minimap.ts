import { BLOCKS, B, RENDER } from '../world/blocks';
import type { VoxelWorld } from '../world/world';
import type { MapData } from '../world/maps/builder';

const cache = new WeakMap<VoxelWorld, HTMLCanvasElement>();

/** Hill-shaded top-down render of a world (cached). */
export function terrainImage(w: VoxelWorld): HTMLCanvasElement {
  const hit = cache.get(w);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w.sx;
  c.height = w.sz;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w.sx, w.sz);
  const top = new Int16Array(w.sx * w.sz);
  const topId = new Uint8Array(w.sx * w.sz);
  for (let z = 0; z < w.sz; z++)
    for (let x = 0; x < w.sx; x++) {
      let y = w.heights[z * w.sx + x];
      let id = y >= 0 ? w.getRaw(x, y, z) : B.STONE;
      // look through leaves a little so canopies read as forest
      top[z * w.sx + x] = y;
      topId[z * w.sx + x] = id;
      void RENDER;
    }
  for (let z = 0; z < w.sz; z++)
    for (let x = 0; x < w.sx; x++) {
      const i = z * w.sx + x;
      const id = topId[i];
      let [r, gg, b] = BLOCKS[id]?.color ?? [100, 100, 100];
      const y = top[i];
      const hn = top[Math.max(0, z - 1) * w.sx + Math.max(0, x - 1)];
      let shade = 1 + (y - hn) * 0.09;
      shade = Math.max(0.6, Math.min(1.35, shade));
      if (id === B.WATER) {
        // depth tint
        let d = 0;
        while (d < 8 && w.getRaw(x, y - d - 1, z) === B.WATER) d++;
        const k = Math.min(1, d / 7);
        r = 60 - 30 * k;
        gg = 110 - 40 * k;
        b = 170 - 30 * k;
        shade = 1;
      }
      const hb = 0.85 + (y / w.sy) * 0.35;
      img.data[i * 4] = Math.min(255, r * shade * hb);
      img.data[i * 4 + 1] = Math.min(255, gg * shade * hb);
      img.data[i * 4 + 2] = Math.min(255, b * shade * hb);
      img.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  cache.set(w, c);
  return c;
}

export function invalidateTerrainImage(w: VoxelWorld) {
  cache.delete(w);
}

export interface MapOverlay {
  px: number;
  pz: number;
  yaw: number;
  zone?: { cx: number; cz: number; r: number; nx: number; nz: number; nr: number } | null;
  friends: { x: number; z: number; yaw: number }[];
  pings: { x: number; z: number; age: number }[];
  path?: { x0: number; z0: number; x1: number; z1: number; t: number } | null;
  dropTarget?: { x: number; z: number } | null;
}

export function drawMap(ctx: CanvasRenderingContext2D, w: VoxelWorld, map: MapData, o: MapOverlay, size: number, viewRadius: number | null, labels: boolean) {
  const img = terrainImage(w);
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#163050';
  ctx.fillRect(0, 0, size, size);
  let scale: number, ox: number, oz: number;
  if (viewRadius) {
    scale = size / (viewRadius * 2);
    ox = o.px - viewRadius;
    oz = o.pz - viewRadius;
  } else {
    const m = Math.max(w.sx, w.sz);
    scale = size / m;
    ox = -(m - w.sx) / 2;
    oz = -(m - w.sz) / 2;
  }
  const tx = (x: number) => (x - ox) * scale;
  const tz = (z: number) => (z - oz) * scale;
  ctx.imageSmoothingEnabled = !viewRadius;
  ctx.drawImage(img, tx(0), tz(0), w.sx * scale, w.sz * scale);
  // grid
  if (!viewRadius) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    const step = w.sx > 200 ? 40 : 16;
    for (let x = 0; x <= w.sx; x += step) {
      ctx.beginPath();
      ctx.moveTo(tx(x), tz(0));
      ctx.lineTo(tx(x), tz(w.sz));
      ctx.stroke();
    }
    for (let z = 0; z <= w.sz; z += step) {
      ctx.beginPath();
      ctx.moveTo(tx(0), tz(z));
      ctx.lineTo(tx(w.sx), tz(z));
      ctx.stroke();
    }
  }
  // zone
  if (o.zone) {
    const z = o.zone;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(tx(z.cx), tz(z.cz), z.r * scale, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(120,40,200,0.32)';
    ctx.fill('evenodd');
    ctx.restore();
    ctx.strokeStyle = '#c99bff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx(z.cx), tz(z.cz), z.r * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(tx(z.nx), tz(z.nz), z.nr * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.path) {
    const p = o.path;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tx(p.x0), tz(p.z0));
    ctx.lineTo(tx(p.x1), tz(p.z1));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.dropTarget) {
    ctx.fillStyle = '#f2a93b';
    ctx.beginPath();
    ctx.arc(tx(o.dropTarget.x), tz(o.dropTarget.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (labels) {
    ctx.font = `600 ${Math.max(10, size / 70)}px "Chakra Petch", sans-serif`;
    ctx.textAlign = 'center';
    for (const l of map.landmarks) {
      const x = tx(l.x), y = tz(l.z);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const t = l.major ? l.name.toUpperCase() : l.name;
      ctx.fillText(t, x + 1, y + 1);
      ctx.fillStyle = l.major ? '#ffffff' : 'rgba(255,255,255,0.75)';
      ctx.fillText(t, x, y);
    }
  }
  // pings
  for (const p of o.pings) {
    const a = Math.max(0, 1 - p.age / 4);
    ctx.strokeStyle = `rgba(255,80,60,${a})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tx(p.x), tz(p.z), (4 + p.age * 3) * (viewRadius ? size / 196 : 1), 0, Math.PI * 2);
    ctx.stroke();
  }
  // markers scale with the canvas so they stay readable however small the minimap is shown
  const u = viewRadius ? size / 196 : size / 450;
  for (const f of o.friends) {
    ctx.fillStyle = '#4aa8ff';
    ctx.strokeStyle = '#06121f';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(tx(f.x), tz(f.z), 4.5 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // player: view cone + bold outlined arrow
  ctx.save();
  ctx.translate(tx(o.px), tz(o.pz));
  ctx.rotate(-o.yaw);
  const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, 46 * u);
  cone.addColorStop(0, 'rgba(255,214,140,0.38)');
  cone.addColorStop(1, 'rgba(255,214,140,0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 46 * u, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffb52e';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.2 * u;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -11 * u);
  ctx.lineTo(8 * u, 8 * u);
  ctx.lineTo(0, 4 * u);
  ctx.lineTo(-8 * u, 8 * u);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 4 * u;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}
