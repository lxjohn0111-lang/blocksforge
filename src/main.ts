// Latin subsets only (with accented letters); the build inlines them into the stylesheet
import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-ext-400.css';
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-ext-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-ext-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/chakra-petch/latin-ext-700.css';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-ext-400.css';
import '@fontsource/pixelify-sans/latin-600.css';
import '@fontsource/pixelify-sans/latin-ext-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-ext-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-ext-700.css';
import './ui/styles.css';
import { App } from './app';
import { platform } from './platform/crazygames';

function fail(msg: string) {
  const el = document.getElementById('ui')!;
  el.innerHTML = `<div class="screen boot"><div class="logo">BLOCK<span class="forge">FORGE</span></div><div class="tip boot-err">${msg}</div></div>`;
}

async function start() {
  const w = window as unknown as { __bfStarted: boolean; __bfStep: string };
  w.__bfStarted = true;
  w.__bfStep = 'connecting to the platform SDK';
  // the platform SDK has to be ready before saved progress is read
  await platform.init();
  w.__bfStep = 'starting';
  platform.loadingStart();
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
