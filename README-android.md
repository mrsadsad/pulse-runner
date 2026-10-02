# 脉冲穿行 Android 安装包

`dist/PulseRunner-1.5.1.apk` 是可以直接安装的 APK。将它传到安卓手机，点开安装，并按手机提示允许当前文件管理器安装此来源的应用。需要 Android 7.0（API 24）及以上，并使用已更新的 Android System WebView；游戏触控操作依赖现代 WebView 的支持。1.5.1 在首页和设置页加入作者署名 `made in yongchao`。

游戏完全离线，APK 内置 HTML、Canvas 游戏和全部资源。机关试炼、无限生存、每日挑战、失败回放与个人最佳影子均使用本地游戏逻辑。已有成就自动解锁机体和尾迹收藏，外观不会改变碰撞或能力数值。1.5 新增手机操作配置和存档迁移：通过系统文档选择器导出、导入 JSON 备份。应用没有联网、相册、联系人或存储权限，唯一权限仍是震动反馈；文件选择器仅授权访问本次选择的文档。应用包名 `com.pulserunner.game`，版本 `1.5.1`（versionCode 7），编译和目标 API 均为 36。采用本地开发密钥签名、关闭应用调试；这是用于直接安装体验的开发交付，尚未提交应用商店审核。

已安装 1.0.0 至 1.5.0 的手机直接覆盖安装 1.5.1 即可；新包沿用原包名和同一签名证书，进度与设置仍存于原应用私有目录。不要先卸载旧版，因为卸载会清除本地进度。全部旧版 APK 和源码 ZIP 仍保存在 `dist/`。换手机前先导出备份文件，再在新安装的游戏里选择该文件并确认导入；本地恢复点也会随卸载清除。

## 从源码重新构建（Windows）

公开源码不包含签名私钥或口令。构建使用两个专用环境变量：`PULSE_RUNNER_STORE_PASSWORD`（密钥库口令）和 `PULSE_RUNNER_KEY_PASSWORD`（私钥口令）。脚本通过 keytool / apksigner 的环境变量参数读取凭据，不把口令值写入命令行参数或验证报告。

首次克隆后，在项目目录运行以下 PowerShell 命令。请自行设置口令；创建 JKS 时两项口令均至少 6 个字符：

```powershell
python tools/bootstrap-android.py
$pulseStoreSecret = Read-Host 'Keystore password' -AsSecureString
$pulseKeySecret = Read-Host 'Private key password' -AsSecureString
$env:PULSE_RUNNER_STORE_PASSWORD = [System.Net.NetworkCredential]::new('', $pulseStoreSecret).Password
$env:PULSE_RUNNER_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $pulseKeySecret).Password
try {
    powershell -NoProfile -ExecutionPolicy Bypass -File android/build.ps1 -CreateDevelopmentKey
} finally {
    Remove-Item Env:PULSE_RUNNER_STORE_PASSWORD, Env:PULSE_RUNNER_KEY_PASSWORD -ErrorAction SilentlyContinue
    Remove-Variable pulseStoreSecret, pulseKeySecret -ErrorAction SilentlyContinue
}
```

已有 `tools/jdk` 和 `tools/sdk` 时无需重复下载。第一次生成的开发密钥保存在 `android/signing/local-development.jks`，别名为 `pulse-runner`。后续构建继续设置相同的两个环境变量，并运行 `android/build.ps1`，无需再传 `-CreateDevelopmentKey`。脚本不会替换已有密钥；即使带上该开关，也只会在密钥文件不存在时创建新文件。密钥缺失且未显式指定创建开关，或者环境变量缺失时，构建会停止。

**新克隆生成的开发密钥不能覆盖安装原版 APK。** 新包可以使用自己的证书正常构建，证书指纹仅用于报告是否与原版相同。只有原版发布者持有的原签名密钥才能构建原版应用的覆盖更新。请妥善保管自己生成的密钥与口令，以便后续更新自己签名的安装；不要把凭据或密钥提交到 Git。

构建脚本直接使用官方 AAPT2、Java 编译器、D8、zipalign 和 apksigner，无需 Android Studio、Gradle 或全局环境变量。输出签名 APK 和 SHA-256 文件，并读取当前 `web/` 内容。APK 文件名从 `AndroidManifest.xml` 读取版本，源码 ZIP 文件名从 `package.json` 读取版本，两处版本必须一致。

`tools/bootstrap-android.py` 把 SDK 与便携式 Microsoft OpenJDK 17 下载到本项目的 `tools/`，并核对固定版本的校验值。不一致时脚本会停止。Android SDK 校验值来自 Google 官方仓库索引，JDK SHA-256 来自[微软官方下载页](https://learn.microsoft.com/en-us/java/openjdk/download)。下载文件和工具链不应提交源码仓库。

原版签名证书 SHA-256（公开指纹，不是私钥）：`1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088`。口令读取方式见 [keytool 环境变量参数](https://docs.oracle.com/en/java/javase/17/docs/specs/man/keytool.html) 和 [apksigner 签名参数](https://developer.android.com/tools/apksigner)。

连接开启 USB 调试的安卓设备后可运行：

```powershell
tools/sdk/platform-tools/adb.exe install -r dist/PulseRunner-1.5.1.apk
tools/sdk/platform-tools/adb.exe shell am start -n com.pulserunner.game/.MainActivity
```

## Android 容器与接口

- `MainActivity` 使用竖屏、沉浸全屏和硬件加速，并对屏幕缺口添加安全边距。安卓大屏设备可能由系统忽略竖屏限制，游戏页面本身负责响应布局。
- WebView 以 `https://appassets.androidplatform.net/assets/index.html` 作为稳定本地来源，通过请求拦截从 APK 读取文件；阻止其他来源、文件访问和网络加载。
- `NativeGame.getSave()` / `NativeGame.setSave(json)` 使用应用私有 SharedPreferences，供网页保存进度与设置；卸载应用会清除进度。
- `NativeGame.commitSave(json)` 同步提交当前存档并返回布尔结果，`getRecovery()` / `setRecovery(json)` 读写独立的导入前恢复点；两类原始存档均限 65536 字符。提交失败时保持桥接口可见的旧值，并尝试回滚 SharedPreferences 内存和磁盘内容。`setRecovery('')` 清空恢复点，不修改当前存档。
- `NativeGame.exportBackup(json)` 启动系统 `ACTION_CREATE_DOCUMENT`，默认文件名为 `PulseRunner-backup-YYYYMMDD.json`；`importBackup()` 使用 `ACTION_OPEN_DOCUMENT` 选择备份文件。UTF-8 读写在后台线程完成，文件内容限 200000 字符；同一时刻仅处理一个文件请求，不持有长期文档访问权限。
- 文件流程通过 `window` 上的 `nativeBackup` 自定义事件报告 `{kind:'export'|'import', status:'ok'|'cancel'|'error', text?, message?}`。导入只向网页回传文本，网页负责校验、预览及确认后的存档事务；原生文件读取不会直接改变存档。事件内容经 JSON 字符串转义，不把文件文本作为脚本执行。
- Activity 销毁时取消待处理任务并忽略后续回调，后台期间完成的事件延后至恢复前台送达；系统重建中断的文件选择流程作为取消处理，用户可重新选择。
- `NativeGame.vibrate(milliseconds)` 提供最多 180 毫秒的震动；`NativeGame.exit()` 关闭当前游戏。
- `window` 接收 `nativePause`、`nativeResume`、`nativeBack` 事件。失去焦点或进入后台触发暂停；游戏自行决定是否显示继续按钮。

官方说明：[系统文档选择器](https://developer.android.com/training/data-storage/shared/documents-files)、[SharedPreferences 提交](https://developer.android.com/reference/android/content/SharedPreferences.Editor#commit())、[AAPT2](https://developer.android.com/tools/aapt2)、[apksigner](https://developer.android.com/tools/apksigner)、[zipalign](https://developer.android.com/tools/zipalign)、[Android 16 SDK](https://developer.android.com/about/versions/16/setup-sdk)。

## 本次验证范围

1.5.1 仅调整作者署名和发布版本；原生代码与 1.5.0 最终源码包一致。已通过发布编译、签名、ZIP 对齐、包名/版本/API/权限检查，全部 19 个资源与源码逐字节一致，APK 首页和设置脚本中的署名正确。旧版 12 个发布产物及签名密钥哈希未改变。结果见 `dist/android-verification-1.5.1.json` 和 [android/VERIFICATION-1.5.1.md](android/VERIFICATION-1.5.1.md)。历史验证结果保持原样。

当前没有连接安卓真机；先前本机 Android 16 模拟器在系统启动阶段停滞，尚未进入 ADB 可安装状态，因此未完成安卓设备安装运行验证。本次 1.5.1 不重新下载或启动模拟器。系统文件选择器、原生存档提交、触控和覆盖升级尚未进行安卓设备实测；`deviceExecutionTested=false`。网页玩法与布局的测试记录见项目主说明。
