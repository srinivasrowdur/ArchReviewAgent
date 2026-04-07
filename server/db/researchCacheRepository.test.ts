import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVendorResolutionCacheEntries,
  pickMostCompleteVendorResolution,
  pickMostCompleteVendorResolutionRow
} from './researchCacheRepository.js';

test('buildVendorResolutionCacheEntries writes both requested and canonical keys for aliases', () => {
  assert.deepEqual(buildVendorResolutionCacheEntries('Palintir', 'Palantir'), [
    {
      subjectKey: 'palintir',
      requestedSubjectName: 'Palintir'
    },
    {
      subjectKey: 'palantir',
      requestedSubjectName: 'Palantir'
    }
  ]);
});

test('pickMostCompleteVendorResolutionRow prefers the richer alias resolution when domains diverge', () => {
  const bestRow = pickMostCompleteVendorResolutionRow([
    {
      requested_subject_name: 'Palantir',
      canonical_name: 'Palantir',
      official_domains: ['palantir.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Canonical entry.'
    },
    {
      requested_subject_name: 'Palintir',
      canonical_name: 'Palantir',
      official_domains: ['palantir.com', 'palantirfoundry.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Alias entry with broader first-party domains.'
    }
  ]);

  assert.equal(bestRow?.requested_subject_name, 'Palintir');
  assert.deepEqual(bestRow?.official_domains, ['palantir.com', 'palantirfoundry.com']);
});

test('pickMostCompleteVendorResolution keeps a stronger canonical resolution over a weaker alias refresh', () => {
  const bestResolution = pickMostCompleteVendorResolution([
    {
      canonicalName: 'Palantir',
      officialDomains: ['palantir.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Weaker alias refresh.'
    },
    {
      canonicalName: 'Palantir',
      officialDomains: ['palantir.com', 'palantirfoundry.com'],
      confidence: 'high',
      alternatives: [],
      rationale: 'Stronger canonical baseline.'
    }
  ]);

  assert.deepEqual(bestResolution.officialDomains, ['palantir.com', 'palantirfoundry.com']);
});
