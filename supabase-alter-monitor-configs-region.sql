alter table public.monitor_configs
  add column if not exists region_province varchar(50),
  add column if not exists region_city varchar(50),
  add column if not exists region_district varchar(50);
