import { boolean, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const healthCheck = pgTable('health_check', {
  id: serial().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const monitorConfigs = pgTable(
  'monitor_configs',
  {
    id: serial().notNull().primaryKey(),
    searchKeyword: varchar('search_keyword', { length: 255 }).notNull(),
    priceMin: integer('price_min'),
    priceMax: integer('price_max'),
    regionProvince: varchar('region_province', { length: 50 }),
    regionCity: varchar('region_city', { length: 50 }),
    regionDistrict: varchar('region_district', { length: 50 }),
    timeRange: varchar('time_range', { length: 50 }),
    sortType: varchar('sort_type', { length: 50 }),
    cronExpression: varchar('cron_expression', { length: 100 }).notNull().default('0 */30 * * * *'),
    webhookUrl: text('webhook_url'),
    cookies: text('cookies'),
    isActive: boolean('is_active').default(true).notNull(),
    browserHeadless: boolean('browser_headless').default(false).notNull(),
    browserSaveDebug: boolean('browser_save_debug').default(true).notNull(),
    browserChannel: varchar('browser_channel', { length: 20 }),
    browserExecutablePath: text('browser_executable_path'),
    browserUserDataDir: text('browser_user_data_dir'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  table => [index('monitor_configs_active_idx').on(table.isActive)],
);

export const sentProducts = pgTable(
  'sent_products',
  {
    id: serial().notNull().primaryKey(),
    productId: varchar('product_id', { length: 255 }).notNull(),
    configId: integer('config_id').notNull(),
    title: text('title'),
    price: integer('price'),
    url: text('url'),
    imageUrl: text('image_url'),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index('sent_products_product_id_idx').on(table.productId),
    index('sent_products_config_id_idx').on(table.configId),
    index('sent_products_sent_at_idx').on(table.sentAt),
  ],
);

export const fetchedProducts = pgTable(
  'fetched_products',
  {
    id: serial().notNull().primaryKey(),
    batchId: varchar('batch_id', { length: 64 }).notNull(),
    configId: integer('config_id').notNull(),
    triggerSource: varchar('trigger_source', { length: 20 }).notNull(),
    productId: varchar('product_id', { length: 255 }).notNull(),
    title: text('title'),
    price: integer('price'),
    url: text('url'),
    imageUrl: text('image_url'),
    publishTime: text('publish_time'),
    location: text('location'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    index('fetched_products_batch_id_idx').on(table.batchId),
    index('fetched_products_config_id_idx').on(table.configId),
    index('fetched_products_product_id_idx').on(table.productId),
    index('fetched_products_fetched_at_idx').on(table.fetchedAt),
  ],
);
