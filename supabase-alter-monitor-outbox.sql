-- Review and apply manually with monitors stopped. No historical rows are deleted.
-- New state defaults to a baseline scan, including existing monitor configurations.
-- Invoker security + RLS: backend service_role only; never expose that key in the browser.
begin;
create table if not exists public.monitor_state (
  config_id integer primary key references public.monitor_configs(id) on delete cascade,
  baseline_initialized boolean not null default false,
  scope_key text,
  scan_failures integer not null default 0,
  next_scan_at timestamptz,
  last_scan_at timestamptz,
  next_delivery_at timestamptz,
  scan_token uuid,
  scan_lease_until timestamptz
);
create table if not exists public.monitor_seen (
  config_id integer not null references public.monitor_configs(id) on delete cascade,
  product_id varchar(255) not null,
  first_seen_at timestamptz not null,
  platform_publish_time text,
  baseline boolean not null,
  constraint monitor_seen_config_product_unique primary key (config_id, product_id)
);
create table if not exists public.monitor_outbox (
  event_id text primary key,
  config_id integer not null references public.monitor_configs(id) on delete cascade,
  product_id varchar(255) not null,
  scope_key text not null,
  payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','sending','delivered','uncertain','failed','cancelled')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  attempt_token uuid,
  lease_until timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  constraint monitor_outbox_config_product_unique unique (config_id, product_id)
);
create index if not exists monitor_outbox_due_idx on public.monitor_outbox(config_id,status,next_attempt_at);
alter table public.monitor_state enable row level security;
alter table public.monitor_seen enable row level security;
alter table public.monitor_outbox enable row level security;
-- Preserve known old items; the first fresh scan still baselines all currently visible items.
insert into public.monitor_seen(config_id,product_id,first_seen_at,platform_publish_time,baseline)
select config_id,product_id,min(observed_at),null,true from (
  select s.config_id,s.product_id,s.sent_at as observed_at from public.sent_products s
  join public.monitor_configs c on c.id=s.config_id
  union all
  select f.config_id,f.product_id,f.fetched_at from public.fetched_products f
  join public.monitor_configs c on c.id=f.config_id
) history group by config_id,product_id
on conflict (config_id,product_id) do nothing;

create or replace function public.monitor_ingest(p_config_id integer,p_token uuid,p_scope text,p_products jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare st monitor_state%rowtype; product jsonb; inserted_id text; added jsonb := '[]'; baseline_scan boolean; stamp timestamptz:=clock_timestamp();
begin
  perform 1 from monitor_configs where id=p_config_id and is_active for update;
  if not found then raise exception 'monitor_inactive'; end if;
  if jsonb_typeof(p_products) is distinct from 'array' or p_scope is null or p_scope='' then raise exception 'invalid_snapshot'; end if;
  insert into monitor_state(config_id) values(p_config_id) on conflict do nothing;
  select * into st from monitor_state where config_id=p_config_id for update;
  if st.scan_token is distinct from p_token or p_token is null then raise exception 'scan_token_mismatch'; end if;
  baseline_scan := not st.baseline_initialized or st.scope_key is distinct from p_scope;
  if st.scope_key is distinct from p_scope then
    update monitor_outbox set status='cancelled',last_error='scope_changed'
      where config_id=p_config_id and status='pending';
  end if;
  for product in select value from jsonb_array_elements(p_products) loop
    if coalesce(product->>'id','') !~ '^[A-Za-z0-9_.-]{1,255}$'
      or jsonb_typeof(product->'title') is distinct from 'string'
      or jsonb_typeof(product->'price') is distinct from 'number'
      or (product->>'price')::numeric < 0
      or (product->>'price')::numeric > 2147483647
      or (product->>'price')::numeric <> trunc((product->>'price')::numeric)
      or coalesce(product->>'url','') !~ '^https://' then raise exception 'invalid_product'; end if;
    inserted_id := null;
    insert into monitor_seen(config_id,product_id,first_seen_at,platform_publish_time,baseline)
      values(p_config_id,product->>'id',stamp,product->>'publishTime',baseline_scan)
      on conflict do nothing returning product_id into inserted_id;
    if inserted_id is not null and not baseline_scan then
      insert into monitor_outbox(event_id,config_id,product_id,scope_key,payload)
        values('xianyu:'||p_config_id||':'||inserted_id,p_config_id,inserted_id,p_scope,
          jsonb_build_object('product',product,'first_seen_at',stamp,'platform_publish_time',product->>'publishTime'));
      added := added || jsonb_build_array(product);
    end if;
  end loop;
  update monitor_state set baseline_initialized=true,scope_key=p_scope,scan_failures=0,next_scan_at=null,last_scan_at=stamp,scan_token=null,scan_lease_until=null where config_id=p_config_id;
  return jsonb_build_object('baseline',baseline_scan,'products',added);
end $$;

create or replace function public.monitor_scan_failure(p_config_id integer,p_token uuid)
returns void language plpgsql security invoker set search_path=public as $$
begin
  insert into monitor_state(config_id) values(p_config_id) on conflict do nothing;
  update monitor_state set scan_failures=scan_failures+1,
    next_scan_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(scan_failures,7)))::integer),
    scan_token=null,scan_lease_until=null where config_id=p_config_id and scan_token=p_token;
end $$;

create or replace function public.monitor_begin_scan(p_config_id integer)
returns uuid language plpgsql security invoker set search_path=public as $$
declare st monitor_state%rowtype; token uuid;
begin
  perform 1 from monitor_configs where id=p_config_id and is_active for update;
  if not found then return null; end if;
  insert into monitor_state(config_id) values(p_config_id) on conflict do nothing;
  select * into st from monitor_state where config_id=p_config_id for update;
  if st.next_scan_at>clock_timestamp() or st.scan_lease_until>clock_timestamp() then return null; end if;
  token:=gen_random_uuid();
  update monitor_state set scan_token=token,scan_lease_until=clock_timestamp()+interval '10 minutes' where config_id=p_config_id;
  return token;
end $$;

create or replace function public.monitor_claim(p_config_id integer,p_scope text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare job monitor_outbox%rowtype;
begin
  perform 1 from monitor_configs where id=p_config_id and is_active for update;
  if not found then return null; end if;
  if exists(select 1 from monitor_state where config_id=p_config_id and next_delivery_at>clock_timestamp()) then return null; end if;
  -- A lost worker may have sent already. Never blindly reclaim its request.
  update monitor_outbox set status='uncertain',last_error='worker_lost_or_confirmation_lost'
    where config_id=p_config_id and status='sending' and lease_until<=clock_timestamp();
  select o.* into job from monitor_outbox o join monitor_state s using(config_id)
    where o.config_id=p_config_id and o.status='pending' and o.scope_key=s.scope_key and s.scope_key=p_scope
      and o.next_attempt_at<=clock_timestamp()
    order by o.next_attempt_at,o.created_at,o.event_id for update of o skip locked limit 1;
  if not found then return null; end if;
  update monitor_outbox set status='sending',attempts=attempts+1,attempt_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
    where event_id=job.event_id returning * into job;
  return to_jsonb(job);
end $$;

create or replace function public.monitor_finish(p_event_id text,p_token uuid,p_outcome text,p_error text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare job monitor_outbox%rowtype; prod jsonb;
begin
  select * into job from monitor_outbox where event_id=p_event_id for update;
  if not found or job.attempt_token is distinct from p_token then raise exception 'attempt_mismatch'; end if;
  if job.status='delivered' and p_outcome='delivered' then return; end if;
  if job.status<>'sending' then raise exception 'attempt_not_sending'; end if;
  if p_outcome='delivered' then
    prod:=job.payload->'product';
    -- The outbox is authoritative; historical sent_products need not be unique to acknowledge safely.
    if not exists(select 1 from sent_products where config_id=job.config_id and product_id=job.product_id) then
      insert into sent_products(config_id,product_id,title,price,url,image_url)
        values(job.config_id,job.product_id,prod->>'title',(prod->>'price')::integer,prod->>'url',prod->>'imageUrl');
    end if;
    update monitor_outbox set status='delivered',delivered_at=clock_timestamp(),lease_until=null,last_error=null where event_id=p_event_id;
  elsif p_outcome in ('uncertain','failed') then
    update monitor_outbox set status=p_outcome,lease_until=null,last_error=left(p_error,200) where event_id=p_event_id;
  elsif p_outcome='retry' then
    update monitor_state set next_delivery_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(job.attempts-1,6)))::integer) where config_id=job.config_id;
    update monitor_outbox set status='pending',lease_until=null,last_error=left(p_error,200),
      next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,60*power(2,least(job.attempts-1,6)))::integer)
      where event_id=p_event_id;
  else raise exception 'invalid_outcome'; end if;
end $$;

-- Explicit operator reconciliation; never used automatically on an uncertain delivery.
create or replace function public.monitor_reconcile(p_event_id text,p_action text)
returns void language plpgsql security invoker set search_path=public as $$
declare job monitor_outbox%rowtype;
begin
  select * into job from monitor_outbox where event_id=p_event_id and status in ('uncertain','failed') for update;
  if not found then raise exception 'event_not_reviewable'; end if;
  if p_action='confirmed_delivered' then
    update monitor_outbox set status='sending' where event_id=p_event_id;
    perform monitor_finish(p_event_id,job.attempt_token,'delivered',null);
  elsif p_action='retry_may_duplicate' then
    update monitor_outbox set status='pending',next_attempt_at=clock_timestamp(),last_error='operator_authorized_retry' where event_id=p_event_id;
  else raise exception 'invalid_reconciliation'; end if;
end $$;

revoke all on public.monitor_state,public.monitor_seen,public.monitor_outbox from anon,authenticated;
grant all on public.monitor_state,public.monitor_seen,public.monitor_outbox to service_role;
revoke execute on function public.monitor_ingest(integer,uuid,text,jsonb),public.monitor_scan_failure(integer,uuid),public.monitor_begin_scan(integer),public.monitor_claim(integer,text),public.monitor_finish(text,uuid,text,text),public.monitor_reconcile(text,text) from public,anon,authenticated;
grant execute on function public.monitor_ingest(integer,uuid,text,jsonb),public.monitor_scan_failure(integer,uuid),public.monitor_begin_scan(integer),public.monitor_claim(integer,text),public.monitor_finish(text,uuid,text,text),public.monitor_reconcile(text,text) to service_role;
commit;
