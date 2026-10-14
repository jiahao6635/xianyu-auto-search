import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

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
    uniqueIndex('sent_products_config_product_unique').on(table.configId, table.productId),
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

export const monitorState = pgTable('monitor_state', {
  configId: integer('config_id').primaryKey().references(() => monitorConfigs.id, { onDelete: 'cascade' }),
  baselineInitialized: boolean('baseline_initialized').notNull().default(false),
  scopeKey: text('scope_key'),
  scanFailures: integer('scan_failures').notNull().default(0),
  nextScanAt: timestamp('next_scan_at', { withTimezone: true }),
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  nextDeliveryAt: timestamp('next_delivery_at', { withTimezone: true }),
  scanToken: uuid('scan_token'),
  scanLeaseUntil: timestamp('scan_lease_until', { withTimezone: true }),
});

export const monitorSeen = pgTable('monitor_seen', {
  configId: integer('config_id').notNull().references(() => monitorConfigs.id, { onDelete: 'cascade' }),
  productId: varchar('product_id', { length: 255 }).notNull(),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
  platformPublishTime: text('platform_publish_time'),
  baseline: boolean('baseline').notNull(),
}, table => [primaryKey({ name: 'monitor_seen_config_product_unique', columns: [table.configId, table.productId] })]);

export const monitorOutbox = pgTable('monitor_outbox', {
  eventId: text('event_id').primaryKey(),
  configId: integer('config_id').notNull().references(() => monitorConfigs.id, { onDelete: 'cascade' }),
  productId: varchar('product_id', { length: 255 }).notNull(),
  scopeKey: text('scope_key').notNull(),
  payload: jsonb('payload').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  attemptToken: uuid('attempt_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
  lastError: text('last_error'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex('monitor_outbox_config_product_unique').on(table.configId, table.productId),
  index('monitor_outbox_due_idx').on(table.configId, table.status, table.nextAttemptAt)]);
