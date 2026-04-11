export type BackgroundRefreshSkipReason =
  | 'already_running'
  | 'cooldown_active'
  | 'timeout_cooldown_active';

export type BackgroundRefreshPolicyState = {
  activeRefreshes: Set<string>;
  lastStartedAt: Map<string, number>;
  blockedUntil: Map<string, number>;
};

export function createBackgroundRefreshPolicyState(): BackgroundRefreshPolicyState {
  return {
    activeRefreshes: new Set<string>(),
    lastStartedAt: new Map<string, number>(),
    blockedUntil: new Map<string, number>()
  };
}

export function getBackgroundRefreshDecision(input: {
  state: BackgroundRefreshPolicyState;
  subjectKey: string;
  now: number;
  cooldownMs: number;
}) {
  const { state, subjectKey, now, cooldownMs } = input;
  const blockedUntil = state.blockedUntil.get(subjectKey) ?? 0;

  if (state.activeRefreshes.has(subjectKey)) {
    return {
      skip: true as const,
      reason: 'already_running' as const,
      cooldownMs: null
    };
  }

  if (blockedUntil > now) {
    return {
      skip: true as const,
      reason: 'timeout_cooldown_active' as const,
      cooldownMs: blockedUntil - now
    };
  }

  if (blockedUntil <= now) {
    state.blockedUntil.delete(subjectKey);
  }

  const lastStartedAt = state.lastStartedAt.get(subjectKey) ?? 0;

  if (now - lastStartedAt < cooldownMs) {
    return {
      skip: true as const,
      reason: 'cooldown_active' as const,
      cooldownMs: cooldownMs - (now - lastStartedAt)
    };
  }

  return {
    skip: false as const,
    reason: null,
    cooldownMs: null
  };
}

export function markBackgroundRefreshScheduled(
  state: BackgroundRefreshPolicyState,
  subjectKey: string,
  now: number
) {
  state.activeRefreshes.add(subjectKey);
  state.lastStartedAt.set(subjectKey, now);
}

export function markBackgroundRefreshCompleted(
  state: BackgroundRefreshPolicyState,
  subjectKey: string
) {
  state.activeRefreshes.delete(subjectKey);
  state.blockedUntil.delete(subjectKey);
}

export function markBackgroundRefreshFailed(
  state: BackgroundRefreshPolicyState,
  input: {
    subjectKey: string;
    now: number;
    errorClass?: string | null;
    timeoutCooldownMs: number;
  }
) {
  state.activeRefreshes.delete(input.subjectKey);

  if (input.errorClass === 'ResearchTimeoutError' && input.timeoutCooldownMs > 0) {
    state.blockedUntil.set(input.subjectKey, input.now + input.timeoutCooldownMs);
  }
}
