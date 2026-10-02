# Android 1.5.0 验证记录

1.5.0 APK 已完成构建及静态打包检查。`deviceExecutionTested=false`：没有连接安卓真机，本次未下载或启动模拟器。

## 已完成

- `MainActivity.java` 使用现有便携 JDK、Android API 36 独立编译通过。
- 静态检查确认 `exportBackup` / `importBackup`、`commitSave`、`getRecovery` / `setRecovery` JavaScript 桥接口存在。
- 文件导入导出使用系统文档选择器及 ContentResolver，UTF-8 读写在后台执行器完成；上限 200000 字符。导入仅派发文本事件，不调用存档写入。
- 回调经 JSONObject.quote 和 JSON.parse 安全传递；后台事件延迟送达，Activity 销毁后忽略回调，重建中断流程作为取消处理。
- 当前存档与恢复点分别位于原 `pulse_runner` SharedPreferences 的 `save` / `recovery` 键，各限 65536 字符。同步提交失败时尝试回滚，同时保持桥接口读取的旧值。
- 保留 WebView 资源来源隔离；Manifest 仍只有震动权限，没有新增存储或网络权限。
- 发布元数据为 `com.pulserunner.game`、版本 1.5.0、versionCode 6，最低 API 24、目标 API 36。
- 构建与源码打包脚本语法检查通过，预期包含全部 19 个网页资源。
- 已记录并核对 v1.0 至 v1.4 的 10 个既有 APK/源码包及原签名密钥哈希，均未改变。

## 最终 APK

- 文件：`dist/PulseRunner-1.5.0.apk`；大小 104257 字节。
- SHA-256：`821532175bf011b95f44b3d91c301a5cf97b7f1526d4368b5785ad285cf3c8a6`。
- Java / Android API 36 发布编译通过；签名检查确认 v2、v3 方案有效，ZIP 对齐验证通过。
- 包名、版本 1.5.0 / code 6、最低 API 24、目标 API 36 和唯一震动权限均符合预期。
- 全部 19 个网页资源与 APK `assets/` 逐字节一致，入口已加载 controls.js、backup.js、comfort.css。
- 机器可读记录：`dist/android-verification-1.5.0.json`。
- 原证书 SHA-256：`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`。新包沿用原证书。
- 构建前后密钥 SHA-256 均为 `1801b030d317fe178a8c8c1937475dcda7a0059df8c3ef5d9b1cdaceecf6e9ea`。

以下 10 个历史产物在构建前后哈希一致：

| 文件 | SHA-256 |
|---|---|
| `PulseRunner-1.0.0.apk` | `3b16892e892172afe735acf957db215bb18b2da01c1e118c21fc67ecbb469f3b` |
| `PulseRunner-1.0.0-source.zip` | `94a6eb5e3c6426baeae44ffa72bf550832852660a38be90c55f5464135469831` |
| `PulseRunner-1.1.0.apk` | `0d010199763c9dea7f62004e17a9c195b452dc43ee89c4927d5d0d1c81df7c23` |
| `PulseRunner-1.1.0-source.zip` | `9983ff1ca899f7f4f277fca935207859fd208042b35610ba149d4fc780d679ea` |
| `PulseRunner-1.2.0.apk` | `170651b7ed8980e56dc7045206b1977afa81d5b0537910ecf34e8f8e23b70f9d` |
| `PulseRunner-1.2.0-source.zip` | `8d5ff666997698e47dda83ead4184295ac3c710c6b5a88630f1ca541324668df` |
| `PulseRunner-1.3.0.apk` | `4cebd7b54cfd92fb73736c025acb4357ac7da4e18e215762ad0385c14592f43b` |
| `PulseRunner-1.3.0-source.zip` | `02044b7098f241e6d083efb22f9ae842c5940867fb0e1f7856de95514cf6e277` |
| `PulseRunner-1.4.0.apk` | `3eb945ddf4eec25ec8def9f3f3954bdf98c4b92fe9f5a43bb2eea6a358933fd0` |
| `PulseRunner-1.4.0-source.zip` | `30c8b0481405d944e3b6105a45b196e5aa21ebf0480134fbd91be0399d0ee364` |

浏览器 QA 与最终说明文档已完成，完整源码 ZIP 在资源冻结后封包；打包时再次校验 APK 资源、版本和源码一致。源码包包含最终测试、文档和 6 张 v1.5 正式截图，排除签名私钥、下载工具链、构建中间文件及临时失败截图。

系统文档选择器、原生提交失败路径和设备覆盖升级目前只有代码审查及编译检查，尚未进行安卓设备实测。网页交互和原生桥模拟测试由浏览器 QA 单独记录，不代表安卓设备运行验证。
