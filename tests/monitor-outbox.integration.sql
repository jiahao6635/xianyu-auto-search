-- Run only in a disposable Supabase/PostgreSQL test database after migration.
-- Assertions use the real SQL functions. Rollback removes all test data/triggers.
begin;
create function pg_temp.reject_test_sent() returns trigger language plpgsql as $$
begin
  if new.title='force-test-accounting-failure' then raise exception 'test accounting failure'; end if;
  return new;
end $$;
create trigger reject_test_sent before insert on public.sent_products
  for each row execute function pg_temp.reject_test_sent();
do $$
declare cfg integer; token uuid; snapshot jsonb; result jsonb; job jsonb; other_job jsonb; blocked boolean;
begin
  insert into public.monitor_configs(search_keyword,is_active) values('outbox integration test',true) returning id into cfg;
  snapshot := '[{"id":"test-1","title":"摩托车","price":100000,"url":"https://example.com/1","imageUrl":""}]';
  token:=public.monitor_begin_scan(cfg);
  if token is null then raise exception 'scan claim missing'; end if;
  if public.monitor_begin_scan(cfg) is not null then raise exception 'overlapping scan claim'; end if;
  result:=public.monitor_ingest(cfg,token,'scope-1',snapshot);
  if (result->>'baseline')::boolean is not true or jsonb_array_length(result->'products')<>0 then raise exception 'baseline pushed inventory'; end if;
  if public.monitor_claim(cfg,'scope-1') is not null then raise exception 'baseline queued'; end if;

  token:=public.monitor_begin_scan(cfg);
  snapshot:=snapshot || '[{"id":"test-2","title":"摩托车","price":200000,"url":"https://example.com/2","imageUrl":""},{"id":"test-2","title":"摩托车","price":200000,"url":"https://example.com/2","imageUrl":""}]'::jsonb;
  result:=public.monitor_ingest(cfg,token,'scope-1',snapshot);
  if jsonb_array_length(result->'products')<>1 then raise exception 'duplicate discovery'; end if;
  job:=public.monitor_claim(cfg,'scope-1');
  if job->>'event_id' <> 'xianyu:'||cfg||':test-2' then raise exception 'unstable event id'; end if;
  if public.monitor_claim(cfg,'scope-1') is not null then raise exception 'claim duplicated'; end if;
  perform public.monitor_finish(job->>'event_id',(job->>'attempt_token')::uuid,'delivered');
  perform public.monitor_finish(job->>'event_id',(job->>'attempt_token')::uuid,'delivered');
  if (select count(*) from public.sent_products where config_id=cfg and product_id='test-2')<>1 then raise exception 'ack duplicated'; end if;
  token:=public.monitor_begin_scan(cfg);
  perform public.monitor_ingest(cfg,token,'scope-1',snapshot);
  if public.monitor_claim(cfg,'scope-1') is not null then raise exception 'restart/dedup resend'; end if;

  -- Entire ingestion transaction must roll back when any item is invalid.
  token:=public.monitor_begin_scan(cfg);
  blocked:=false;
  begin
    perform public.monitor_ingest(cfg,token,'scope-1','[{"id":"valid-before-invalid","title":"摩托车","price":1000,"url":"https://example.com/3"},{"id":"","title":"bad","price":1000,"url":"https://example.com/4"}]');
  exception when others then blocked:=true; end;
  if not blocked or exists(select 1 from public.monitor_seen where config_id=cfg and product_id='valid-before-invalid') then raise exception 'ingest not atomic'; end if;
  perform public.monitor_scan_failure(cfg,token);
  if public.monitor_begin_scan(cfg) is not null then raise exception 'scan backoff not durable'; end if;
  update public.monitor_state set next_scan_at=null where config_id=cfg;

  token:=public.monitor_begin_scan(cfg);
  perform public.monitor_ingest(cfg,token,'scope-1','[{"id":"test-3","title":"force-test-accounting-failure","price":1000,"url":"https://example.com/3"}]');
  job:=public.monitor_claim(cfg,'scope-1');
  blocked:=false;
  begin
    perform public.monitor_finish(job->>'event_id',(job->>'attempt_token')::uuid,'delivered');
  exception when others then blocked:=true; end;
  if not blocked or (select status from public.monitor_outbox where event_id=job->>'event_id')<>'sending' then raise exception 'accounting failure lost claim'; end if;
  update public.monitor_outbox set lease_until=now()-interval '1 second' where event_id=job->>'event_id';
  other_job:=public.monitor_claim(cfg,'scope-1');
  if other_job is not null or (select status from public.monitor_outbox where event_id=job->>'event_id')<>'uncertain' then raise exception 'lost worker auto-retried'; end if;
  perform public.monitor_reconcile(job->>'event_id','retry_may_duplicate');
  job:=public.monitor_claim(cfg,'scope-1');
  perform public.monitor_finish(job->>'event_id',(job->>'attempt_token')::uuid,'retry','explicit_rate_limit');
  if public.monitor_claim(cfg,'scope-1') is not null then raise exception 'delivery cooldown not durable'; end if;

  -- Changed filters establish another baseline, cancel old pending work and preserve uncertainty.
  token:=public.monitor_begin_scan(cfg);
  result:=public.monitor_ingest(cfg,token,'scope-2','[{"id":"test-4","title":"摩托车","price":1000,"url":"https://example.com/4"}]');
  if (result->>'baseline')::boolean is not true or jsonb_array_length(result->'products')<>0 then raise exception 'scope change flooded'; end if;
  if (select status from public.monitor_outbox where event_id=job->>'event_id')<>'cancelled' then raise exception 'old scope work not cancelled'; end if;
  update public.monitor_configs set is_active=false where id=cfg;
  if public.monitor_begin_scan(cfg) is not null or public.monitor_claim(cfg,'scope-2') is not null then raise exception 'inactive work executed'; end if;
  raise notice 'Real PostgreSQL outbox assertions passed';
end $$;
rollback;
