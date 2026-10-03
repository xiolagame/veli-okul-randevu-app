export interface BackNavigationState {
  hasOpenModal: boolean;
  hasOpenDetail: boolean;
  hasSecondaryRoleView: boolean;
}

export type BackNavigationDecision = 'CLOSE_MODAL' | 'BACK_TO_LIST' | 'BACK_TO_ROLE_HOME' | 'DEFER_TO_NATIVE_SHELL';

export function decideBackNavigation(state: BackNavigationState): BackNavigationDecision {
  if (state.hasOpenModal) return 'CLOSE_MODAL';
  if (state.hasOpenDetail) return 'BACK_TO_LIST';
  if (state.hasSecondaryRoleView) return 'BACK_TO_ROLE_HOME';
  return 'DEFER_TO_NATIVE_SHELL';
}
