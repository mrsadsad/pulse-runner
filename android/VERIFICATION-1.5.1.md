# Android 1.5.1 验证记录

本版在首页和设置页加入作者署名 `made in yongchao`，并递增发布版本；游戏逻辑、原生桥和存档接口保持上一版实现。

## 发布准备

- 已检查没有遗留的构建或打包进程。
- 修改版本前，MainActivity.java 与 AndroidManifest.xml 均与 1.5.0 最终源码 ZIP 逐字节一致。
- 既有 1.5.0 APK 重新验签通过，v2、v3 签名有效，仍为原证书。
- 本版 Manifest：`com.pulserunner.game`、版本 `1.5.1`、versionCode `7`；最低 API 24、目标 API 36，唯一权限仍为震动。
- 已记录 v1.0.0 至 v1.5.0 共 12 个旧版 APK/源码包及原签名密钥哈希，后续构建不会覆盖这些文件。
- 网页资源数量保持 19；源码打包规则会包含正式的新版本截图，排除临时失败截图、签名私钥及下载工具链。

## APK 构建结果

- 安装包：`dist/PulseRunner-1.5.1.apk`；大小 104257 字节。
- SHA-256：`b50dfbb11632459634d436533992f667c0d97e99e538fa9e6ff0a4ca040d271c`。
- Java / Android API 36 编译通过；v2、v3 签名有效，ZIP 对齐检查通过。
- 包名 `com.pulserunner.game`，版本 `1.5.1` / code `7`；最低 API 24、目标 API 36，唯一权限为震动。
- 全部 19 个网页资源与 APK 中的资源逐字节一致，首页和设置脚本均包含 `made in yongchao`。
- 原证书 SHA-256：`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`；新包与全部旧版沿用同一证书。
- 构建前后密钥 SHA-256 均为 `1801b030d317fe178a8c8c1937475dcda7a0059df8c3ef5d9b1cdaceecf6e9ea`。
- 机器可读报告：`dist/android-verification-1.5.1.json`。

以下 12 个既有发布文件在本次构建前后哈希一致：

| 文件 | SHA-256 |
|---|---|
| `PulseRunner-1.0.0-source.zip` | `94a6eb5e3c6426baeae44ffa72bf550832852660a38be90c55f5464135469831` |
| `PulseRunner-1.0.0.apk` | `3b16892e892172afe735acf957db215bb18b2da01c1e118c21fc67ecbb469f3b` |
| `PulseRunner-1.1.0-source.zip` | `9983ff1ca899f7f4f277fca935207859fd208042b35610ba149d4fc780d679ea` |
| `PulseRunner-1.1.0.apk` | `0d010199763c9dea7f62004e17a9c195b452dc43ee89c4927d5d0d1c81df7c23` |
| `PulseRunner-1.2.0-source.zip` | `8d5ff666997698e47dda83ead4184295ac3c710c6b5a88630f1ca541324668df` |
| `PulseRunner-1.2.0.apk` | `170651b7ed8980e56dc7045206b1977afa81d5b0537910ecf34e8f8e23b70f9d` |
| `PulseRunner-1.3.0-source.zip` | `02044b7098f241e6d083efb22f9ae842c5940867fb0e1f7856de95514cf6e277` |
| `PulseRunner-1.3.0.apk` | `4cebd7b54cfd92fb73736c025acb4357ac7da4e18e215762ad0385c14592f43b` |
| `PulseRunner-1.4.0-source.zip` | `30c8b0481405d944e3b6105a45b196e5aa21ebf0480134fbd91be0399d0ee364` |
| `PulseRunner-1.4.0.apk` | `3eb945ddf4eec25ec8def9f3f3954bdf98c4b92fe9f5a43bb2eea6a358933fd0` |
| `PulseRunner-1.5.0-source.zip` | `efb0bbe6e3a3d0930e28c4b3c3e702d20b82a116a6ce337fb035f82afb16cb1a` |
| `PulseRunner-1.5.0.apk` | `821532175bf011b95f44b3d91c301a5cf97b7f1526d4368b5785ad285cf3c8a6` |

本次已完成手机和桌面两种视口的署名、准备页、存档不变及零脚本错误检查，未重复执行上一版完整测试套件。源码 ZIP 在最终 QA 记录和 4 张署名截图完成后生成，并再次核对每个归档文件与当前源码一致。

`deviceExecutionTested=false`：没有连接安卓真机，本次不下载或启动模拟器。原生文件选择器、原生存档提交、触控和覆盖升级尚未进行安卓设备实测。
