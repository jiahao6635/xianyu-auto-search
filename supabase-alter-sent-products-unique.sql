-- Review and run manually only after verifying existing duplicate records.
-- Existing duplicates make this migration fail; it does not delete historical data.
create unique index if not exists sent_products_config_product_unique
  on public.sent_products (config_id, product_id);
