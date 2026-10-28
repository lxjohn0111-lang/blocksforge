// Lucky Wheel: a free spin every 10 minutes, another one any time for a rewarded ad. Prizes are
// coins, an epic camo, an XP boost, the Lucky Ace outfit or nothing; the odds are listed under it.

import { h } from './dom';
import { ICON } from './icons';
import { audio } from '../audio/audio';
import { fmtDuration } from '../core/mathx';
import { WHEEL, type Meta, type Reward } from '../meta/meta';
import { adButton } from './adui';
import { showReveal } from './menu';

const N = WHEEL.length;
const SLICE = 360 / N;
const R = 170;

const TONES: Record<(typeof WHEEL)[number]['tone'], { a: string; b: string; text: string }> = {
  coins: { a: '#2a2008', b: '#6a4f12', text: '#ffd25a' },
  none: { a: '#14171d', b: '#262b35', text: '#8a94a3' },
  epic: { a: '#230b3d', b: '#6a2aa8', text: '#f0d8ff' },
  boost: { a: '#06223d', b: '#1a6ab0', text: '#cfeaff' },
  legendary: { a: '#3d1404', b: '#d0621a', text: '#ffe2b8' },
  jackpot: { a: '#7a5208', b: '#ffcf4a', text: '#1a1205' },
};

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)].map((v) => v.toFixed(2)).join(' ');
}

function sliceIcon(tone: string) {
  if (tone === 'coins' || tone === 'jackpot') return ICON.coin(22);
  if (tone === 'none') return ICON.close(20);
  if (tone === 'epic') return ICON.star(20);
  if (tone === 'boost') return ICON.xp(22);
  return ICON.trophy(20);
}

function wheelSvg() {
  let defs = '';
  let slices = '';
  WHEEL.forEach((s, i) => {
    const t = TONES[s.tone];
    const a0 = i * SLICE - SLICE / 2;
    const a1 = i * SLICE + SLICE / 2;
    defs += `<radialGradient id="wg${i}" cx="0" cy="0" r="${R}" gradientUnits="userSpaceOnUse"><stop offset="0.15" stop-color="${t.a}"/><stop offset="1" stop-color="${t.b}"/></radialGradient>`;
    slices += `<path d="M0 0 L${polar(R, a0)} A${R} ${R} 0 0 1 ${polar(R, a1)} Z" fill="url(#wg${i})" stroke="#0a0c10" stroke-width="2"/>`;
    // icon at the rim, the label along the radius (reading outwards, never upside down)
    slices += `<g transform="rotate(${i * SLICE})"><g transform="translate(-11 ${-R + 14})" color="${t.text}">${sliceIcon(s.tone)}</g>`;
    slices += `<text transform="translate(0 ${-R * 0.55}) rotate(${i * SLICE > 180 ? 90 : -90})" text-anchor="middle" dominant-baseline="central" fill="${t.text}" class="wl">${s.short}</text></g>`;
  });
  let leds = '';
  for (let i = 0; i < 20; i++) leds += `<circle class="led ${i % 2 ? 'odd' : 'even'}" cx="${polar(R + 15, i * 18).split(' ')[0]}" cy="${polar(R + 15, i * 18).split(' ')[1]}" r="4.2"/>`;
  return `<svg viewBox="-200 -200 400 400" class="wheel-svg">
    <defs>${defs}
      <linearGradient id="wrim" x1="0" y1="-1" x2="0" y2="1"><stop offset="0" stop-color="#ffe9a8"/><stop offset="0.5" stop-color="#c8891e"/><stop offset="1" stop-color="#6a4208"/></linearGradient>
      <radialGradient id="whub" cx="0" cy="-8" r="46" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffe9a8"/><stop offset="0.6" stop-color="#d89a2a"/><stop offset="1" stop-color="#7a4a0a"/></radialGradient>
    </defs>
    <circle r="${R + 24}" fill="#0b0d12"/>
    <circle r="${R + 15}" fill="none" stroke="url(#wrim)" stroke-width="18"/>
    ${leds}
    <g class="rotor">${slices}<path class="winglow" d="" fill="#fff"/></g>
    <circle r="${R}" fill="none" stroke="#0a0c10" stroke-width="3"/>
    <circle r="44" fill="url(#whub)" stroke="#2a1a04" stroke-width="3"/>
    <circle r="34" fill="#14110a"/>
    <text class="hubtxt" x="0" y="7" text-anchor="middle">SPIN</text>
    <g class="pointer"><path d="M0 ${-R + 18} L-17 ${-R - 26} L17 ${-R - 26} Z" fill="url(#wrim)" stroke="#2a1a04" stroke-width="3"/><circle cx="0" cy="${-R - 22}" r="6" fill="#fff6d8"/></g>
  </svg>`;
}

function confetti(host: HTMLElement, gold: boolean) {
  const colors = gold ? ['#ffd25a', '#fff2b8', '#f2a93b', '#ffffff'] : ['#ffd25a', '#4aa8ff', '#c77dff', '#5be37d', '#ff6a5a', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const c = h('i', { class: 'confetti' });
    const ang = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * 320;
    c.style.setProperty('--x', `${Math.cos(ang) * dist}px`);
    c.style.setProperty('--y', `${Math.sin(ang) * dist - 120}px`);
    c.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.12}s`;
    host.appendChild(c);
    setTimeout(() => c.remove(), 1900);
  }
}

/** open the wheel; `onClose` runs when it is closed (to refresh coins etc.) */
export function openWheel(parent: HTMLElement, meta: Meta, onClose: () => void) {
  let angle = 0;
  let spinning = false;
  let kick = 0;
  const svgHost = h('div', { class: 'wheel', html: wheelSvg() });
  const rotor = svgHost.querySelector('.rotor') as SVGGElement;
  const glow = svgHost.querySelector('.winglow') as SVGPathElement;
  const hub = svgHost.querySelector('.hubtxt') as SVGTextElement;
  const pointer = svgHost.querySelector('.pointer') as SVGGElement;
  const fx = h('div', { class: 'wheel-fx' });
  const result = h('div', { class: 'wheel-result' });
  const actions = h('div', { class: 'wheel-actions' });
  const total = WHEEL.reduce((a, b) => a + b.w, 0);
  const odds = h('div', { class: 'wheel-odds' }, 'Odds: ', ...WHEEL.filter((s, i) => WHEEL.findIndex((x) => x.label === s.label) === i).map((s) => {
    const w = WHEEL.filter((x) => x.label === s.label).reduce((a, b) => a + b.w, 0);
    return h('span', null, `${s.label} ${Math.round((w / total) * 1000) / 10}%`);
  }));
  const close = () => {
    if (spinning) return;
    clearInterval(timer);
    modal.remove();
    onClose();
  };
  const modal = h('div', { class: 'wheel-modal', onclick: (e: MouseEvent) => { if (e.target === modal) close(); } },
    h('div', { class: 'wheel-rays' }),
    h('div', { class: 'wheel-box' },
      h('button', { class: 'iconbtn wheel-close', title: 'Close', html: ICON.close(18), onclick: close }),
      h('div', { class: 'wheel-title' }, 'LUCKY', h('b', null, 'WHEEL')),
      h('div', { class: 'wheel-stage' }, svgHost, fx),
      result,
      actions,
      odds));
  parent.appendChild(modal);

  const setRotor = () => rotor.setAttribute('transform', `rotate(${angle})`);

  const spin = (free: boolean) => {
    if (spinning) return;
    const res = meta.spinWheel(free);
    if (!res) return;
    spinning = true;
    modal.classList.add('spinning');
    glow.setAttribute('d', '');
    result.textContent = '';
    result.className = 'wheel-result';
    renderActions();
    audio.ui('go', 0.6);
    const jitter = (Math.random() - 0.5) * SLICE * 0.7;
    const base = ((-(res.index * SLICE) - angle) % 360 + 360) % 360;
    const from = angle;
    const to = angle + 360 * 6 + base + jitter;
    const dur = 5200;
    const t0 = performance.now();
    let lastSlice = Math.floor((((-from % 360) + 360 + SLICE / 2) % 360) / SLICE);
    const frame = () => {
      const t = Math.min(1, (performance.now() - t0) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      angle = from + (to - from) * e;
      setRotor();
      const sl = Math.floor((((-angle % 360) + 360 + SLICE / 2) % 360) / SLICE);
      if (sl !== lastSlice) {
        lastSlice = sl;
        audio.ui('hitmarker', 0.22);
        // the flapper ticks back on every slice edge
        pointer.setAttribute('transform', `rotate(-14 0 ${-R - 22})`);
        clearTimeout(kick);
        kick = window.setTimeout(() => pointer.setAttribute('transform', ''), 70);
      }
      if (t < 1) requestAnimationFrame(frame);
      else done(res.index, res.reward);
    };
    requestAnimationFrame(frame);
  };

  const done = (index: number, reward: Reward | null) => {
    spinning = false;
    modal.classList.remove('spinning');
    angle %= 360;
    setRotor();
    const a0 = index * SLICE - SLICE / 2;
    const a1 = index * SLICE + SLICE / 2;
    glow.setAttribute('d', `M0 0 L${polar(R, a0)} A${R} ${R} 0 0 1 ${polar(R, a1)} Z`);
    const sl = WHEEL[index];
    if (!reward) {
      audio.ui('deny', 0.7);
      result.className = 'wheel-result miss';
      result.textContent = 'So close! Spin again';
    } else {
      const big = sl.tone === 'jackpot' || sl.tone === 'legendary';
      audio.ui(big ? 'victory' : 'reward', 0.85);
      result.className = `wheel-result win ${sl.tone}`;
      result.textContent = big ? `JACKPOT! ${reward.label}` : `You won ${reward.label}!`;
      confetti(fx, big || sl.tone === 'coins');
      if (reward.kind === 'cosmetic') setTimeout(() => showReveal(parent, 'Lucky Wheel', 'New item', [reward]), 900);
    }
    renderActions();
  };

  const renderActions = () => {
    actions.textContent = '';
    const left = meta.wheelReadyIn();
    hub.textContent = left > 0 ? 'LUCKY' : 'SPIN';
    svgHost.classList.toggle('ready', left === 0 && !spinning);
    if (spinning) {
      actions.appendChild(h('div', { class: 'wheel-wait' }, 'Good luck…'));
      return;
    }
    if (left === 0) {
      actions.appendChild(h('button', { class: 'btn primary big wheel-spin', onclick: () => spin(true) }, h('span', { html: ICON.refresh(18) }), 'Spin free'));
    } else {
      actions.appendChild(h('div', { class: 'wheel-wait' }, h('span', { html: ICON.clock(14) }), `Free spin in ${fmtDuration(left)}`));
      const ad = adButton({ label: 'Spin now', sub: 'Watch an ad, spin again', big: true, tone: 'gold', onReward: () => spin(false) });
      if (ad) actions.appendChild(ad);
    }
  };
  // the countdown, and the free spin lighting up when it is due
  let wasReady = meta.wheelReadyIn() === 0;
  const timer = window.setInterval(() => {
    if (!modal.isConnected) return clearInterval(timer);
    if (spinning) return;
    const ready = meta.wheelReadyIn() === 0;
    const wait = actions.querySelector('.wheel-wait');
    if (ready !== wasReady || (!ready && !wait)) renderActions();
    else if (wait && !ready) wait.lastChild!.textContent = `Free spin in ${fmtDuration(meta.wheelReadyIn())}`;
    wasReady = ready;
  }, 1000);
  setRotor();
  renderActions();
  hub.addEventListener('click', () => meta.wheelReadyIn() === 0 && spin(true));
  return modal;
}
