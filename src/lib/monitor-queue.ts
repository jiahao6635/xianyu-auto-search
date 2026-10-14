let queueTail: Promise<void> = Promise.resolve();
let pendingCount = 0;
const outstandingKeys = new Set<string>();

export class MonitorAlreadyQueuedError extends Error {}

export function getMonitorQueueSize() {
  return pendingCount;
}

export async function enqueueMonitorTask<T>(
  label: string,
  task: () => Promise<T>,
  key?: string,
): Promise<T> {
  if (key && outstandingKeys.has(key)) {
    throw new MonitorAlreadyQueuedError('同一监控已有扫描在等待或执行，本次不重复入队');
  }
  if (key) outstandingKeys.add(key);
  pendingCount += 1;
  const queuePosition = pendingCount;
  console.log(`[queue] 任务入队: ${label}, currentPending=${pendingCount}`);

  let release!: () => void;
  const slot = new Promise<void>(resolve => {
    release = resolve;
  });

  const previous = queueTail;
  queueTail = queueTail.then(() => slot).catch(() => slot);

  await previous;
  pendingCount = Math.max(0, pendingCount - 1);

  console.log(`[queue] 开始执行: ${label}, waitingRemaining=${pendingCount}`);

  try {
    return await task();
  } finally {
    if (key) outstandingKeys.delete(key);
    console.log(`[queue] 执行完成: ${label}, queuedAtStart=${queuePosition}`);
    release();
  }
}
