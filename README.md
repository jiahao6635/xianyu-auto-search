# 闲鱼商品监控系统

基于 Playwright 的闲鱼商品定时监控系统，支持自定义搜索条件、定时任务和 Webhook 通知。

## 功能特性

✅ **Cron 定时任务** - 支持自定义 Cron 表达式配置周期性扫描
✅ **Webhook 消息通知** - 发现新商品时自动发送通知到配置的 Webhook
✅ **智能过滤条件** - 支持价格范围、上架时间、排序方式等过滤
✅ **数据去重** - 自动记录已发送商品 ID，避免重复通知
✅ **可视化管理界面** - 前端页面配置所有参数，无需修改代码

## 快速开始

### 1. 获取闲鱼 Cookie

由于闲鱼需要登录才能查看商品，你需要先获取 Cookie：

1. 在浏览器中访问闲鱼网页版：https://www.goofish.com
2. 登录你的淘宝账号
3. 按 `F12` 打开开发者工具
4. 切换到 `Network` 标签页
5. 刷新页面，找到任意请求
6. 在请求头中找到 `Cookie` 字段，复制完整的 Cookie 值

### 2. 创建监控配置

访问前端页面（默认运行在 `http://localhost:5000`），点击"新建监控"按钮：

- **搜索关键词**：例如 "摩托车"
- **价格范围**：设置最低/最高价格（元）
- **时间范围**：1小时内、24小时内、7天内
- **排序方式**：最新上架、价格从低到高、价格从高到低
- **扫描频率**：每15分钟、每30分钟、每小时等
- **闲鱼 Cookie**：粘贴从浏览器复制的 Cookie（必填）
- **Webhook URL**：通知地址（支持飞书、钉钉、企业微信等）

### 2. 启动监控

创建配置后，系统会自动启动定时任务。你也可以点击"立即扫描"按钮手动触发一次扫描。

### 3. 接收通知

当发现新商品时，系统会向配置的 Webhook URL 发送 POST 请求：

```json
{
  "configId": 1,
  "keyword": "摩托车",
  "count": 3,
  "timestamp": "2024-01-01T10:00:00.000Z",
  "products": [
    {
      "id": "123456",
      "title": "本田CB400",
      "price": 2500000,
      "priceYuan": "25000.00",
      "url": "https://www.goofish.com/item/123456",
      "imageUrl": "https://..."
    }
  ]
}
```

## API 接口

### 获取所有配置
```
GET /api/configs
```

### 创建配置
```
POST /api/configs
Content-Type: application/json

{
  "search_keyword": "摩托车",
  "price_min": 20000,
  "price_max": null,
  "time_range": "1hour",
  "sort_type": "newest",
  "cron_expression": "0 */30 * * * *",
  "webhook_url": "https://api.example.com/webhook",
  "is_active": true
}
```

### 更新配置
```
PUT /api/configs/:id
Content-Type: application/json

{
  "search_keyword": "摩托车",
  "price_min": 20000,
  ...
}
```

### 删除配置
```
DELETE /api/configs/:id
```

### 手动触发扫描
```
POST /api/trigger/:id
```

## 配置说明

### Cron 表达式

系统使用 6 位 Cron 表达式（秒 分 时 日 月 周）：

- `0 */15 * * * *` - 每15分钟
- `0 */30 * * * *` - 每30分钟（默认）
- `0 * * * * *` - 每小时
- `0 */2 * * * *` - 每2小时
- `0 */6 * * * *` - 每6小时

### 时间范围

- `1hour` - 1小时内上架的商品
- `24hours` - 24小时内上架的商品
- `7days` - 7天内上架的商品

### 排序方式

- `newest` - 最新上架
- `price_asc` - 价格从低到高
- `price_desc` - 价格从高到低

## Webhook 集成示例

### 飞书机器人

1. 创建飞书群组
2. 添加自定义机器人
3. 获取 Webhook URL
4. 将 URL 填入配置中

### 钉钉机器人

1. 创建钉钉群组
2. 添加自定义机器人
3. 获取 Webhook URL
4. 将 URL 填入配置中

### 企业微信机器人

1. 创建企业微信群组
2. 添加群机器人
3. 获取 Webhook URL
4. 将 URL 填入配置中

## 技术栈

- **前端**：Next.js 16 + React 19 + TypeScript + Tailwind CSS
- **后端**：Next.js API Routes
- **自动化**：Playwright（浏览器自动化）
- **定时任务**：node-cron
- **数据库**：Supabase（PostgreSQL）

## 注意事项

1. **浏览器驱动**：首次运行前需要安装 Playwright 浏览器驱动：
   ```bash
   npx playwright install chromium
   ```

2. **Cookie 有效性**：
   - 闲鱼需要登录才能查看商品，**必须配置 Cookie**
   - Cookie 可能会过期，如果扫描失败请重新获取并更新
   - 建议定期更新 Cookie（一般有效期几小时到几天）

3. **反爬策略**：闲鱼可能有反爬虫机制，建议：
   - 不要设置过于频繁的扫描频率（建议至少间隔 15 分钟）
   - 使用合理的搜索条件避免请求过多
   - 如果频繁失败，可能需要更换 IP 或等待一段时间

4. **数据准确性**：商品信息可能因页面结构变化而提取不准确，如遇到问题请检查并更新选择器逻辑。

5. **Webhook 可用性**：确保 Webhook 地址可访问，否则通知会失败但不影响监控任务的继续运行。

## 示例配置

监控价格 20000 元以上的摩托车，每 30 分钟扫描一次：

```json
{
  "search_keyword": "摩托车",
  "price_min": 20000,
  "price_max": null,
  "time_range": "1hour",
  "sort_type": "newest",
  "cron_expression": "0 */30 * * * *",
  "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
  "is_active": true
}
```

## 许可证

MIT
