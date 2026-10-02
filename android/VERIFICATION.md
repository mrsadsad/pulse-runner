# Android 1.0.0 构建验证归档

本文记录原版 1.0.0。后续版本见 [VERIFICATION-1.1.0.md](VERIFICATION-1.1.0.md)、[VERIFICATION-1.2.0.md](VERIFICATION-1.2.0.md) 和 [VERIFICATION-1.3.0.md](VERIFICATION-1.3.0.md)。

- APK：`dist/PulseRunner-1.0.0.apk`，41,916 字节。
- SHA-256：`3b16892e892172afe735acf957db215bb18b2da01c1e118c21fc67ecbb469f3b`。
- 包名：`com.pulserunner.game`；显示名称：脉冲穿行；版本：1.0.0（versionCode 1）。
- AAPT2 读取成品确认：minSdk 24（Android 7.0），targetSdk / compileSdk 36（Android 16）。
- 唯一权限：`android.permission.VIBRATE`；没有 INTERNET 权限。
- `apksigner verify --verbose --print-certs`：通过，APK Signature Scheme v2 / v3 有效，RSA 2048 位本地开发签名。证书 SHA-256：`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`。
- `zipalign -c -P 16 4`：通过。APK 没有原生 `.so` 库，使用系统 WebView。

成品 APK 的以下资源均与当前源码逐字节一致：

| 资源 | 字节数 | 核对结果 |
| --- | ---: | --- |
| `assets/engine.js` | 4,828 | 一致 |
| `assets/game.js` | 32,049 | 一致 |
| `assets/index.html` | 6,165 | 一致 |
| `assets/levels.js` | 9,783 | 一致 |
| `assets/style.css` | 13,143 | 一致 |

`android/build.ps1` 每次构建都会重新检查五个必需输入文件、签名、对齐、包名、系统版本、权限和全部内置资源，并生成 `dist/android-verification.json`。重新构建后 APK 哈希可能随归档时间变化，应以新生成的 JSON 和 `.sha256` 为准。

安卓设备运行验证未完成：没有连接真机；已下载并校验官方 Android Emulator 37.2.10 / Android 16 x86_64 系统镜像，主机 WHPX 检查通过，但首次启动以及关闭 Vulkan 后的一次重试均停在系统引导、尚无可用 ADB 设备的阶段。因此没有执行实际安卓 APK 安装或游戏运行。已停止本次创建的模拟器进程，不更改 Windows 虚拟化设置。网页层的玩法和浏览器验证见项目主说明与 `qa/`。
