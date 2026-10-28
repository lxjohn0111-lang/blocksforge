// Ad entry points for the game's screens. The app installs how the game pauses during an ad
// (mute, freeze the match); screens ask for a rewarded ad or a break ad through here.

import { platform } from './platform/crazygames';

let pause: (paused: boolean) => void = () => undefined;

export function setAdPause(fn: (paused: boolean) => void) {
  pause = fn;
}

/** a rewarded ad the player chose to watch: true when it played to the end */
export function watchRewarded(): Promise<boolean> {
  return platform.rewardedAd(pause);
}

/** a midgame ad at a natural break (the SDK decides whether one actually plays) */
export function breakAd(): Promise<void> {
  return new Promise((resolve) => platform.midgameAd(pause, resolve));
}
