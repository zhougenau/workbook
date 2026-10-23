# 词屿微信小程序

与仓库根目录 Web 应用同属一个 Git 仓库的微信小程序客户端。Web 应用继续独立运行；小程序采用本地 Storage，并通过 Supabase Edge Functions 接入微信身份和后续云同步。

## 当前功能

- 本地新增、编辑、删除和搜索单词；编辑后自动排队同步
- 词库中每个单词可点按朗读单词和英文例句；没有英文例句时只朗读单词
- 按掌握度快速筛选，并按添加时间、字母或掌握度排序
- 与 Web 一致的 10/20/50 条分页、首页/上下页/末页导航
- 词库只读显示 0–5 级熟练度，在编辑词条时调整
- 从粘贴文本智能提取单词、中文释义和英文例句
- 微信登录后输入新单词，AI 自动补全空白的中文释义和英文例句；不会覆盖手写内容或智能选取结果，需部署 `complete-word` Edge Function
- Supabase `mini-health` 连通性检查
- `wx.login` 客户端流程与 `wechat-login` Edge Function
- 本地优先的 Supabase 双向词条同步
- 基于更新时间的冲突合并与软删除墓碑
- Web 与微信账号一次性绑定码及词库合并
- 使用所选词汇生成 DeepSeek AI 英文短文和中文译文
- 在每条词目旁直接打开 AI 对话，使用 DeepSeek 或通义千问连续学习词义、例句和记忆方法
- 在每条词目旁直接启动 5 道基础 AI 测试，沿用复习题的答题反馈和熟练度更新
- 使用所选词汇生成可交互的 AI 四选一复习题
- AI 复习可切换“真实语境”，练习场景选词、搭配填空并查看易混词对比；需部署更新后的 `generate-review` Edge Function
- 使用所选词汇或随机抽取 10、20、50 个词生成 AI 学习卡片，并从末张直接开始测试
- 通过腾讯云 TTS 朗读学习卡片的单词和英文用法
- 版本化本地 Storage，字段与 Web 端词条模型兼容

微信登录成功后会自动同步，也可以在页面中手动点击“同步”。Web 与小程序使用同一张词条表；绑定后两端共享同一个逻辑 owner 和同一份词库。

## 运行

小程序的纯逻辑来自 `../../packages/core`。首次运行或修改共享规则后，在仓库根目录先构建：

```powershell
npm install
npm --prefix packages/core test
```

构建会自动刷新 `vendor/wordbook-core.js`，无需在小程序内安装 npm 包。

使用微信开发者工具导入：

```text
<仓库根目录>\apps\mini
```

AppID：

```text
wxd82ac079b0929d02
```

开发期 `urlCheck` 被关闭，以便验证 Supabase 原始域名。体验版和正式版发布前必须配置 request 合法域名并恢复校验。

## 完成微信登录服务配置

### 1. 创建数据库表

打开 Supabase Dashboard 的 SQL Editor，依次执行：

```text
supabase/migrations/20261014000100_create_wechat_identity.sql
supabase/migrations/20261014000200_add_shared_owners.sql
supabase/migrations/20261014000300_add_account_linking.sql
```

本机 CLI 到 PostgreSQL pooler 可能超时，因此使用 SQL Editor 更稳定。

### 2. 配置微信 AppSecret

从微信公众平台获取 AppSecret，然后在 Supabase Dashboard 中进入：

```text
Project Settings → Edge Functions → Secrets
```

新增：

```text
WECHAT_APP_SECRET=<微信小程序 AppSecret>
```

`WECHAT_APP_ID` 已配置为 `wxd82ac079b0929d02`。不要把 AppSecret 写入仓库、小程序代码、聊天消息或命令历史。

### 3. 验证

重新打开小程序，依次点击：

1. `检测`：应显示 Supabase 连接正常。
2. `连接`：应显示微信身份连接成功，并在本地保存 30 天会话。
3. `同步`：应将本地词条上传，并拉取该微信身份的云端词条。

### 4. 绑定 Web 账号

1. 登录 Web 词屿，在云同步区域点击“绑定微信”。
2. Web 端会显示一个有效期为 10 分钟的一次性 `XXXX-XXXX` 绑定码。
3. 在已连接微信身份的小程序中输入该绑定码，点击“绑定并合并”。
4. 服务端会在一个事务内迁移微信词条、按更新时间合并同名单词，并把微信身份切换到 Web owner。
5. 小程序会立即同步；此后 Web 与小程序读写同一份词库。

绑定码只能使用一次。若过期或已使用，请在 Web 端重新生成。

### 5. 使用 AI 学习

在 AI 学习工坊选择 DeepSeek 或通义千问，选择会保存在当前小程序设备上；通义千问需要先在 Supabase Secrets 中设置 `DASHSCOPE_API_KEY` 并部署 AI 函数。未配置时会提示错误，不会静默切换。

1. 在“我的词库”长按词条进入选择模式，该词会自动选中；继续勾选其他词条，单次最多选择 10 个。点击“完成”收起复选框并保留所选词。
2. 在“AI 学习工坊”选择短文长度，然后点击“生成短文”；结果包含英文正文、中文译文和实际使用的目标词。
3. 在复习难度下选择随机卡片数量（默认 10，可选 20 或 50），再点击“生成卡片”；有勾选时使用所选词，没有勾选时随机抽取所设数量，词库不足时使用全部词。卡片包含释义、英文用法、同反义词和记忆方法，最后一张可直接开始 AI 测试。
4. 选择复习难度并点击“生成复习题”；每次显示一道题。答对后停留 2 秒展示解析并自动进入下一题，答错后手动继续。
5. 完成整轮后，小程序使用与 Web 相同的难度/题型权重累计 evidence；达到 `+1.75` 或 `-1.75` 时熟练度升降一级，每轮最多调整一级，并自动保存、排队同步。

AI 调用前会先同步词库。Edge Function 同时支持 Web JWT 和小程序 Mini session，但只会读取当前逻辑 owner 的有效词条；DeepSeek API Key 不会下发到小程序。

AI 学习工坊展开后显示登录 owner 的当日文本 token 与语音字符实际用量、累计预留，以及文本/语音分别最近 1 分钟的请求数和当前并发限制；支持刷新，AI 请求结束后自动更新。日期按 UTC 计算。卡片语音由最多 2 个后台 worker 并行预生成，短暂的限流/并发不足会等待重试，日额度耗尽则停止重试。提高语音限额时，先在 Supabase Web SQL Editor 手动执行 `supabase/migrations/20261019000100_separate_speech_budget.sql`，再重新部署 `generate-speech` 和 `paid-usage` Edge Functions 并发布新版小程序；不要用数据库 CLI 执行迁移。

### 6. 配置腾讯云发音

卡片发音使用腾讯云基础语音合成 `TextToVoice`。小程序只接收 Base64 MP3；TC3 签名和云密钥只存在 `generate-speech` Edge Function。

1. 在腾讯云控制台开通语音合成，并确认账号有可用额度。
2. 创建独立 CAM 子用户及 API 密钥，不要使用主账号密钥。自定义策略只授予 `tts:TextToVoice`，资源为 `*`。
3. 在本机 PowerShell 执行以下命令，按提示直接输入 SecretId 和 SecretKey。输入内容不会显示，也不会写入命令历史：

```powershell
cd <仓库根目录>
$secureId = Read-Host "Tencent Cloud SecretId" -AsSecureString
$secureKey = Read-Host "Tencent Cloud SecretKey" -AsSecureString
$plainId = [Net.NetworkCredential]::new('', $secureId).Password
$plainKey = [Net.NetworkCredential]::new('', $secureKey).Password
npx supabase secrets set "TENCENT_TTS_SECRET_ID=$plainId" "TENCENT_TTS_SECRET_KEY=$plainKey"
Remove-Variable secureId, secureKey, plainId, plainKey
```

`generate-speech` 已部署；Secrets 保存后无需重新部署。默认使用英文男声 WeJack (`101050`)、16 kHz MP3。需要更换音色时可设置可选 Secret，例如英文女声 WeWinny：

```powershell
npx supabase secrets set "TENCENT_TTS_VOICE_TYPE=501009" "TENCENT_TTS_REGION=ap-guangzhou"
```

重新打开小程序，在词库点击单词旁的发音按钮；学习卡片生成后及切换卡片时会自动朗读，也可以点击“发音”重新朗读。词库的英文例句取自词条的笔记字段；纯中文笔记不朗读。词库和卡片共用语速选择（慢 0.8× / 正常 1× / 快 1.25×），设置保存在本机，切速不会再次调用云端合成。首次朗读会请求云端，当前小程序会话内再次朗读相同内容会复用缓存；切换卡片会停止上一张的播放，关闭卡片或退出页面会停止播放。播放器调速需微信基础库 2.11.0 或更高版本。

## 安全边界

- 小程序不包含 Supabase Service Role Key。
- 微信 AppSecret 只存在 Supabase Secrets。
- 腾讯云 SecretId 和 SecretKey 只存在 Supabase Secrets。
- `openid` 仅保存在服务端，不返回客户端。
- 客户端会话使用 256 位随机令牌；数据库只保存 SHA-256 哈希。
- 身份表与会话表启用 RLS，并撤销 anon/authenticated 的直接权限。
