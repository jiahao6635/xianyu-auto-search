import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueMonitorTask, MonitorAlreadyQueuedError } from '../src/lib/monitor-queue.ts';
import { refusalReason, CollectionPausedError } from '../src/lib/collection-safety.ts';
import { sendWebhookNotification } from '../src/lib/webhook.ts';

const product = n => ({id:String(n),title:'摩托车测试',price:100000,url:'https://example.com/item/'+n,imageUrl:''});
const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/TEST-NOT-ACTUAL';

test('duplicate scheduled/manual key is not queued, key releases after failure', async () => {
  let release;
  const gate = new Promise(resolve => {release=resolve;});
  let calls=0;
  const first=enqueueMonitorTask('first',async()=>{calls++; await gate; throw new Error('failed');},'1');
  await assert.rejects(enqueueMonitorTask('duplicate',async()=>{calls++;},'1'),MonitorAlreadyQueuedError);
  release(); await assert.rejects(first,/failed/);
  await enqueueMonitorTask('retry',async()=>{calls++;},'1');
  assert.equal(calls,2);
});
test('queued task checks updated stop state immediately before work', async () => {
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const first=enqueueMonitorTask('blocking',()=>gate,'a');
  let active=true, scans=0;
  const next=enqueueMonitorTask('next',async()=>{if(!active) throw new Error('disabled'); scans++;},'b');
  active=false; release(); await first; await assert.rejects(next,/disabled/); assert.equal(scans,0);
});
test('only authorized platform refusal statuses cause pause reason',()=>{
  for(const status of [401,403,429]) assert.match(refusalReason(status,'https://www.goofish.com/search'),/HTTP/);
  assert.equal(refusalReason(200,'https://www.goofish.com/search'),undefined);
  assert.equal(refusalReason(403,'https://example.com/image'),undefined);
  assert.match(new CollectionPausedError('价格筛选','captcha').message,/价格筛选/);
});
test('missing Feishu business code is not success, request has timeout and no redirect',async()=>{
  const original=globalThis.fetch;
  let acknowledged=0;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.redirect,'error'); assert.ok(options.signal instanceof AbortSignal);
    return new Response('{}',{status:200});
  };
  try {
    await assert.rejects(sendWebhookNotification(webhook,[product(1)],{id:1,search_keyword:'摩托车'},async()=>{acknowledged++;}),/业务失败/);
    assert.equal(acknowledged,0);
  } finally {globalThis.fetch=original;}
});
test('first successful batch is acknowledged before later batch fails',async()=>{
  const original=globalThis.fetch; let calls=0; const acknowledged=[];
  globalThis.fetch=async()=>{calls++; return new Response(JSON.stringify({code:calls===1?0:9999}),{status:200});};
  try {
    await assert.rejects(sendWebhookNotification(webhook,Array.from({length:7},(_,i)=>product(i)),{id:1,search_keyword:'摩托车'},async batch=>{acknowledged.push(batch.map(p=>p.id));}),/9999/);
    assert.equal(calls,2); assert.deepEqual(acknowledged,[['0','1','2','3','4','5']]);
  } finally {globalThis.fetch=original;}
});
test('failed accounting does not retry accepted webhook',async()=>{
  const original=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=>{calls++; return new Response('{"code":0}',{status:200});};
  try {
    await assert.rejects(sendWebhookNotification(webhook,[product(1)],{id:1,search_keyword:'摩托车'},async()=>{throw new Error('db uncertain');}),/状态不确定/);
    assert.equal(calls,1);
  } finally {globalThis.fetch=original;}
});
