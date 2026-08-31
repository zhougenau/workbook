# 词屿 · 本地单词本

面向手机与电脑的本地优先单词本。数据首先写入浏览器 IndexedDB；配置 Supabase 后，可以使用邮箱 Magic Link 登录并跨浏览器同步。

## 已实现

- 新增单词、释义和学习笔记，自动记录添加时间
- 0–5 级掌握度管理，默认值为 0
- 搜索、掌握度筛选和多种排序方式
- 编辑、删除、学习统计
- JSON 备份导入和导出
- Dexie/IndexedDB 离线数据库，自动迁移旧版 `localStorage` 数据
- Supabase Auth、PostgreSQL 云同步和用户级 RLS 权限
- 响应式手机/电脑界面、PWA 安装信息和离线缓存

## 本地运行

```powershell
npm install
npm run dev
```

打开 `http://127.0.0.1:5173/`。生产构建使用：

```powershell
npm run build
npm run preview
```

清除浏览器站点数据会删除本地词条；迁移设备或清理浏览器前，请先使用页面右上角的导出按钮创建 JSON 备份。

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
