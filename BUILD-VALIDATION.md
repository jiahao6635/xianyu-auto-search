# 河北摩托车监控：安装与构建验收

2026-10-14，工作区副本基准 `edbce270acce1aeeb70ebdb4cc16658712f35d8d`。

## 实际通过

- 锁文件审查：固定版本与 integrity 哈希；未发现 Git/file/link/自定义 tarball 依赖。仓库 `.npmrc` 原有镜像和关闭完整性检查的设置，在本次安装命令中覆盖为官方 npm 注册表及开启完整性检查。
- 依赖安装成功，实际使用项目指定的 pnpm 9.0.0；`--frozen-lockfile --ignore-scripts --registry=https://registry.npmjs.org --verify-store-integrity=true`，缓存和包 store 放在工作区。安装生命周期脚本未运行，pnpm-lock.yaml 没有变化。
- 完整类型检查：`node node_modules/typescript/bin/tsc -p tsconfig.json --pretty false`，exit 0。
- 改动的 11 个源码文件 lint：exit 0，0 错误/警告。
- 全源码 lint：`node node_modules/eslint/bin/eslint.js src`，exit 0；5 条原有未使用变量警告，位于 configs 两个 API 和 relations.ts，没有为此修改无关代码。
- Next 生产构建：`node node_modules/next/dist/bin/next build --webpack`，exit 0；编译、类型检查、6 个静态页面生成及 build tracing 成功。页面 `/`、`/_not-found`、`/robots.txt` 生成，三个 API 路由保持动态。
- 服务端打包：`node node_modules/tsup/dist/cli-default.js src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify`，exit 0；生成 dist/server.js（约 59.65KB）。未启动此服务端文件。
- 24 项 Node 单元/边界测试通过；11 项模拟采集检查通过，包括河北全省成功、全省选项不存在拒绝、摘要为河北城市拒绝。
- `git diff --check` 通过。

## 发现并修复后重跑的失败

- 首次改动文件 lint 检出原环境加载器 require() 导入错误；改为 dotenv 的标准导入，并删除隐式云工作负载凭据获取，现只用用户明确配置的本地环境；重跑通过。
- 首次 Next 构建编译成功，但预渲染 `/_not-found` 失败，错误 `jsxDEV is not a function`。原 .babelrc 写死 development=true；移除写死的开发模式，交给 next/babel 按环境决定，重跑完整构建通过。
- 原 scripts/build.sh 会再次安装依赖、可能执行 lifecycle scripts，且使用 npx；已替换为单纯使用 pnpm exec next/tsup 的构建，不在构建时安装。

Next 的 Babel/SWC 提示与大文件代码生成提示没有影响最终构建；Node 的实验性 loader/strip-types 提示没有导致测试失败。

## 河北范围

新配置默认关键词摩托车、省份河北、城市/区县空。价格上下限为空且可配置，未擅自设预算。示例 `examples/hebei-motorcycle-config.json` 无 Cookie/webhook/浏览器目录且停用，未写真实配置。

省级采集要求明确点击“全河北”并确认筛选摘要是省级河北；如果网页不支持该选项、选成某城市或无法核对摘要，会抛错暂停，不退到全国/城市。只做了离线模拟，**未登录或访问真实闲鱼验证其省级筛选支持**。

## 未运行 / 待用户配置

- 未运行真实 PostgreSQL 迁移和 SQL 集成脚本；本机没有 PostgreSQL 测试实例，未创建数据库、凭据或连接真实 Supabase。
- 未登录闲鱼、读取已有 Cookie、访问真实商品数据或验证码；未发送飞书，未测试真实签名/限流/索引延迟。
- 构建验收未启动长任务或部署；独立分支提交与推送另按用户明确授权执行。
- 仍需用户审查迁移并在测试库验证，配置服务端权限、授权会话、价格范围和飞书接收端。普通 webhook 结果不确定保持 uncertain，由人工核对；不能保证端到端 exactly-once。

这轮没有自动审批拒绝或待决安装；短暂连接提示后各命令状态可读取，未重复安装依赖。未执行额外未知安装脚本。
