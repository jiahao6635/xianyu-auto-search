import assert from 'node:assert/strict';
import test from 'node:test';
import { MonitorOutbox, OutboxPersistenceError, DeliveryRejectedError } from '../src/lib/monitor-outbox.ts';
import { sendOutboxNotification } from '../src/lib/webhook.ts';

const job = id => ({event_id:'xianyu:1:'+id,attempt_token:'token-'+id,attempts:1,
  payload:{product:{id,title:'摩托车',price:100000,url:'https://example.com/item/'+id,imageUrl:''},first_seen_at:'2026-10-14T00:00:00Z',platform_publish_time:null}});
// Durable storage double for the RPC boundary, not a PostgreSQL emulator.
class Backend {
  constructor(jobs=[]) { this.jobs=jobs.map(value=>({...value,status:'pending'})); this.calls=[]; this.failAck=false; this.commitThenLoseResponse=false; }
  async rpc(name,args) {
    this.calls.push({name,args});
    if(name==='monitor_claim') {
      const next=this.jobs.find(j=>j.status==='pending');
      if(!next) return {data:null,error:null};
      next.status='sending'; return {data:structuredClone(next),error:null};
    }
    if(name==='monitor_finish') {
      const next=this.jobs.find(j=>j.event_id===args.p_event_id);
      assert.equal(next.attempt_token,args.p_token);
      if(this.failAck && args.p_outcome==='delivered') return {data:null,error:'database failed'};
      next.status=args.p_outcome==='retry'?'pending':args.p_outcome;
      if(this.commitThenLoseResponse && args.p_outcome==='delivered') return {data:null,error:'response lost after commit'};
      return {data:null,error:null};
    }
    throw new Error('unexpected RPC '+name);
  }
}
test('partial success survives a new worker, pending product need not be visible in a new scan',async()=>{
  const backend=new Backend([job('1'),job('2')]); const sends=[];
  await new MonitorOutbox(backend).drain(1,'scope',async j=>{sends.push(j.event_id); if(j.event_id.endsWith(':2')) throw new DeliveryRejectedError(true,'limit');});
  assert.equal(backend.jobs[0].status,'delivered'); assert.equal(backend.jobs[1].status,'pending');
  await new MonitorOutbox(backend).drain(1,'scope',async j=>{sends.push(j.event_id);});
  assert.deepEqual(sends,['xianyu:1:1','xianyu:1:2','xianyu:1:2']);
});
test('timeout stays uncertain and a restarted worker does not resend',async()=>{
  const backend=new Backend([job('1')]);let calls=0;
  await new MonitorOutbox(backend).drain(1,'scope',async()=>{calls++;throw new Error('timeout');});
  assert.equal(backend.jobs[0].status,'uncertain');
  await new MonitorOutbox(backend).drain(1,'scope',async()=>{calls++;});
  assert.equal(calls,1);
});
test('acknowledgement DB failure leaves sending, never automatic network retry',async()=>{
  const backend=new Backend([job('1')]);backend.failAck=true;let sends=0;
  await assert.rejects(new MonitorOutbox(backend).drain(1,'scope',async()=>{sends++;}),OutboxPersistenceError);
  assert.equal(backend.jobs[0].status,'sending');
  await new MonitorOutbox(backend).drain(1,'scope',async()=>{sends++;});
  assert.equal(sends,1);
});
test('commit succeeded but DB response lost does not resend after restart',async()=>{
  const backend=new Backend([job('1')]);backend.commitThenLoseResponse=true;let sends=0;
  await assert.rejects(new MonitorOutbox(backend).drain(1,'scope',async()=>{sends++;}),OutboxPersistenceError);
  assert.equal(backend.jobs[0].status,'delivered');
  await new MonitorOutbox(backend).drain(1,'scope',async()=>{sends++;});assert.equal(sends,1);
});
test('claim DB failure prevents HTTP call',async()=>{
  let sends=0;
  await assert.rejects(new MonitorOutbox({rpc:async()=>({data:null,error:'offline'})}).drain(1,'scope',async()=>{sends++;}),OutboxPersistenceError);
  assert.equal(sends,0);
});
test('baseline result and scan token/scope are passed intact to transactional RPC',async()=>{
  const calls=[];
  const store=new MonitorOutbox({rpc:async(name,args)=>{calls.push({name,args}); return {data:name==='monitor_begin_scan'?'token':{baseline:true,products:[]},error:null};}});
  assert.equal(await store.beginScan(1),'token');
  assert.deepEqual(await store.ingest(1,'token','scope',[job('1').payload.product]),{baseline:true,products:[]});
  assert.equal(calls[1].args.p_token,'token');assert.equal(calls[1].args.p_scope,'scope');assert.equal(calls[1].args.p_products[0].id,'1');
});
test('outbox request exposes discovery metadata, stable event header and unknown publish time',async()=>{
  const original=globalThis.fetch;const previousSecret=process.env.FEISHU_BOT_SECRET;
  delete process.env.FEISHU_BOT_SECRET;
  let body,headers;
  globalThis.fetch=async(url,opts)=>{body=JSON.parse(opts.body);headers=opts.headers;return new Response('{"code":0}',{status:200});};
  try {
    await sendOutboxNotification('https://open.feishu.cn/open-apis/bot/v2/hook/TEST',job('1'),{id:1,search_keyword:'摩托车'});
    assert.equal(headers['Idempotency-Key'],'xianyu:1:1');
    assert.match(JSON.stringify(body),/首次发现/);assert.match(JSON.stringify(body),/不能确认刚上架/);
  } finally {globalThis.fetch=original; if(previousSecret!==undefined)process.env.FEISHU_BOT_SECRET=previousSecret;}
});
test('outbox HTTP 500 is uncertain; explicit 429 is retryable',async()=>{
  const original=globalThis.fetch;
  try {
    for(const [status,expected] of [[500,'uncertain'],[429,'pending']]) {
      const backend=new Backend([job(String(status))]);globalThis.fetch=async()=>new Response('',{status});
      await new MonitorOutbox(backend).drain(1,'scope',j=>sendOutboxNotification('https://open.feishu.cn/open-apis/bot/v2/hook/TEST',j,{id:1,search_keyword:'摩托车'}));
      assert.equal(backend.jobs[0].status,expected);
    }
  } finally {globalThis.fetch=original;}
});
