import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './ui/styles.css';
import { App } from './app';

function fail(msg: string) {
  const el = document.getElementById('ui')!;
  el.innerHTML = `<div class="screen boot"><div class="logo">BLOCK<span class="forge">FORGE</span></div><div class="tip" style="color:#ffb3a8;margin-top:30px">${msg}</div></div>`;
}

function start() {
  const app = new App();
  app.boot().catch((e) => {
    console.error(e);
    fail('Something went wrong while starting: ' + (e?.message ?? e));
  });
}

const test = document.createElement('canvas').getContext('webgl2');
// a phone or tablet with no mouse can't aim; say so instead of loading a game it can't control
const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
if (!test) {
  fail('BlockForge needs WebGL 2. Please use a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
} else if (touchOnly) {
  const el = document.getElementById('ui')!;
  el.innerHTML = `<div class="screen boot" style="padding:0 max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px));text-align:center"><div class="logo">BLOCK<span class="forge">FORGE</span></div><div class="tip" style="margin-top:30px;max-width:30em">BlockForge is played with a keyboard and mouse. Open this page on a desktop or laptop computer to play.</div><button class="btn" style="margin-top:24px">Start anyway</button></div>`;
  el.querySelector('button')!.addEventListener('click', () => {
    el.innerHTML = '';
    start();
  });
} else start();
