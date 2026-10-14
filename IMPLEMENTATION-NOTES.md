# 本地实现交付与验证边界

基准提交 `edbce270acce1aeeb70ebdb4cc16658712f35d8d`。代码仅在本任务副本修改；已获用户授权安装锁定依赖并禁用生命周期脚本；没有执行原仓库启动/安装脚本或迁移真实数据库、采集闲鱼、发 webhook、创建凭据或部署；提交与独立分支推送仅按后续明确授权执行。REA 未安装运行，父线程已核实它没有现成闲鱼适配。

## 完成范围

1. `monitor-frequency.ts` 统一 Cron 档位及显示，小时表达式修正到小时字段；旧 1/2/6 分钟值不自动更改，UI 与日志指出实际频率。自定义表达式保留。
2. `monitor-queue.ts` 同配置至多一个等待/运行任务，重复触发拒绝入队；定时、手动和出站处理共用队列键。
3. `monitor-scheduler.ts` 与手动 trigger 已统一入口；执行前重读启停配置，扫描结束和发送前重新核对条件，停用/修改条件后的旧扫描结果不继续推送。数据库扫描租约阻止多工作进程重复采集；租约到期后仍需要再次确认平台会话正常。
4. `collection-safety.ts` 和 scraper 初版检测可见验证/登录提示、已知验证 iframe/跳转与 goofish 401/403/429；必要搜索、地区、排序、价格控件失败关闭本轮。无明确空结果提示时，0 商品不建立基线。暂停持久写 `is_active=false`，停止扫描及发送 Cron，人工处理后在 UI 启用恢复。数据库暂停保存失败会明确报告，本地仍拦截。未增加解验证码、换号或换代理功能。
5. `monitor-outbox.ts` + `supabase-alter-monitor-outbox.sql` 实现首轮基线、稳定商品去重、持久入队/领取/确认、失败退避、重启恢复策略与人工核对。数据库事务保证 seen 与 outbox 同时提交。
6. **首轮默认只建基线**；既存监控升级后也先建立当前页面基线，不把存量全推送。旧 sent/fetched 历史仅迁入已见集合，不能作为刚上架证明。配置城市、价格、关键词、时间/排序变化后再建当前条件基线，并取消旧条件的 pending 队列。历史已见和事件保留；不会因改条件反复通知同一商品。
7. 事件 ID 固定 `xianyu:<config_id>:<product_id>`，每配置/商品唯一；不同配置之间会有独立事件。持久记录 `first_seen_at` 与 `platform_publish_time`（网页原文，可能为空），通知明确未知发布时间不能确认刚上架。`1hour` 文案已改为“最新（非严格 1 小时）”。
8. 每个商品一个出站事件，避免整批部分成功重发；保留已有飞书卡片渲染。发送前先写 sending/attempt_token；成功后 RPC 同一事务写 sent_products 兼容记录并确认 delivered。明确限流持久退避 60 秒起、最高 1 小时，并阻止同配置其他事件越过冷却。采集失败退避 30 秒起、最高 1 小时；发送队列每 30 秒检查，不重新采集商品来重试通知。
9. 超时、非明确成功响应、HTTP 5xx、进程丢失变为 uncertain，**不自动重发**。确认事务失败则保留 sending，租约到期转 uncertain；若事务成功但确认响应丢失，重启查询 delivered，不重发。明确业务拒绝分为 rate-limit 自动重试与 failed 人工检查。人工通过 RPC `monitor_reconcile` 明确选择 confirmed_delivered 或 retry_may_duplicate；后者可能重复，不自动调用。
10. 飞书发送 15 秒超时、拒绝重定向、必须明确业务码 0；可选 `FEISHU_BOT_SECRET` 环境变量签名。发送稳定 `Idempotency-Key` 仅供支持的接收端使用，**飞书端幂等未验证，不能保证端到端 exactly-once**。
11. SQL + Drizzle 新增 monitor_state、monitor_seen、monitor_outbox；新表开启 RLS，仅 service_role 可访问，RPC security invoker 且撤销 public/anon/authenticated 执行权限。应用明确要求用户自行配置服务端 `COZE_SUPABASE_SERVICE_ROLE_KEY`；没有读取或创建真实密钥。不能把此 key 放到 NEXT_PUBLIC 环境或前端。
12. `supabase-alter-sent-products-unique.sql` 准备旧表唯一索引；无历史删除。旧表已有重复会使该索引迁移失败，需要先人工核对。outbox 自身唯一约束/事务不依赖删除旧重复记录。

## 迁移和启用（本次未执行）

停止所有实例与定时器，备份并核对旧记录。先在可丢弃测试库应用 `supabase-alter-monitor-outbox.sql` 并运行 SQL 集成测试；新库先执行 supabase-init.sql，再执行 outbox 迁移。旧库另行审核 sent_products 唯一索引迁移；不要自动清理历史重复，也不要批量改旧 Cron。

用户需在本机服务端自行配置 `COZE_SUPABASE_URL`、`COZE_SUPABASE_SERVICE_ROLE_KEY`，并按项目现有界面配置目标城市、价格、用户授权会话和飞书 webhook。签名可用 `FEISHU_BOT_SECRET`。队列保存商品快照与发现时间，不保存 webhook token 或 Cookie；使用发送时最新且仍激活的配置地址。

升级首轮基线意味着升级停机期间已出现且仍在列表中的商品默认不会报警；这是防止存量洪泛的明确权衡。如需要回补，必须单独审查范围，不能假装“新上架”。更改筛选重新基线也有同样边界。不要删除状态库来恢复，否则会丢历史。

对 uncertain/failed 先看飞书群和 event_id、attempts、日志，再用人工受控 SQL：

```sql
-- 先只读核对（不要把 payload/敏感配置公开）
select event_id,status,attempts,last_error,created_at,delivered_at
from public.monitor_outbox where status in ('uncertain','failed') order by created_at;
-- 已确认收到才确认 delivered；未确认但决定接受重复风险才请求 retry_may_duplicate。
-- select public.monitor_reconcile('<事件ID>','confirmed_delivered');
-- select public.monitor_reconcile('<事件ID>','retry_may_duplicate');
```

## 实际已运行

- **24 项 Node 单元/边界测试通过**：7 档 Cron、旧频率与自定义值、重复入队/释放、排队状态检查契约、拒绝信号、飞书缺码失败、15 秒信号/拒绝重定向、前批成功后批失败、记账失败不重发、outbox 部分成功/新工作实例继续待发、超时 uncertain、DB 失败、DB 已提交但响应丢失、claim 失败不发、基线 RPC token/scope 参数、事件 ID/发现时间消息、HTTP500/429分类。
- **11 项模拟 scraper 安全检查通过**：正常页面、验证控件、登录跳转、地区 3 次失败、排序控件缺失、价格控件缺失、无明确空结果不建基线、明确空结果接受、河北全省选择/缺省级选项/错误城市摘要拒绝。加载器禁止真实浏览器/数据库连接。
- 10 个修改 TypeScript 文件通过 Node stripTypeScriptTypes 语法解析，`git diff --check` 通过。

执行命令（Node 22.23.1，无安装）：

```sh
node --experimental-strip-types --experimental-loader ./tests/scraper-stubs-loader.mjs --test tests/*.test.mjs
node --experimental-strip-types --experimental-loader ./tests/scraper-stubs-loader.mjs tests/scraper-safety.check.mjs
```

测试中的 Backend 是 RPC 边界存储替身，**不等于 PostgreSQL 实际事务验证**。源码里的 SQL 集成脚本 `tests/monitor-outbox.integration.sql` 包含真实基线、新发现/重复、租约、事务回滚、记账触发器失败、过期 claim 转 uncertain、持久冷却、条件变化及停用的断言，最后 rollback；**本机无 psql/测试数据库，未运行**。

## 未运行及剩余事项

- 完整类型检查、修改文件 lint、Next 生产构建与 tsup 服务端打包现已运行并通过，锁文件保持不变。依赖使用 pnpm 9.0.0 按 frozen lockfile 从官方 npm 注册表下载，开启完整性检查并禁用生命周期脚本；未运行 preinstall/依赖安装脚本。详细构建结果见 BUILD-VALIDATION.md。
- 默认新配置是“摩托车 / 河北全省”，价格上下限均可配置，示例为 examples/hebei-motorcycle-config.json（停用、无凭据）。采集必须明确点选全河北且结果摘要为河北省级范围，缺选项或摘要含城市会失败暂停；真实网页是否存在对应选项仍未验证，不能把 mock 验证说成真实支持。
- 修复原 Babel 开发模式被写死导致的生产 jsxDEV 预渲染错误；重写构建脚本移除重复安装/npx，使用已安装 pnpm exec 工具；环境加载器移除隐式云凭据获取，只读显式本地配置。
- SQL 迁移和集成测试未运行；不宣称数据库功能已在真实实例验证。服务端权限环境配置由用户完成，当前若缺失会停止监控路径。
- 真实闲鱼结构、正常筛选选中状态、验证码具体形式/阶段、搜索最新排序和索引延迟仍待验证；本轮选择器只覆盖已知可见信号，没有保证降低请求就解除风控。过长扫描超过 10 分钟租约需调节或加续租后再运行。
- 真实飞书签名/限流/投递没测试。30 秒出站轮询是服务端队列轮询，不代表闲鱼上架发现延迟；采集仍采用用户配置 Cron。
- 原配置 API 返回 Cookie/webhook 与旧表禁用 RLS 的部署问题尚未修复；新 outbox 不沿用公开权限。现状不要公网部署。无需真实秘密即可继续前述测试和审查。
