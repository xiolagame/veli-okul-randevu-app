import type { PushStatus } from '../platform/android-push';

export function pushPromptState(status: PushStatus, dismissed: boolean): { showAction: boolean; showExplanation: boolean } {
  return { showAction: status !== 'ready', showExplanation: status !== 'ready' && !dismissed };
}
