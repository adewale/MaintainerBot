import { strict as assert } from 'node:assert';

const rejected = new Set(['adewale/example:metadata-description:add-or-improve-project-description-documentation']);
const candidates = [
  { fingerprint: 'adewale/example:metadata-description:add-or-improve-project-description-documentation' },
  { fingerprint: 'adewale/example:missing-readme:add-readme-documentation' },
];
const filtered = candidates.filter((candidate) => !rejected.has(candidate.fingerprint));
assert.equal(filtered.length, 1);
assert.equal(filtered[0].fingerprint, 'adewale/example:missing-readme:add-readme-documentation');
console.log('Rejection filtering test passed.');
