param([switch]$Bootstrap, [switch]$CreateDevelopmentKey)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolRoot = Join-Path $projectRoot 'tools'
$manifestPath = Join-Path $PSScriptRoot 'AndroidManifest.xml'
[xml]$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8
$androidNamespace = 'http://schemas.android.com/apk/res/android'
$version = $manifest.manifest.GetAttribute('versionName', $androidNamespace)
$versionCode = [int]$manifest.manifest.GetAttribute('versionCode', $androidNamespace)
if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$' -or $versionCode -lt 1) { throw 'Invalid Android versionName or versionCode.' }
$packageMetadata = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($packageMetadata.version -ne $version) { throw 'package.json version must match AndroidManifest.xml versionName.' }
$apkName = "PulseRunner-$version.apk"
$apkRelativePath = "../dist/$apkName"
$expectedUpgradeCertificate = '1367fee5f58e70bad562bf0ad47394b58a570c482d397b8e63578e380d0b7088'
# Password values are supplied only through task-specific process environment variables.
# Tool arguments contain variable names, never the credential values.
if ([string]::IsNullOrEmpty($env:PULSE_RUNNER_STORE_PASSWORD) -or [string]::IsNullOrEmpty($env:PULSE_RUNNER_KEY_PASSWORD)) {
    throw 'Set PULSE_RUNNER_STORE_PASSWORD and PULSE_RUNNER_KEY_PASSWORD before building.'
}
if ($Bootstrap) {
    & python (Join-Path $toolRoot 'bootstrap-android.py')
    if ($LASTEXITCODE -ne 0) { throw 'Toolchain setup failed.' }
}
$jdk = Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin\javac.exe') } | Select-Object -First 1
if (-not $jdk) { throw 'Portable JDK missing. Run python tools/bootstrap-android.py, or build.ps1 -Bootstrap.' }
$java = Join-Path $jdk.FullName 'bin\java.exe'
$javac = Join-Path $jdk.FullName 'bin\javac.exe'
$jar = Join-Path $jdk.FullName 'bin\jar.exe'
$keytool = Join-Path $jdk.FullName 'bin\keytool.exe'
$buildTools = Join-Path $toolRoot 'sdk\build-tools\android-16'
$androidJar = Join-Path $toolRoot 'sdk\platforms\android-36\android.jar'
$webRoot = Join-Path $projectRoot 'web'
$requiredInputs = @($androidJar, (Join-Path $buildTools 'aapt2.exe')) + @('index.html', 'style.css', 'game.js', 'engine.js', 'levels.js', 'audio.js', 'renderer.js', 'upgrade.css', 'challenges.js', 'progression.css', 'expedition.js', 'expedition.css', 'replay.js', 'rewards.js', 'profile.js', 'collection.css', 'controls.js', 'backup.js', 'comfort.css' | ForEach-Object { Join-Path $webRoot $_ })
foreach ($required in $requiredInputs) {
    if (-not (Test-Path -LiteralPath $required)) { throw "Required build input missing: $required" }
}
$indexHtml = Get-Content -LiteralPath (Join-Path $webRoot 'index.html') -Raw -Encoding UTF8
if ($indexHtml -notmatch '(?i)<script\b[^>]*\bsrc\s*=\s*["'']challenges\.js(?:\?[^"'']*)?["'']' -or $indexHtml -notmatch '(?i)<link\b[^>]*\bhref\s*=\s*["'']progression\.css(?:\?[^"'']*)?["'']') { throw 'index.html must load challenges.js and progression.css.' }
if ($indexHtml -notmatch '(?i)<script\b[^>]*\bsrc\s*=\s*["'']expedition\.js(?:\?[^"'']*)?["'']' -or $indexHtml -notmatch '(?i)<link\b[^>]*\bhref\s*=\s*["'']expedition\.css(?:\?[^"'']*)?["'']') { throw 'index.html must load expedition.js and expedition.css.' }
foreach ($module in @('replay.js', 'rewards.js', 'profile.js', 'controls.js', 'backup.js')) {
    if ($indexHtml -notmatch ('(?i)<script\b[^>]*\bsrc\s*=\s*["'']' + [regex]::Escape($module) + '(?:\?[^"'']*)?["'']')) { throw "index.html must load $module." }
}
if ($indexHtml -notmatch '(?i)<link\b[^>]*\bhref\s*=\s*["'']collection\.css(?:\?[^"'']*)?["'']') { throw 'index.html must load collection.css.' }
if ($indexHtml -notmatch '(?i)<link\b[^>]*\bhref\s*=\s*["'']comfort\.css(?:\?[^"'']*)?["'']') { throw 'index.html must load comfort.css.' }

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    Push-Location -LiteralPath $PSScriptRoot
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
}

$buildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'build'))
if (-not $buildRoot.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to clean a path outside this project.' }
if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
$classes = Join-Path $buildRoot 'classes'
$generated = Join-Path $buildRoot 'generated'
$dex = Join-Path $buildRoot 'dex'
$output = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $buildRoot,$classes,$generated,$dex,$output | Out-Null
$compiledResources = Join-Path $buildRoot 'resources.zip'
$unsigned = Join-Path $buildRoot 'unsigned.apk'
$aligned = Join-Path $buildRoot 'aligned.apk'
$apk = Join-Path $output $apkName
Write-Output 'Compiling resources and bundling the offline game...'
# AAPT2 and zipalign on Windows require relative arguments when ancestor paths contain Chinese characters.
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('compile', '--dir', 'res', '-o', 'build/resources.zip')
Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('link', '-o', 'build/unsigned.apk', '--manifest', 'AndroidManifest.xml', '-I', '../tools/sdk/platforms/android-36/android.jar', '--java', 'build/generated', '--min-sdk-version', '24', '--target-sdk-version', '36', '-A', '../web', 'build/resources.zip')
$sources = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'src'),$generated -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
Invoke-Checked $javac (@('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-bootclasspath', $androidJar, '-d', $classes) + $sources)
$classesJar = Join-Path $buildRoot 'classes.jar'
Invoke-Checked $jar @('cf', $classesJar, '-C', $classes, '.')
Invoke-Checked $java @('-cp', (Join-Path $buildTools 'lib\d8.jar'), 'com.android.tools.r8.D8', '--lib', $androidJar, '--min-api', '24', '--release', '--output', $dex, $classesJar)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($unsigned, [IO.Compression.ZipArchiveMode]::Update)
try {
    Get-ChildItem -LiteralPath $dex -Filter '*.dex' | ForEach-Object {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $_.Name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-f', '-P', '16', '4', 'build/unsigned.apk', 'build/aligned.apk')
$signing = Join-Path $PSScriptRoot 'signing'
$keystore = Join-Path $signing 'local-development.jks'
New-Item -ItemType Directory -Force -Path $signing | Out-Null
if (-not (Test-Path -LiteralPath $keystore)) {
    if (-not $CreateDevelopmentKey) { throw 'The signing key is missing. Restore your own key, or use -CreateDevelopmentKey once for a separately signed fresh installation.' }
    if ($env:PULSE_RUNNER_STORE_PASSWORD.Length -lt 6 -or $env:PULSE_RUNNER_KEY_PASSWORD.Length -lt 6) {
        throw 'New JKS passwords must each contain at least six characters.'
    }
    Write-Output 'Generating this project''s local development signing key...'
    Invoke-Checked $keytool @('-genkeypair', '-keystore', $keystore, '-storetype', 'JKS', '-storepass:env', 'PULSE_RUNNER_STORE_PASSWORD', '-keypass:env', 'PULSE_RUNNER_KEY_PASSWORD', '-alias', 'pulse-runner', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Pulse Runner Local, O=Local Development, C=CN')
}
$keystoreHashBefore = (Get-FileHash -LiteralPath $keystore -Algorithm SHA256).Hash.ToLowerInvariant()
$certificateInfo = (Invoke-Checked $keytool @('-J-Duser.language=en', '-J-Duser.country=US', '-list', '-v', '-keystore', $keystore, '-storepass:env', 'PULSE_RUNNER_STORE_PASSWORD', '-alias', 'pulse-runner')) -join "`n"
$keyCertificate = [regex]::Match($certificateInfo, 'SHA256:\s*([A-Fa-f0-9:]+)').Groups[1].Value.Replace(':', '').ToLowerInvariant()
if ($keyCertificate.Length -ne 64) { throw 'Could not read the signing certificate fingerprint.' }
if ($keyCertificate -ne $expectedUpgradeCertificate) { Write-Output 'Using an independent signing certificate. This APK cannot update the original release.' }
Write-Output 'Signing and verifying the installable APK...'
$apksigner = Join-Path $buildTools 'lib\apksigner.jar'
Invoke-Checked $java @('-jar', $apksigner, 'sign', '--ks', $keystore, '--ks-key-alias', 'pulse-runner', '--ks-pass', 'env:PULSE_RUNNER_STORE_PASSWORD', '--key-pass', 'env:PULSE_RUNNER_KEY_PASSWORD', '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false', '--out', $apk, $aligned)
$signatureInfo = (Invoke-Checked $java @('-jar', $apksigner, 'verify', '--verbose', '--print-certs', $apk)) -join "`n"
Write-Output $signatureInfo
$signedCertificate = [regex]::Match($signatureInfo, 'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]+)').Groups[1].Value.ToLowerInvariant()
if ($signedCertificate -ne $keyCertificate) { throw 'Signed APK certificate does not match the selected key.' }
$keystoreHashAfter = (Get-FileHash -LiteralPath $keystore -Algorithm SHA256).Hash.ToLowerInvariant()
if ($keystoreHashBefore -ne $keystoreHashAfter) { throw 'Signing keystore changed during the build.' }
Invoke-Checked (Join-Path $buildTools 'zipalign.exe') @('-c', '-P', '16', '4', $apkRelativePath)
$badging = (Invoke-Checked (Join-Path $buildTools 'aapt2.exe') @('dump', 'badging', $apkRelativePath)) -join "`n"
if ($badging -notmatch "minSdkVersion:'24'" -or $badging -notmatch "targetSdkVersion:'36'" -or $badging -notmatch "package: name='com.pulserunner.game'") { throw 'Unexpected APK package or SDK configuration.' }
if ($badging -notmatch ("versionCode='" + $versionCode + "'") -or $badging -notmatch ("versionName='" + [regex]::Escape($version) + "'")) { throw 'Packaged version does not match AndroidManifest.xml.' }
$permissions = @([regex]::Matches($badging, "uses-permission: name='([^']+)'") | ForEach-Object { $_.Groups[1].Value })
if ($permissions.Count -ne 1 -or $permissions[0] -ne 'android.permission.VIBRATE') { throw 'Unexpected APK permissions.' }
$assetReport = @()
$verifiedZip = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    foreach ($assetFile in (Get-ChildItem -LiteralPath $webRoot -File -Recurse)) {
        $relativeAsset = $assetFile.FullName.Substring($webRoot.Length + 1).Replace('\', '/')
        $assetEntry = $verifiedZip.GetEntry('assets/' + $relativeAsset)
        if (-not $assetEntry) { throw "APK is missing asset $relativeAsset" }
        $memory = New-Object IO.MemoryStream
        $stream = $assetEntry.Open()
        try { $stream.CopyTo($memory) } finally { $stream.Dispose() }
        $embedded = [Convert]::ToBase64String($memory.ToArray())
        $memory.Dispose()
        if ($embedded -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($assetFile.FullName))) { throw "APK asset does not match its source: $relativeAsset" }
        $assetReport += @{ file = $relativeAsset; bytes = $assetFile.Length; matchesSource = $true }
    }
} finally { $verifiedZip.Dispose() }
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output "$apkName.sha256"), "$hash  $apkName`n", (New-Object Text.UTF8Encoding($false)))
$report = @{ apk = $apkName; version = $version; versionCode = $versionCode; sha256 = $hash; bytes = (Get-Item -LiteralPath $apk).Length; package = 'com.pulserunner.game'; minSdk = 24; targetSdk = 36; permissions = $permissions; signatureVerified = $true; certificateSha256 = $signedCertificate; originalReleaseCertificateSha256 = $expectedUpgradeCertificate; sameCertificateAsOriginal = ($signedCertificate -eq $expectedUpgradeCertificate); signingKeySha256Before = $keystoreHashBefore; signingKeySha256After = $keystoreHashAfter; signingKeyUnchanged = $true; zipAlignmentVerified = $true; assets = $assetReport; deviceExecutionTested = $false; deviceExecutionNote = 'This build script validates packaging only. See README-android.md for device verification status.' } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $output "android-verification-$version.json"), $report, (New-Object Text.UTF8Encoding($false)))
Write-Output "APK ready: $apk"
Write-Output "SHA-256: $hash"
