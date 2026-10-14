import { NextRequest, NextResponse } from 'next/server';
import { triggerMonitor } from '@/lib/monitor-scheduler';
import { getMonitorQueueSize, MonitorAlreadyQueuedError } from '@/lib/monitor-queue';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id))) {
      return NextResponse.json({ error: '无效监控 ID' }, { status: 400 });
    }
    const queueBeforeStart = getMonitorQueueSize();
    const result = await triggerMonitor(Number(id));
    return NextResponse.json({ ...result, queueBeforeStart });
  } catch (error) {
    console.error('[trigger] 执行失败:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '扫描失败' },
      { status: error instanceof MonitorAlreadyQueuedError ? 409 : 500 },
    );
  }
}
