# Pocket Wordbook

面向 FoloToy AI Passport 的单词阅读器。开机直接进入离线阅读页，仅手动同步今日词单时启动无线服务，不启用 AI 服务或音频。

## 今日词单（无线原型）

1. 长按 OK 开始同步。首次配网时，在手机 Espressif ESP BLE Provisioning 中选择屏上的 `PROV_` 设备，输入本次 PoP，配置 2.4 GHz Wi-Fi。设备保存 Wi-Fi 设置；长按下键会重新配网。此流程不是 BLUFI 小程序协议。
2. 首次联网后，在已关联网页账号的微信小程序中打开“今日词单 → 扫码绑定 Passport”，扫描设备屏幕上的二维码。此后网页和小程序均只需输入设备显示的 4 位数字（包括开头的 0）。不要分享绑定二维码或配网密码。
3. 设备在两分钟内自动领取。校验成功后标题显示 `TODAY`，上下键换词、OK 翻页；长按上键返回内置书库。今日词单仅在 RAM 中，重启恢复内置书库进度。校验失败时保留先前词单。

新版需应用 `20261126000200_passport_binding.sql` 并部署 `passport-bound`。一个账号绑定一台设备。确认码仅用于已登录账号发布；设备用保存在 NVS 的随机密钥通过 HTTPS 领取，二维码不含该密钥。两分钟内最多尝试五次，成功领取一次后失效。再次长按 OK 开始新会话。下载只接受 16 KiB 以内的 WBP1 词包；不读写 `storage`、`cardid` 或分区表。

## 阅读

- 上键：上一词；下键：下一词；首尾不循环。
- OK：循环浏览当前词的内容页。词头固定，释义和笔记按实际字体度量分页。
- 右上角显示电量；读取不可用时显示 `--`。
- 闲置一分钟后背光从 75% 降至 15%，按键操作恢复；本版未实现自动休眠。
- 停止操作约 1 秒后保存词条 ID 和内容页码；突然断电可能丢失最后 1 秒的操作。
- 保存失败显示 `SAVE ERROR` 并重试；NVS 不可用显示 `SAVE OFF`，不会自动擦除任何 NVS。

## 词库

默认使用 [小型示例词库](assets/wordbook/sample.c)。个人备份只在本地转换：

```text
node tools/wordbook.cjs prepare /path/to/wordbook-backup.json
```

输出位于 Git 忽略的 `build/wordbook/`，包括设备 C 数据及审计记录。生成过程不修改输入文件，只保留 ID、单词、释义和笔记，不保留账号和同步元数据。删除状态的记录跳过；重复 ID、重复词头、无效字符或超长数据会被拒绝。

第一版支持最多 10,000 条词，每个词头最多 32 个 ASCII 字符，允许英语字母、空格、撇号和连字符；每条单词、释义、笔记合计不超过 2,048 个 UTF-8 字节。所有新词库都必须重新检查字体覆盖。

当前转换规则：空释义且词头为 `d` 的异常项排除并记录；清理释义中的空括号；统一换行，其他内容不改写。不会擅自修复例句或把中文笔记自动识别为译文。词库不存在时构建使用示例，不会假称包含个人词库。

## 字体

使用 Adobe Source Han Sans SC Regular，SIL OFL 1.1；16 px、4 bpp、未压缩。源文件与许可证放在同一目录，转换器固定 `lv_font_conv` 1.5.3：

```text
node tools/wordbook.cjs font /path/to/SourceHanSansSC-Regular.otf /path/to/lv_font_conv.js
node tools/wordbook.cjs check
```

工具校验源字体哈希，收集当前词库、界面提示和可打印 ASCII，生成字体并检查实际 cmap；缺字直接失败，不会通过关闭占位框隐藏问题。字体记录见 [资源说明](assets/README.zh_CN.md)。

## 验证与本地构建

需要 ESP-IDF 5.5.3、Node.js 20+ 和主机 C 编译器：

```bash
./tools/validate.sh --static
./tools/validate.sh
```

完整入口检查仓库、工作流、主机逻辑、字体及固件布局，保留 `build/firmware/<full-image-sha256>/` 的匹配固件和调试资料。桌面实际 LVGL 全词库布局测试位于 `tests/wordbook_lvgl/`，需要构建已下载的 `managed_components/lvgl__lvgl`；使用 CMake 配置并构建 `test_wordbook_layout` 后运行。它与设备字体相同，但不能证明物理屏幕效果。

## 烧录与隐私

**构建不代表允许烧录。此应用的设备更新约束是保留现有 Bootloader、分区表及其他数据分区。** 不使用完整镜像从 `0x0` 覆盖，不执行全片擦除。取得本次烧录授权并核对设备当前应用分区后，仅将已验证的应用镜像写入对应起始地址。

当前 `partitions.csv` 未修改；最终应用仍须适合设备实际应用分区。个人词库和笔记会包含在本地固件、ELF 和归档中，不要提交、上传或公开这些文件。原始备份应保存在工程之外。

Build、Host tests、Device tests 分开报告。中文字形、真实屏幕裁切、按键手感、断电恢复和运行时内存需要实机验收，编译和桌面测试不能替代。