import { pgTable, serial, timestamp, varchar, integer, boolean, text, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// 系统健康检查表（Supabase 内置，请勿删除）
export const healthCheck = pgTable("health_check", {
	id: serial().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// 监控配置表
export const monitorConfigs = pgTable(
	"monitor_configs",
	{
		id: serial().notNull().primaryKey(),
		searchKeyword: varchar("search_keyword", { length: 255 }).notNull(),
		priceMin: integer("price_min"),
		priceMax: integer("price_max"),
		timeRange: varchar("time_range", { length: 50 }), // 例如: "1hour", "24hours", "7days"
		sortType: varchar("sort_type", { length: 50 }), // 例如: "newest", "price_asc", "price_desc"
		cronExpression: varchar("cron_expression", { length: 100 }).notNull().default("0 */30 * * * *"), // 默认每30分钟
		webhookUrl: text("webhook_url"),
		cookies: text("cookies"), // 闲鱼登录 Cookie
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
	},
	(table) => [
		index("monitor_configs_active_idx").on(table.isActive),
	]
);

// 已发送商品记录表（用于去重）
export const sentProducts = pgTable(
	"sent_products",
	{
		id: serial().notNull().primaryKey(),
		productId: varchar("product_id", { length: 255 }).notNull(), // 商品唯一ID
		configId: integer("config_id").notNull(), // 关联的配置ID
		title: text("title"), // 商品标题
		price: integer("price"), // 价格（分）
		url: text("url"), // 商品链接
		imageUrl: text("image_url"), // 商品图片链接
		sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => [
		index("sent_products_product_id_idx").on(table.productId),
		index("sent_products_config_id_idx").on(table.configId),
		index("sent_products_sent_at_idx").on(table.sentAt),
	]
);
