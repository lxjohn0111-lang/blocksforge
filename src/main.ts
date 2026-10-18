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
if (!test) {
  fail('BlockForge needs WebGL 2. Please use a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.');
} else start();
