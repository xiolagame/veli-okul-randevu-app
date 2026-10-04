export interface BackNavigationState {
  hasOpenModal: boolean;
  hasOpenDetail: boolean;
  hasSecondaryRoleView: boolean;
}

export type BackNavigationDecision = 'CLOSE_MODAL' | 'BACK_TO_LIST' | 'BACK_TO_ROLE_HOME' | 'DEFER_TO_NATIVE_SHELL';

type BackHandler = () => void;
const backHandlers: Array<{ marker: symbol; handler: BackHandler }> = [];

export function registerBackHandler(handler: BackHandler): () => void {
  const entry = { marker: Symbol(), handler };
  backHandlers.push(entry);
  return () => {
    const index = backHandlers.findIndex((candidate) => candidate.marker === entry.marker);
    if (index >= 0) backHandlers.splice(index, 1);
  };
}

export function hasBackHandler(): boolean {
  return backHandlers.length > 0;
}

export function invokeBackHandler(): boolean {
  const entry = backHandlers.at(-1);
  if (!entry) return false;
  entry.handler();
  return true;
}

export function decideBackNavigation(state: BackNavigationState): BackNavigationDecision {
  if (state.hasOpenModal) return 'CLOSE_MODAL';
  if (state.hasOpenDetail) return 'BACK_TO_LIST';
  if (state.hasSecondaryRoleView) return 'BACK_TO_ROLE_HOME';
  return 'DEFER_TO_NATIVE_SHELL';
}
