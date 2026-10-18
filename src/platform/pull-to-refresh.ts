export const PULL_REFRESH_THRESHOLD = 72;

export function canStartRefreshGesture(options: { atTop: boolean; modalOpen: boolean; nestedScroll: boolean; interactive: boolean }): boolean {
  return options.atTop && !options.modalOpen && !options.nestedScroll && !options.interactive;
}

export function isRefreshPull(deltaX: number, deltaY: number): boolean {
  return deltaY >= PULL_REFRESH_THRESHOLD && deltaY > Math.abs(deltaX) * 1.5;
}
