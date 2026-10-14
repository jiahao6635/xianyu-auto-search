import assert from 'node:assert/strict';
import test from 'node:test';
import { MONITOR_FREQUENCIES, getCronDescription, isLegacyFrequency } from '../src/lib/monitor-frequency.ts';

// Count scheduled slots over a day using only the fields these presets use.
// This independently verifies minute/hour placement without installing node-cron.
function matches(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) return value % Number(field.slice(2)) === 0;
  return Number(field) === value;
}
function dailyCount(expression) {
  const [seconds, minutes, hours, ...calendar] = expression.split(' ');
  assert.equal(seconds, '0');
  assert.deepEqual(calendar, ['*', '*', '*']);
  let count = 0;
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) {
    if (matches(minutes, m) && matches(hours, h)) count++;
  }
  return count;
}
const expected = [288, 144, 96, 48, 24, 12, 4];
MONITOR_FREQUENCIES.forEach((option, index) => {
  test(option.label + ' executes expected daily frequency', () => {
    assert.equal(dailyCount(option.value), expected[index]);
    assert.equal(getCronDescription(option.value), option.label);
    assert.equal(isLegacyFrequency(option.value), false);
  });
});
test('legacy minute schedules remain unchanged and accurately labeled', () => {
  for (const [expression, count] of [['0 * * * * *',1440], ['0 */2 * * * *',720], ['0 */6 * * * *',240]]) {
    assert.equal(dailyCount(expression), count);
    assert.equal(isLegacyFrequency(expression), true);
    assert.match(getCronDescription(expression), /分钟/);
  }
});
test('custom expressions are preserved verbatim', () => {
  const custom = '0 30 8 * * 1-5';
  assert.equal(getCronDescription(custom), custom);
  assert.equal(isLegacyFrequency(custom), false);
  assert.equal(isLegacyFrequency('toString'), false);
});
test('options contain no duplicate cron expressions', () => {
  assert.equal(new Set(MONITOR_FREQUENCIES.map(o => o.value)).size, MONITOR_FREQUENCIES.length);
});
