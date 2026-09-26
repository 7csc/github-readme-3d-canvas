import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { contributionLevels, fetchContributions } from '../src/github.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('levels follow GitHub: 0 for none, then quartiles of the non-zero counts', () => {
  const levels = contributionLevels([[0, 1, 2, 3, 4, 5, 6], [7, 8, null, 0, 0, 0, 0]]);
  assert.equal(levels[0][0], 0);
  assert.equal(levels[1][2], null, 'missing days stay missing');
  assert.equal(levels[0][1], 1);
  assert.equal(levels[1][1], 4);
  assert.ok(levels.flat().filter((l) => l !== null).every((l) => l >= 0 && l <= 4));
});

test('a token is required', async () => {
  await assert.rejects(fetchContributions('octocat', ''), /needs a GitHub token/);
});

test('the calendar is reshaped into weeks of seven days', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      user: {
        login: 'octocat',
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: 5,
            weeks: [
              { contributionDays: [{ contributionCount: 2, contributionLevel: 'FIRST_QUARTILE', date: '2026-01-03', weekday: 6 }] },
              { contributionDays: [{ contributionCount: 3, contributionLevel: 'FOURTH_QUARTILE', date: '2026-01-04', weekday: 0 }] },
            ],
          },
        },
      },
    },
  }));
  const data = await fetchContributions('octocat', 'token');
  assert.equal(data.total, 5);
  assert.deepEqual(data.weeks[0], [null, null, null, null, null, null, 2]);
  assert.deepEqual(data.weeks[1], [3, null, null, null, null, null, null]);
  assert.equal(data.from, '2026-01-03');
  // Levels come from GitHub as-is rather than being recomputed from the counts.
  assert.deepEqual(data.levels[0], [null, null, null, null, null, null, 1]);
  assert.deepEqual(data.levels[1], [4, null, null, null, null, null, null]);
});

test('API errors surface with their message', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { user: null }, errors: [{ message: 'Could not resolve to a User' }] }));
  await assert.rejects(fetchContributions('ghost', 'token'), /Could not resolve to a User/);
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
  await assert.rejects(fetchContributions('octocat', 'token'), /401: Bad credentials/);
});
