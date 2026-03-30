let queueTail: Promise<void> = Promise.resolve();
let pendingCount = 0;

export function getMonitorQueueSize() {
  return pendingCount;
}

export async function enqueueMonitorTask<T>(
  label: string,
  task: () => Promise<T>,
): Promise<T> {
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
    console.log(`[queue] 执行完成: ${label}, queuedAtStart=${queuePosition}`);
    release();
  }
}
