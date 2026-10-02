# Android 1.1.0 构建验证

- APK：`dist/PulseRunner-1.1.0.apk`，50,297 字节。
- SHA-256：`0d010199763c9dea7f62004e17a9c195b452dc43ee89c4927d5d0d1c81df7c23`。
- 包名：`com.pulserunner.game`；显示名称：脉冲穿行；版本：1.1.0（versionCode 2）。
- 成品 Manifest 确认 minSdk 24（Android 7.0），targetSdk / compileSdk 36（Android 16）；唯一权限为 `android.permission.VIBRATE`。
- `apksigner verify --verbose --print-certs` 通过；APK v2 / v3 签名有效，RSA 2048 位。
- `zipalign -c -P 16 4` 通过；全部网页资源逐字节匹配当前源码。

## 原版覆盖升级

1.0.0 与 1.1.0 使用同一包名和签名证书，versionCode 从 1 递增至 2。签名证书 SHA-256 均为：

`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`

原签名文件 `android/signing/local-development.jks` 在此次构建前后 SHA-256 均为：

`1801b030d317fe178a8c8c1937475dcda7a0059df8c3ef5d9b1cdaceecf6e9ea`

因此新包具备覆盖原版安装的签名与版本条件，原有私有存储路径保持不变。直接覆盖安装即可保留本地进度；不要先卸载原版。安卓设备上的实际覆盖安装尚未实测。

原版产物保持不变：

| 原版文件 | SHA-256 |
| --- | --- |
| `PulseRunner-1.0.0.apk` | `3b16892e892172afe735acf957db215bb18b2da01c1e118c21fc67ecbb469f3b` |
| `PulseRunner-1.0.0-source.zip` | `94a6eb5e3c6426baeae44ffa72bf550832852660a38be90c55f5464135469831` |

## 内置网页资源

| 资源 | 字节数 | 与源码核对 |
| --- | ---: | --- |
| `assets/audio.js` | 6,373 | 一致 |
| `assets/engine.js` | 8,991 | 一致 |
| `assets/game.js` | 27,401 | 一致 |
| `assets/index.html` | 6,745 | 一致 |
| `assets/levels.js` | 9,783 | 一致 |
| `assets/renderer.js` | 16,720 | 一致 |
| `assets/style.css` | 13,143 | 一致 |
| `assets/upgrade.css` | 4,377 | 一致 |

`android/build.ps1` 从 Manifest 读取版本号，验证全部 8 个必需输入、签名证书与密钥连续性、权限、版本、对齐和全部内置资源，生成 `dist/android-verification-1.1.0.json` 及 APK `.sha256`。源码 ZIP 从 `package.json` 读取版本，重新核对所有 APK 资源与验证报告后生成，不包含私钥或下载工具链。

## 运行验证限制

本次 ADB 查询没有连接安卓设备；未重新下载或启动模拟器，未进行 APK 真机运行或设备覆盖升级验证。网页层已由主任务完成 149 项引擎、14 项浏览器和 14 项音频检查；具体测试范围及画面见项目说明和 `qa/`。签名与资源验证不能替代安卓设备实测。
