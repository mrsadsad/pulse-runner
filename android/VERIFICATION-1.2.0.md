# Android 1.2.0 构建验证

- APK：`dist/PulseRunner-1.2.0.apk`，62,719 字节。
- SHA-256：`170651b7ed8980e56dc7045206b1977afa81d5b0537910ecf34e8f8e23b70f9d`。
- 包名：`com.pulserunner.game`；显示名称：脉冲穿行；版本：1.2.0（versionCode 3）。
- 成品 Manifest 确认 minSdk 24（Android 7.0），targetSdk / compileSdk 36（Android 16）；唯一权限仍为 `android.permission.VIBRATE`，没有 INTERNET 权限。
- `apksigner verify --verbose --print-certs` 通过；APK v2 / v3 签名有效，RSA 2048 位。
- `zipalign -c -P 16 4` 通过；全部 10 个网页资源逐字节匹配当前源码。
- 入口页面已加载 `challenges.js` 和 `progression.css`；镜像、疾速、每日挑战、成就与挑战码均由本地网页实现，无新增原生权限。

## 原版覆盖升级

1.0.0、1.1.0 与 1.2.0 使用同一包名和签名证书，versionCode 依次为 1、2、3。签名证书 SHA-256 均为：

`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`

原签名文件 `android/signing/local-development.jks` 在此次构建前后 SHA-256 均为：

`1801b030d317fe178a8c8c1937475dcda7a0059df8c3ef5d9b1cdaceecf6e9ea`

因此新包具备覆盖旧版安装的签名与版本条件，原有应用私有存储路径保持不变。应直接覆盖安装以保留进度，不要先卸载。安卓设备上的实际覆盖安装尚未实测。

四个历史交付文件保持不变：

| 文件 | SHA-256 |
| --- | --- |
| `PulseRunner-1.0.0.apk` | `3b16892e892172afe735acf957db215bb18b2da01c1e118c21fc67ecbb469f3b` |
| `PulseRunner-1.0.0-source.zip` | `94a6eb5e3c6426baeae44ffa72bf550832852660a38be90c55f5464135469831` |
| `PulseRunner-1.1.0.apk` | `0d010199763c9dea7f62004e17a9c195b452dc43ee89c4927d5d0d1c81df7c23` |
| `PulseRunner-1.1.0-source.zip` | `9983ff1ca899f7f4f277fca935207859fd208042b35610ba149d4fc780d679ea` |

## 内置网页资源

| 资源 | 字节数 | 与源码核对 |
| --- | ---: | --- |
| `assets/audio.js` | 6,373 | 一致 |
| `assets/challenges.js` | 9,269 | 一致 |
| `assets/engine.js` | 12,397 | 一致 |
| `assets/game.js` | 35,769 | 一致 |
| `assets/index.html` | 10,094 | 一致 |
| `assets/levels.js` | 9,783 | 一致 |
| `assets/progression.css` | 5,372 | 一致 |
| `assets/renderer.js` | 16,720 | 一致 |
| `assets/style.css` | 13,143 | 一致 |
| `assets/upgrade.css` | 4,377 | 一致 |

`android/build.ps1` 从 Manifest 读取版本号，验证 10 个必需输入、新资源导入、签名证书与密钥连续性、权限、版本、对齐及全部内置资源，生成 `dist/android-verification-1.2.0.json` 和 APK `.sha256`。源码 ZIP 从 `package.json` 读取版本，重新核对 APK 资源与验证报告后生成，不包含签名私钥或下载工具链。

## 运行验证限制

本次未下载或启动模拟器，未进行 APK 真机运行或设备覆盖升级验证。网页层玩法、存档兼容性、挑战模式与画面检查见项目说明及 `qa/`。签名和资源检查不能替代安卓设备实测。
