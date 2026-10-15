# @wordbook/core

词屿 Web 与微信小程序共享的纯逻辑包，不依赖 React、微信 API、Supabase 或浏览器存储。

## 共享内容

- 词汇文本解析与标准化
- 词条数据类型、边界值和同步校验
- 文本搜索、掌握度过滤与添加时间等排序规则
- AI 复习 evidence 与熟练度调整
- AI 卡片响应校验、随机选词与导航边界
- 按 `updatedAt` 合并及重复词墓碑规则
- 页码钳制、列表切片与显示区间计算

平台相关的 UI、身份认证、网络请求和本地存储继续留在各客户端。

## 开发

```powershell
npm install
npm test
```

`npm test` 会先执行双格式构建，再运行契约测试。构建产物包括：

- `dist/index.js`：Web 使用的 ESM
- `dist/index.cjs`：Node/CommonJS
- `../../apps/mini/vendor/wordbook-core.js`：微信小程序使用的 CommonJS 副本

修改核心规则后运行 `npm test`。Web 的 `dev` 和 `build` 脚本也会先构建此包并刷新小程序副本。
