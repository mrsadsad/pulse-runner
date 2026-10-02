package com.pulserunner.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.DisplayCutout;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/** Offline-only application shell. Game logic and all assets ship inside this APK. */
public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final int EXPORT_BACKUP = 1501, IMPORT_BACKUP = 1502;
    private static final int MAX_BACKUP_CHARS = 200000, MAX_SAVE_CHARS = 65536;
    private WebView web;
    private FrameLayout frame;
    private boolean pageReady;
    private boolean background;
    private volatile boolean destroyed;
    // Picker state and event queue are only touched on the main thread.
    private String backupKind, backupExportText;
    private boolean backupProcessing;
    private int backupGeneration;
    private final ArrayDeque<String> backupEvents = new ArrayDeque<>();
    private final ExecutorService backupWorker = Executors.newSingleThreadExecutor();

    @Override @SuppressLint("SetJavaScriptEnabled")
    public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            String interrupted = state.getString("backupPending");
            if ("import".equals(interrupted) || "export".equals(interrupted)) {
                queueBackupEvent(interrupted, "cancel", null, "上次文件操作已中断，请重新选择文件。");
            }
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        frame = new FrameLayout(this);
        frame.setBackgroundColor(Color.rgb(16, 22, 21));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(16, 22, 21));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setTextZoom(100);
        if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new NativeBridge(), "NativeGame");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isAsset(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isAsset(Uri.parse(url));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serveAsset(request.getUrl());
            }
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = true;
                emit(background ? "nativePause" : "nativeResume");
                flushBackupEvents();
            }
        });
        frame.addView(web, new FrameLayout.LayoutParams(-1, -1));
        frame.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
          @Override public WindowInsets onApplyWindowInsets(View view, WindowInsets insets) {
            int left = 0, top = 0, right = 0, bottom = 0;
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = insets.getDisplayCutout();
                if (cutout != null) {
                    left = cutout.getSafeInsetLeft(); top = cutout.getSafeInsetTop();
                    right = cutout.getSafeInsetRight(); bottom = cutout.getSafeInsetBottom();
                }
            }
            frame.setPadding(left, top, right, bottom);
            return insets;
          }
        });
        setContentView(frame);
        immersive();
        web.loadUrl(ORIGIN + "/assets/index.html");
    }

    private boolean isAsset(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    private WebResourceResponse serveAsset(Uri uri) {
        if (!isAsset(uri)) return error(403, "Forbidden");
        String name = uri.getPath().substring("/assets/".length());
        if (name.isEmpty() || name.contains("..") || name.contains("\\") || name.indexOf('\0') >= 0) return error(404, "Not Found");
        try {
            InputStream stream = getAssets().open(name);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-cache");
            headers.put("X-Content-Type-Options", "nosniff");
            return new WebResourceResponse(mime(name), "UTF-8", 200, "OK", headers, stream);
        } catch (IOException ignored) { return error(404, "Not Found"); }
    }

    private WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, null, new ByteArrayInputStream(new byte[0]));
    }

    private String mime(String path) {
        String name = path.toLowerCase(Locale.ROOT);
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".mp3")) return "audio/mpeg";
        if (name.endsWith(".ogg")) return "audio/ogg";
        if (name.endsWith(".wav")) return "audio/wav";
        return "application/octet-stream";
    }

    private void emit(String event) {
        if (pageReady && web != null) web.evaluateJavascript("window.dispatchEvent(new Event('" + event + "'));", null);
    }

    private void queueBackupEvent(String kind, String status, String text, String message) {
        if (destroyed) return;
        JSONObject detail = new JSONObject();
        try {
            detail.put("kind", kind); detail.put("status", status);
            if (text != null) detail.put("text", text);
            if (message != null) detail.put("message", message);
        } catch (JSONException impossible) { return; }
        if (backupEvents.size() >= 8) backupEvents.removeFirst();
        backupEvents.addLast(detail.toString());
        flushBackupEvents();
    }

    private void flushBackupEvents() {
        if (!pageReady || web == null || background || destroyed) return;
        while (!backupEvents.isEmpty()) {
            // Serialize a JSON string, then parse it inside the fixed script.
            // No imported file contents are inserted as JavaScript source.
            String quoted = JSONObject.quote(backupEvents.removeFirst())
                .replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
            web.evaluateJavascript("window.dispatchEvent(new CustomEvent('nativeBackup',{detail:JSON.parse(" + quoted + ")}));", null);
        }
    }

    private void beginBackup(String kind, String json) {
        if (destroyed || isFinishing()) return;
        if (backupKind != null) {
            queueBackupEvent(kind, "error", null, "已有文件操作正在进行，请先完成或取消。");
            return;
        }
        boolean exporting = "export".equals(kind);
        if (exporting && (json == null || json.length() == 0 || json.length() > MAX_BACKUP_CHARS)) {
            queueBackupEvent(kind, "error", null, "备份内容为空或超过 200000 字符。");
            return;
        }
        backupKind = kind; backupExportText = exporting ? json : null;
        backupProcessing = false; backupGeneration++;
        Intent intent = new Intent(exporting ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(exporting ? "application/json" : "*/*");
        // A renamed JSON file can be reported as text/plain or octet-stream by
        // document providers. The web layer validates the actual content.
        if (exporting) intent.putExtra(Intent.EXTRA_TITLE, "PulseRunner-backup-"
            + new SimpleDateFormat("yyyyMMdd", Locale.US).format(new Date()) + ".json");
        try { startActivityForResult(intent, exporting ? EXPORT_BACKUP : IMPORT_BACKUP); }
        catch (RuntimeException unavailable) {
            completeBackup(backupGeneration, kind, "error", null, "无法打开系统文件选择器，请稍后重试。");
        }
    }

    private void completeBackup(int generation, String kind, String status, String text, String message) {
        if (destroyed || generation != backupGeneration || !kind.equals(backupKind)) return;
        backupKind = null; backupExportText = null; backupProcessing = false;
        queueBackupEvent(kind, status, text, message);
    }

    private static final class BackupTooLargeException extends IOException { }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != EXPORT_BACKUP && requestCode != IMPORT_BACKUP) return;
        final String kind = requestCode == EXPORT_BACKUP ? "export" : "import";
        if (destroyed || !kind.equals(backupKind) || backupProcessing) return;
        final int generation = backupGeneration;
        if (resultCode != RESULT_OK) {
            completeBackup(generation, kind, "cancel", null, "已取消文件操作。"); return;
        }
        final Uri uri = data == null ? null : data.getData();
        if (uri == null || !"content".equals(uri.getScheme())) {
            completeBackup(generation, kind, "error", null, "未获得可访问的文件，请重新选择。"); return;
        }
        final String exportText = backupExportText;
        backupProcessing = true;
        backupWorker.execute(new Runnable() { @Override public void run() {
            String status = "ok", text = null, message = null;
            try {
                if (destroyed || Thread.currentThread().isInterrupted()) return;
                if ("export".equals(kind)) {
                    OutputStream stream = getContentResolver().openOutputStream(uri, "wt");
                    if (stream == null) throw new IOException("No output stream");
                    try (BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(stream,
                            StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)))) {
                        writer.write(exportText);
                    }
                    message = "备份已导出。";
                } else {
                    InputStream stream = getContentResolver().openInputStream(uri);
                    if (stream == null) throw new IOException("No input stream");
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream,
                            StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                                .onUnmappableCharacter(CodingErrorAction.REPORT)))) {
                        StringBuilder result = new StringBuilder(); char[] buffer = new char[4096]; int count;
                        while ((count = reader.read(buffer)) != -1) {
                            if (destroyed || Thread.currentThread().isInterrupted()) return;
                            if (result.length() + count > MAX_BACKUP_CHARS) throw new BackupTooLargeException();
                            result.append(buffer, 0, count);
                        }
                        text = result.toString();
                    }
                }
            } catch (BackupTooLargeException tooLarge) {
                status = "error"; message = "文件过大，仅支持不超过 200000 字符的备份。";
            } catch (IOException | RuntimeException failed) {
                status = "error"; message = "export".equals(kind) ? "导出失败，请检查所选位置是否可写。" : "读取失败，请选择有效的 UTF-8 备份文件。";
            }
            final String resultStatus = status, resultText = text, resultMessage = message;
            if (!destroyed) runOnUiThread(new Runnable() { @Override public void run() {
                completeBackup(generation, kind, resultStatus, resultText, resultMessage);
            }});
        }});
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (backupKind != null) state.putString("backupPending", backupKind);
        super.onSaveInstanceState(state);
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }
    }

    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive(); else emit("nativePause");
    }

    @Override protected void onPause() {
        background = true;
        emit("nativePause");
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        background = false;
        if (web != null) { web.onResume(); emit("nativeResume"); }
        flushBackupEvents();
        immersive();
    }

    @Override public void onBackPressed() { emit("nativeBack"); }

    @Override protected void onDestroy() {
        destroyed = true; backupGeneration++; backupKind = null; backupExportText = null;
        backupEvents.clear(); backupWorker.shutdownNow(); pageReady = false;
        if (web != null) {
            frame.removeView(web);
            web.removeJavascriptInterface("NativeGame");
            web.destroy(); web = null;
        }
        super.onDestroy();
    }

    public final class NativeBridge {
        private final SharedPreferences prefs = getSharedPreferences("pulse_runner", MODE_PRIVATE);
        private final Object storageLock = new Object();
        private String visibleSave = prefs.getString("save", ""), visibleRecovery = prefs.getString("recovery", "");
        @JavascriptInterface public String getSave() { synchronized (storageLock) { return visibleSave; } }
        @JavascriptInterface public void setSave(String json) {
            if (json == null || json.length() > MAX_SAVE_CHARS || destroyed) return;
            synchronized (storageLock) {
                try { prefs.edit().putString("save", json).apply(); visibleSave = json; }
                catch (RuntimeException ignored) { }
            }
        }
        private boolean commitValue(String key, String json) {
            if (json == null || json.length() > MAX_SAVE_CHARS || destroyed) return false;
            synchronized (storageLock) {
                boolean recovery = "recovery".equals(key);
                String previous = recovery ? visibleRecovery : visibleSave;
                boolean committed = false;
                try { committed = prefs.edit().putString(key, json).commit(); }
                catch (RuntimeException ignored) { }
                if (!committed) {
                    // commit() may update SharedPreferences memory before disk
                    // failure. Restore both when possible and retain the old
                    // bridge-visible value even if storage remains unavailable.
                    try { prefs.edit().putString(key, previous).commit(); }
                    catch (RuntimeException ignored) { }
                    return false;
                }
                if (recovery) visibleRecovery = json; else visibleSave = json;
                return true;
            }
        }
        @JavascriptInterface public boolean commitSave(String json) { return commitValue("save", json); }
        @JavascriptInterface public String getRecovery() { synchronized (storageLock) { return visibleRecovery; } }
        @JavascriptInterface public boolean setRecovery(String json) { return commitValue("recovery", json); }
        @JavascriptInterface public void exportBackup(final String json) {
            if (!destroyed) runOnUiThread(new Runnable() { @Override public void run() { beginBackup("export", json); } });
        }
        @JavascriptInterface public void importBackup() {
            if (!destroyed) runOnUiThread(new Runnable() { @Override public void run() { beginBackup("import", null); } });
        }
        @JavascriptInterface public void vibrate(int milliseconds) {
            int length = Math.max(1, Math.min(milliseconds, 180));
            runOnUiThread(new Runnable() { @Override public void run() {
                try {
                    Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                    if (vibrator == null || !vibrator.hasVibrator()) return;
                    if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(length, VibrationEffect.DEFAULT_AMPLITUDE));
                    else vibrator.vibrate(length);
                } catch (RuntimeException ignored) { }
            }});
        }
        @JavascriptInterface public void exit() { runOnUiThread(new Runnable() { @Override public void run() { finish(); } }); }
    }
}
