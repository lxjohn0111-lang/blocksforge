// Device sniffing kept to capabilities: is the primary pointer a finger, and how big is the screen.

/** primary input is a touch screen (phones, most tablets) */
export function isTouchDevice(): boolean {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const anyFine = matchMedia('(any-pointer: fine)').matches;
    return coarse || (navigator.maxTouchPoints > 0 && !anyFine);
  } catch {
    return false;
  }
}

/** a phone-sized screen (the short side is under 520 CSS px) */
export function isSmallScreen(): boolean {
  return Math.min(window.innerWidth, window.innerHeight) < 520;
}
