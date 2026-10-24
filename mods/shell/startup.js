import css from './ui.css';
import { claimCommands, onKey, reloadGuide, whenFound, whenVideo } from '../../framework/index.js';
import { claimInterpreters } from '../commands/index.js';
import { pipToFullscreen } from '../player/pictureInPicture.js';

const RIGHT = 39;

const once = { started: false };

const start = () => {
  claimInterpreters();
  takeOverKeys();

  // The settings switches (and every other command we answer) ride on YouTube's command resolver, so it is
  // claimed as soon as it exists. It used to wait for the first <video>, which left the rows of our own
  // settings drawn but dead until something had been played.
  whenFound('command resolver', () => claimCommands() || null, () => undefined, { everyMs: 250, forMs: Infinity });

  // Runs once, although whenVideo fires again when the page swaps the element.
  whenVideo('ui shell', () => {
    if (once.started) return;
    once.started = true;

    addStyles();

    reloadGuide();
  });
};

function addStyles() {
  const existing = document.querySelector('style[nonce]');
  if (existing) {
    existing.textContent += css;
    return;
  }

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function takeOverKeys() {
  onKey('pip fullscreen', [RIGHT], (event) => {
    if (event.type !== 'keydown') return undefined;

    if (window.isPipPlaying
        && document.querySelector('ytlr-search-text-box > .zylon-focus')) {
      const player = document.querySelector('ytlr-player');
      if (player) player.style.setProperty('background-color', 'rgb(0, 0, 0)');
      pipToFullscreen();
    }

    return undefined;
  });
}

export { start };
