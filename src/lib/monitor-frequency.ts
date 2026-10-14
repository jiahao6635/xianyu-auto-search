// node-cron: second, minute, hour, day of month, month, day of week.
export const MONITOR_FREQUENCIES = [
  { value: '0 */5 * * * *', label: '每 5 分钟' },
  { value: '0 */10 * * * *', label: '每 10 分钟' },
  { value: '0 */15 * * * *', label: '每 15 分钟' },
  { value: '0 */30 * * * *', label: '每 30 分钟' },
  { value: '0 0 * * * *', label: '每小时' },
  { value: '0 0 */2 * * *', label: '每 2 小时' },
  { value: '0 0 */6 * * *', label: '每 6 小时' },
];

const LEGACY_DESCRIPTIONS: Record<string, string> = {
  '0 * * * * *': '每 1 分钟（旧版曾标为每小时）',
  '0 */2 * * * *': '每 2 分钟（旧版曾标为每 2 小时）',
  '0 */6 * * * *': '每 6 分钟（旧版曾标为每 6 小时）',
};

export function isLegacyFrequency(expression: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_DESCRIPTIONS, expression);
}

export function getCronDescription(expression: string): string {
  return MONITOR_FREQUENCIES.find(option => option.value === expression)?.label
    ?? LEGACY_DESCRIPTIONS[expression] ?? expression;
}
