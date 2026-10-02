# Android 1.4.0 构建验证

本记录仅证明 APK 构建和静态打包检查通过。`deviceExecutionTested=false`：当前没有连接安卓真机，未进行安卓设备安装、覆盖升级或触控实测；本次未下载或启动模拟器。

## 当前安装包

- 文件：`dist/PulseRunner-1.4.0.apk`
- 大小：83587 字节。
- SHA-256：`3eb945ddf4eec25ec8def9f3f3954bdf98c4b92fe9f5a43bb2eea6a358933fd0`。
- 包名：`com.pulserunner.game`；版本 `1.4.0`，versionCode `5`。
- 最低 API 24，目标 API 36；唯一权限为 `android.permission.VIBRATE`。
- Java / Android API 36 编译通过；APK 签名验证、ZIP 对齐验证通过。签名检查确认 v2、v3 方案有效。
- 全部 16 个 `web/` 文件已逐字节与 APK 中的 `assets/` 对比一致，包含新增回放、奖励、存档模块及收藏样式。
- 详细机器可读报告：`dist/android-verification-1.4.0.json`。

## 覆盖安装与历史产物

原签名证书 SHA-256：`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`。本次 APK 与原版同证书；构建前后签名密钥文件 SHA-256 均为 `1801b030d317fe178a8c8c1937475dcda7a0059df8c3ef5d9b1cdaceecf6e9ea`。保留原包名并递增版本号，具备覆盖升级所需的静态条件；尚未经安卓设备实测升级。

以下八个历史产物在本次构建前后哈希一致：

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

浏览器 QA 与文档已完成，源码 ZIP 在最终资源冻结后单独生成；打包脚本再次验证当前 APK 中的网页资源与源码一致。源码包包含最终测试、说明文档、验证报告和界面截图，排除下载的工具链、Android 构建中间文件、签名私钥及临时失败截图。
