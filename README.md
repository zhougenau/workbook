# 词屿 · 本地单词本

面向手机与电脑的本地优先单词本。数据首先写入浏览器 IndexedDB；配置 Supabase 后，可以使用邮箱 Magic Link 登录并跨浏览器同步。

## 已实现

- 新增单词、释义和学习笔记，自动记录添加时间
- 智能分析粘贴文本，自动提取单词、中文释义和例句并填入表单
- 顶部可选择 Merriam-Webster、Cambridge、Bing 词典或爱词霸 iciba，默认使用 Merriam-Webster，选择会保存在当前设备
- 已收录单词可一键打开所选在线词典，查看音标、词性、详细释义和更多例句
- 登录后可勾选单词，由 DeepSeek V4 Flash 生成 5–10 道分级四选一复习题，即时评分并显示本次输入、输出和总 Token 用量
- 0–5 级掌握度管理，默认值为 0
- 搜索、掌握度筛选和多种排序方式
- 编辑、删除、学习统计
- JSON 备份导入和导出
- Dexie/IndexedDB 离线数据库，自动迁移旧版 `localStorage` 数据
- Supabase Auth、PostgreSQL 云同步和用户级 RLS 权限
- 页头实时显示当前日期和时间，适配手机与电脑布局
- 响应式手机/电脑界面、PWA 安装信息和离线缓存

## GitHub 仓库

- 仓库地址：[zhougenau/workbook](https://github.com/zhougenau/workbook)
- 默认分支：`main`
- 克隆地址：`https://github.com/zhougenau/workbook.git`

## Vercel 部署

- Vercel 项目：[fredzhou-5516/workbook](https://vercel.com/fredzhou-5516/workbook)
- 生产站点：[打开词屿](https://workbook-fredzhou-5516.vercel.app)
- 部署分支：`main`
- Framework Preset：`Vite`
- Build Command：`npm run build`
- Output Directory：`dist`

Vercel 已连接 GitHub 仓库。推送到 `main` 后会自动创建新的 Production Deployment，其他分支和 Pull Request 会生成 Preview Deployment。

在 Vercel 项目的 `Settings → Environment Variables` 中配置以下变量，并为 Production、Preview 和 Development 环境选择所需范围：

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-publishable-key
```

当前生产部署启用了 Vercel Authentication，未登录 Vercel 的访客会跳转到 SSO 页面。要让手机和其他用户直接访问，请在 `Settings → Deployment Protection` 中关闭 Production 环境的访问保护，或按需配置允许访问的身份。

发布新域名后，还需要将 `https://<your-vercel-domain>/**` 加入 Supabase `Authentication → URL Configuration → Redirect URLs`。Google 和 Microsoft Provider 继续使用 Supabase 显示的 `https://<project-ref>.supabase.co/auth/v1/callback` 作为 OAuth Callback URL。

## 本地运行

首次从 GitHub 获取项目：

```powershell
git clone https://github.com/zhougenau/workbook.git
cd workbook
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。生产构建使用：

```powershell
npm run build
npm run preview
```

清除浏览器站点数据会删除本地词条；迁移设备或清理浏览器前，请先使用页面右上角的导出按钮创建 JSON 备份。

## 智能分析文本

在“记下新单词”的“智能选取”框中粘贴包含单词、词性、音标、中文释义和例句的文字，然后点击“智能分析”。应用会自动填写单词、释义和例句字段；释义只截取中文内容，不保留英文词性、音标或英文解释。分析完成后可以修改各字段，确认无误再点击“收录单词”写入数据库。

示例输入：

```text
convivial adj.
/kənˈvɪviəl/欢乐友好的（聚会）
**e.g.** The dinner had a *convivial* atmosphere, full of laughter and toasts.
```

分析结果：

```text
单词：convivial
释义：欢乐友好的（聚会）
例句：The dinner had a *convivial* atmosphere, full of laughter and toasts.
```

## 网络解释引擎

页面顶部可以选择 Merriam-Webster、Cambridge、Bing 词典或爱词霸 iciba。默认使用 Merriam-Webster，当前选择保存在浏览器本地；点击已收录单词旁的外部链接按钮，会在新标签页打开所选词典。

- Merriam-Webster：`https://www.merriam-webster.com/dictionary/<word>`
- Cambridge：`https://dictionary.cambridge.org/dictionary/english/<word>`
- Bing 词典：`https://www.bing.com/dict/search?q=<word>`
- 爱词霸 iciba：`https://www.iciba.com/word?w=<word>`

例如，选择 Merriam-Webster 查询 `apple` 时会打开 `https://www.merriam-webster.com/dictionary/apple`；选择爱词霸时会打开 `https://www.iciba.com/word?w=apple`。

## 开启跨浏览器同步

1. 在 Supabase 创建项目。
2. 打开项目的 SQL Editor，执行 `supabase/schema.sql`。
3. 在 Authentication 的 URL Configuration 中，将本地和正式站点地址加入 Redirect URLs，例如 `http://127.0.0.1:5173/**`。
4. 复制 `.env.example` 为 `.env.local`，填写项目 URL 和 Publishable/Anon Key。
5. 重启开发服务器，点击页面右上角的“同步”，输入邮箱并打开收到的登录链接。

```text
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-publishable-key
```

不要把 Supabase `service_role` 密钥放入前端环境变量。客户端只能使用 Publishable Key 或旧版 Anon Key，数据访问由 `schema.sql` 中的 RLS 策略保护。

### 配置 DeepSeek AI 复习

AI 复习采用服务端调用：浏览器只把所选词条 ID、题目数量和难度发给 Supabase Edge Function；函数验证当前 Supabase 用户，通过 RLS 读取该用户的已同步词条，再调用 `deepseek-v4-flash`。DeepSeek API Key 不会下发到浏览器。

先进入 wordbook 项目根目录，再登录并关联 Supabase 项目，然后部署函数：

```powershell
cd C:\Users\xzhou11\Downloads\ai_sysdebug_agent\demo\wordbook
npx supabase login
npx supabase link --project-ref gvgztuwklhlhzorcoouh
$secureKey = Read-Host "DeepSeek API Key" -AsSecureString
$plainKey = [Net.NetworkCredential]::new('', $secureKey).Password
npx supabase secrets set "DEEPSEEK_API_KEY=$plainKey"
Remove-Variable secureKey, plainKey
npx supabase functions deploy generate-review
```

函数控制台：[`generate-review`](https://supabase.com/dashboard/project/gvgztuwklhlhzorcoouh/functions)。部署时出现 `WARNING: Docker is not running` 可以忽略；Docker 只用于本地运行 Edge Function，不影响远程部署。若提示 `Entrypoint path does not exist`，说明命令不在 wordbook 项目根目录执行，请先运行上面的 `cd` 命令。

以上 PowerShell 写法不会把真实 Key 写入命令历史或项目文件。不要创建 `VITE_DEEPSEEK_API_KEY`，也不要把 Key 放入 `.env.local`、GitHub 或 Vercel 前端环境变量；它只能保存在 Supabase Secrets 中。部署成功时 CLI 会显示 `Deployed Functions.`。

使用时先登录，在单词库点击“AI 复习”，勾选 1–20 个单词，选择 5–10 道题及难度后生成。应用会先同步所选词条；未登录、未同步或不属于当前用户的词条不会被函数读取。

答题页和结果页会显示本次 DeepSeek 调用的输入、输出及总 Token 数。若模型首次返回无效题目并触发自动重试，页面显示的是两次调用的累计用量；这里只显示 Token 数量，不包含 API Key 或其他敏感信息。

### 配置 Google 登录

1. 在 Google Cloud Console 创建或选择项目，打开 `APIs & Services → OAuth consent screen`，配置应用名称与测试用户。
2. 在 `Credentials` 中创建 `OAuth client ID`，应用类型选择 `Web application`。
3. 将 `http://127.0.0.1:5173` 加入 Authorized JavaScript origins。
4. 将 Supabase Dashboard 的 `Authentication → Providers → Google` 页面显示的 Callback URL 加入 Authorized redirect URIs。格式通常为 `https://<project-ref>.supabase.co/auth/v1/callback`。
5. 把 Google Client ID 和 Client Secret 填入 Supabase 的 Google Provider 设置并启用 Provider。
6. 确保 Supabase `Authentication → URL Configuration` 的 Redirect URLs 包含 `http://127.0.0.1:5173/**`，重启本地应用后点击“使用 Google 登录”。

Google Client Secret 只配置在 Supabase Dashboard，不要写入 `.env.local` 或前端代码。OAuth 登录成功后仍使用 Supabase `user.id`，现有 RLS 和同步表无需修改。

### 配置 Microsoft 登录

1. 打开 Azure Portal，进入 `Microsoft Entra ID → App registrations → New registration`。
2. 根据用户范围选择 Supported account types：个人项目可选择同时支持组织账户和个人 Microsoft 账户；企业内部应用可选择单租户。
3. Redirect URI 类型选择 `Web`，填入 Supabase Auth 回调地址：`https://<project-ref>.supabase.co/auth/v1/callback`。
4. 注册完成后，复制 `Application (client) ID`。
5. 进入 `Certificates & secrets → Client secrets → New client secret`。创建后立即复制 **Value**，不要复制 Secret ID。
6. 在 Supabase Dashboard 打开 `Authentication → Providers → Azure (Microsoft)`，填入 Client ID 和 Client Secret 并启用。
7. 多租户和个人账户通常保留默认 Azure Tenant URL `https://login.microsoftonline.com/common`；企业单租户可改为 `https://login.microsoftonline.com/<tenant-id>`。
8. 确保 Supabase `Authentication → URL Configuration` 的 Redirect URLs 包含本地地址 `http://127.0.0.1:5173/**` 和正式站点地址。

前端使用 Supabase 的 `azure` Provider 并请求必需的 `email` scope。Microsoft Client Secret 仅保存在 Supabase Dashboard，不要放进 `.env.local`。请记录 Secret 的到期时间，过期前需要在 Entra ID 创建新 Secret 并更新 Supabase 配置。

### Email rate limit exceeded

这是 Supabase Auth 邮件服务的发送限流，不是单词同步失败。先检查邮箱和垃圾邮件目录，并使用最近收到的有效 Magic Link，不要连续点击发送按钮。应用会在每次请求后等待 60 秒才允许再次发送，但 Supabase 免费内置邮件服务还可能有更长的项目级配额窗口；已触发时需要等待 Supabase 恢复配额。

开发阶段可以在 Supabase Dashboard 的 Authentication 日志中确认 429 错误。正式部署时，应在 `Authentication → Email → SMTP Settings` 配置自己的 SMTP 服务，并根据服务商额度设置 Supabase Auth Rate Limits；不要尝试在前端绕过服务端限流。

## Vite 开发说明

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
