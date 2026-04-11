import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackgroundRefreshPolicyState,
  getBackgroundRefreshDecision,
  markBackgroundRefreshCompleted,
  markBackgroundRefreshFailed,
  markBackgroundRefreshScheduled
} from './backgroundRefreshPolicy.js';

test('background refresh policy skips while a refresh is already active', () => {
  const state = createBackgroundRefreshPolicyState();
  markBackgroundRefreshScheduled(state, 'miro', 1_000);

  const decision = getBackgroundRefreshDecision({
    state,
    subjectKey: 'miro',
    now: 1_100,
    cooldownMs: 600_000
  });

  assert.deepEqual(decision, {
    skip: true,
    reason: 'already_running',
    cooldownMs: null
  });
});

test('background refresh policy enters a timeout cooldown after retrieval timeout', () => {
  const state = createBackgroundRefreshPolicyState();
  markBackgroundRefreshScheduled(state, 'miro', 1_000);
  markBackgroundRefreshFailed(state, {
    subjectKey: 'miro',
    now: 5_000,
    errorClass: 'ResearchTimeoutError',
    timeoutCooldownMs: 3_600_000
  });

  const blocked = getBackgroundRefreshDecision({
    state,
    subjectKey: 'miro',
    now: 6_000,
    cooldownMs: 600_000
  });

  assert.equal(blocked.skip, true);
  assert.equal(blocked.reason, 'timeout_cooldown_active');
  assert.equal(blocked.cooldownMs, 3_599_000);

  const expired = getBackgroundRefreshDecision({
    state,
    subjectKey: 'miro',
    now: 3_605_001,
    cooldownMs: 600_000
  });

  assert.equal(expired.skip, false);
});

test('background refresh policy clears timeout cooldown after a successful refresh', () => {
  const state = createBackgroundRefreshPolicyState();
  markBackgroundRefreshScheduled(state, 'miro', 1_000);
  markBackgroundRefreshFailed(state, {
    subjectKey: 'miro',
    now: 5_000,
    errorClass: 'ResearchTimeoutError',
    timeoutCooldownMs: 3_600_000
  });
  markBackgroundRefreshScheduled(state, 'miro', 3_700_000);
  markBackgroundRefreshCompleted(state, 'miro');

  const decision = getBackgroundRefreshDecision({
    state,
    subjectKey: 'miro',
    now: 4_400_001,
    cooldownMs: 600_000
  });

  assert.equal(decision.skip, false);
});
