alter table public.monitor_configs
  add column if not exists browser_headless boolean not null default false,
  add column if not exists browser_save_debug boolean not null default true,
  add column if not exists browser_channel varchar(20),
  add column if not exists browser_executable_path text,
  add column if not exists browser_user_data_dir text;
