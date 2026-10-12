package app.sessionswitcher.remote;

import android.annotation.SuppressLint;
import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationManager;
import android.content.DialogInterface;
import android.content.pm.PackageManager;
import android.os.PowerManager;
import android.provider.Settings;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.Log;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

/**
 * Thin WebView "remote" for the Session Switcher web app running on the user's PC.
 * The PC address is stored in SharedPreferences ("server"); pairing happens via the
 * server's /pair endpoint, which sets a long-lived auth cookie.
 */
public class MainActivity extends Activity {
    private static final String TAG = "SessionSwitcher";
    private static final String PREFS = "session_switcher";
    private static final String KEY_SERVER = "server";
    static final String CONNECT_URL = "file:///android_asset/connect.html";
    private static final String ASSET_PREFIX = "file:///android_asset/";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_NOTIFY = 1002;
    /** A notification opens the app on its chat. */
    static final String EXTRA_KEY = "open_key";
    static final String EXTRA_SESSION = "open_session";
    private static final String KEY_UPDATE_LATER = "update_later";
    private long updateCheckedAt = 0;
    /** Something shared to the app, waiting for the page to take it (JSON: text and pictures). */
    private volatile String pendingShare = null;

    private WebView webView;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> filePathCallback;
    /** A photo the camera is taking right now (it writes straight to this address). */
    private Uri pendingCapture;
    private File pendingCaptureFile;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF17100E);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setUserAgentString(s.getUserAgentString() + " SessionSwitcherAndroid/" + versionName());
        CaptureProvider.cleanOld(this);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());

        // Process death / fresh launch: just (re)load the start page (on a chat, from a notification).
        loadStart(openQuery(getIntent()));
        NotifyService.channels(this);
        takeShared(getIntent());
    }

    private void loadStart() { loadStart(""); }

    private void loadStart(String query) {
        String server = getServer();
        webView.loadUrl(server.isEmpty() ? CONNECT_URL : serverUrl(server) + query);
    }

    /** "?key=…" for a notification's chat, or "". */
    private static String openQuery(Intent i) {
        if (i == null) return "";
        String key = i.getStringExtra(EXTRA_KEY), sid = i.getStringExtra(EXTRA_SESSION);
        if (key != null && !key.isEmpty()) return "?key=" + Uri.encode(key);
        if (sid != null && !sid.isEmpty()) return "?chat=" + Uri.encode(sid);
        return "";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (takeShared(intent)) return;
        String key = intent.getStringExtra(EXTRA_KEY), sid = intent.getStringExtra(EXTRA_SESSION);
        if (webView == null || (key == null && sid == null)) return;
        String url = webView.getUrl();
        if (url != null && !getServer().isEmpty() && url.startsWith(serverUrl(getServer()))) {
            // Already open: go to the chat without reloading.
            webView.evaluateJavascript("(function(k,s){if(!window.ChatUI)return;if(k)ChatUI.openKey(k).catch(function(){if(s)ChatUI.open({sessionId:s});});else if(s)ChatUI.open({sessionId:s});})("
                    + JSONObject.quote(key == null ? "" : key) + "," + JSONObject.quote(sid == null ? "" : sid) + ")", null);
        } else {
            loadStart(openQuery(intent));
        }
    }

    private String versionName() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (PackageManager.NameNotFoundException e) { return "5"; }
    }

    @SuppressWarnings("deprecation")
    private int versionCode() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode; } catch (PackageManager.NameNotFoundException e) { return 0; }
    }

    /** The pairing cookie, for the notifications service (it talks to the PC without the page). */
    private void keepCookie() {
        String server = getServer();
        if (server.isEmpty()) return;
        String c = CookieManager.getInstance().getCookie(serverUrl(server));
        if (c != null && c.contains("sw_device=")) prefs.edit().putString(NotifyService.KEY_COOKIE, c).apply();
        if (NotifyService.isOn(this)) NotifyService.start(this);
    }

    // ---------------------------------------------------------------- share to the app
    // Text, a link or pictures shared from another app: read here (the permission to read them is
    // this activity's), then handed to the page, which asks which chat they go to.

    @SuppressWarnings("deprecation")
    private boolean takeShared(Intent intent) {
        if (intent == null) return false;
        final String a = intent.getAction();
        if (!Intent.ACTION_SEND.equals(a) && !Intent.ACTION_SEND_MULTIPLE.equals(a)) return false;
        final String text = intent.getStringExtra(Intent.EXTRA_TEXT), subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        final List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(a)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        }
        setIntent(new Intent(Intent.ACTION_MAIN));   // shared once, not again on a rotation
        new Thread(new Runnable() {
            @Override public void run() {
                JSONObject o = new JSONObject();
                JSONArray pics = new JSONArray();
                int skipped = 0;
                for (Uri u : uris) {
                    if (pics.length() >= 4) { skipped++; continue; }
                    try {
                        String type = getContentResolver().getType(u);
                        if (type == null || !type.matches("image/(png|jpeg|gif|webp)")) { skipped++; continue; }
                        InputStream in = getContentResolver().openInputStream(u);
                        if (in == null) { skipped++; continue; }
                        ByteArrayOutputStream buf = new ByteArrayOutputStream();
                        byte[] chunk = new byte[16384];
                        int n;
                        while ((n = in.read(chunk)) > 0 && buf.size() <= 5 * 1024 * 1024) buf.write(chunk, 0, n);
                        in.close();
                        if (buf.size() > 5 * 1024 * 1024) { skipped++; continue; }
                        JSONObject p = new JSONObject();
                        p.put("mediaType", type);
                        p.put("data", android.util.Base64.encodeToString(buf.toByteArray(), android.util.Base64.NO_WRAP));
                        pics.put(p);
                    } catch (Exception e) {
                        skipped++;
                    }
                }
                try {
                    String t = text == null ? "" : text.trim();
                    if (subject != null && !subject.trim().isEmpty() && !t.contains(subject.trim())) t = subject.trim() + (t.isEmpty() ? "" : "\n" + t);
                    o.put("text", t);
                    o.put("images", pics);
                    o.put("skipped", skipped);
                } catch (org.json.JSONException ignored) { }
                pendingShare = o.toString();
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (webView != null) webView.evaluateJavascript("window.onAndroidShare && window.onAndroidShare()", null);
                    }
                });
            }
        }, "ss-share").start();
        return true;
    }

    // ---------------------------------------------------------------- updates
    // The PC has the newest app (it's built there); when it's newer than this one, offer it.

    private void checkForUpdate() {
        final String server = getServer();
        if (server.isEmpty() || System.currentTimeMillis() - updateCheckedAt < 30 * 60 * 1000) return;
        updateCheckedAt = System.currentTimeMillis();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(serverUrl(server) + "hello").openConnection();
                    c.setConnectTimeout(5000);
                    c.setReadTimeout(8000);
                    InputStream in = c.getInputStream();
                    StringBuilder sb = new StringBuilder();
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = in.read(buf)) > 0 && sb.length() < 8192) sb.append(new String(buf, 0, n, "UTF-8"));
                    c.disconnect();
                    JSONObject apk = new JSONObject(sb.toString()).optJSONObject("apk");
                    if (apk == null) return;
                    final int code = apk.optInt("code", 0);
                    final String name = apk.optString("name", "");
                    if (code <= versionCode() || prefs.getInt(KEY_UPDATE_LATER, 0) == code) return;
                    runOnUiThread(new Runnable() { @Override public void run() { offerUpdate(server, code, name); } });
                } catch (Exception e) {
                    Log.d(TAG, "Update check: " + e.getMessage());
                }
            }
        }, "ss-update").start();
    }

    private void offerUpdate(final String server, final int code, String name) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle("An update is ready")
                .setMessage("Version " + name + " of the app is on your PC. Update now? It takes a few seconds, and your pairing stays.")
                .setPositiveButton("Update", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { downloadUpdate(server, code); }
                })
                .setNegativeButton("Later", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) { prefs.edit().putInt(KEY_UPDATE_LATER, code).apply(); }
                })
                .show();
    }

    private void downloadUpdate(final String server, final int code) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(this, "Let Session Switcher install updates, then go back and tap Update again.", Toast.LENGTH_LONG).show();
            updateCheckedAt = 0;
            try { startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()))); } catch (ActivityNotFoundException ignored) { }
            return;
        }
        Toast.makeText(this, "Downloading the update…", Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override public void run() {
                final File f = new File(CaptureProvider.dir(MainActivity.this), "update-" + code + ".apk");
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(serverUrl(server) + "SessionSwitcher.apk").openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(30000);
                    InputStream in = c.getInputStream();
                    OutputStream out = new FileOutputStream(f);
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    out.close();
                    in.close();
                    c.disconnect();
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            Intent install = new Intent(Intent.ACTION_VIEW)
                                    .setDataAndType(CaptureProvider.uriFor(f), "application/vnd.android.package-archive")
                                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            try { startActivity(install); } catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "Couldn’t open the installer.", Toast.LENGTH_LONG).show(); }
                        }
                    });
                } catch (IOException e) {
                    runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(MainActivity.this, "Couldn’t download the update. Is the phone on your home Wi-Fi?", Toast.LENGTH_LONG).show(); } });
                }
            }
        }, "ss-download").start();
    }

    String getServer() {
        return prefs.getString(KEY_SERVER, "");
    }

    static String serverUrl(String server) {
        return "http://" + server + "/";
    }

    /** "http://Host:4788/x" -> "host:4788". */
    static String normalizeServer(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        int scheme = s.indexOf("://");
        if (scheme >= 0) s = s.substring(scheme + 3);
        int slash = s.indexOf('/');
        if (slash >= 0) s = s.substring(0, slash);
        return s.toLowerCase(Locale.ROOT);
    }

    /** Host part of the saved server ("host:port" or "[v6]:port"). */
    private String serverHost() {
        String server = getServer();
        if (server.isEmpty()) return "";
        Uri u = Uri.parse("http://" + server + "/");
        return u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
    }

    private void loadConnect(String error) {
        String url = CONNECT_URL;
        if (error != null) {
            url += "?error=" + Uri.encode(error) + "&server=" + Uri.encode(getServer());
        }
        webView.loadUrl(url);
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "No app to open " + uri);
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript("(window.__mobileBack && window.__mobileBack()) ? 'y' : 'n'",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String result) {
                        if (webView == null) return;
                        if (result != null && result.contains("y")) return;
                        if (webView.canGoBack()) webView.goBack();
                        else moveTaskToBack(true);
                    }
                });
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQ_FILE_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        ValueCallback<Uri[]> cb = filePathCallback;
        filePathCallback = null;
        Uri capture = pendingCapture;
        File captureFile = pendingCaptureFile;
        pendingCapture = null;
        pendingCaptureFile = null;
        if (cb == null) return;
        Uri[] result = null;
        if (capture != null) {
            // "Take a photo": the camera saved it to our address; nothing comes back in data.
            if (resultCode == RESULT_OK && captureFile != null && captureFile.length() > 0) result = new Uri[] { capture };
            else if (captureFile != null) //noinspection ResultOfMethodCallIgnored
                captureFile.delete();
        } else if (resultCode == RESULT_OK && data != null) {
            List<Uri> uris = new ArrayList<>();
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    Uri u = clip.getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
            }
            if (uris.isEmpty() && data.getData() != null) uris.add(data.getData());
            if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
        }
        cb.onReceiveValue(result);
    }

    // ---------------------------------------------------------------- WebViewClient

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            switch (scheme) {
                case "http":
                case "https": {
                    String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
                    if (!host.isEmpty() && host.equals(serverHost())) return false;
                    openExternal(uri);
                    return true;
                }
                case "file":
                    // Only our bundled assets.
                    return !uri.toString().startsWith(ASSET_PREFIX);
                case "about":
                case "data":
                case "blob":
                case "javascript":
                    return false;
                default:
                    // mailto:, tel:, intent-ish links etc. -> hand to the system if anything handles them.
                    if (!"intent".equals(scheme)) openExternal(uri);
                    return true;
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String failed = request.getUrl().toString();
            if (failed.startsWith(ASSET_PREFIX)) return;
            String msg = String.valueOf(error.getDescription());
            Log.w(TAG, "Main frame load failed: " + failed + " -> " + msg);
            loadConnect(msg);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            // The connect page is a "home" screen: Back from it leaves the app instead of
            // bouncing back into a page that just failed to load.
            if (url != null && url.startsWith(CONNECT_URL)) view.clearHistory();
            else if (url != null && !getServer().isEmpty() && url.startsWith(serverUrl(getServer()))) { keepCookie(); checkForUpdate(); }
        }
    }

    // ---------------------------------------------------------------- WebChromeClient

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage m) {
            Log.d(TAG, "[console] " + m.message() + " (" + m.sourceId() + ":" + m.lineNumber() + ")");
            return true;
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            String[] mimes = mimeTypes(params.getAcceptTypes());
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            boolean images = mimes.length > 0, videos = mimes.length > 0;
            for (String m : mimes) { images &= m.startsWith("image/"); videos &= m.startsWith("video/"); }
            boolean media = mimes.length > 0;
            for (String m : mimes) media &= m.startsWith("image/") || m.startsWith("video/");

            // The page asks for exactly what it wants (Attach → Photos & videos, Take a photo,
            // Record a video, Files), so open that directly instead of a list of apps.
            if (params.isCaptureEnabled() && images && startCamera()) return true;
            if (params.isCaptureEnabled() && videos && start(new Intent(MediaStore.ACTION_VIDEO_CAPTURE))) return true;
            if (media && Build.VERSION.SDK_INT >= 33) {
                // Android's photo picker: your gallery, albums and cloud photos.
                Intent pick = new Intent(MediaStore.ACTION_PICK_IMAGES);
                if (images) pick.setType("image/*");
                else if (videos) pick.setType("video/*");
                if (multiple) pick.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, Math.min(10, MediaStore.getPickImagesMaxLimit()));
                if (start(pick)) return true;
            }
            // Everything else: the system file browser (Downloads, Drive, recent files, and so on).
            Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            open.addCategory(Intent.CATEGORY_OPENABLE);
            if (mimes.length == 1) open.setType(mimes[0]);
            else {
                open.setType("*/*");
                if (mimes.length > 1) open.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
            }
            if (multiple) open.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            if (start(open)) return true;
            Intent any = new Intent(Intent.ACTION_GET_CONTENT);
            any.addCategory(Intent.CATEGORY_OPENABLE);
            any.setType("*/*");
            if (start(Intent.createChooser(any, "Choose a file"))) return true;
            filePathCallback = null;
            return false;
        }
    }

    private boolean start(Intent intent) {
        try {
            startActivityForResult(intent, REQ_FILE_CHOOSER);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            Log.w(TAG, "Couldn't open " + intent.getAction(), e);
            return false;
        }
    }

    /** Opens the camera for one full-size photo, saved to a file only this app and the camera can reach. */
    private boolean startCamera() {
        File f = new File(CaptureProvider.dir(this), "photo-" + System.currentTimeMillis() + ".jpg");
        Uri uri = CaptureProvider.uriFor(f);
        Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        cam.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        cam.setClipData(ClipData.newRawUri("", uri));
        cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        pendingCapture = uri;
        pendingCaptureFile = f;
        if (start(cam)) return true;
        pendingCapture = null;
        pendingCaptureFile = null;
        return false;
    }

    /** Converts accept="image/*,.png" style types into MIME types. */
    static String[] mimeTypes(String[] accept) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (accept != null) {
            for (String a : accept) {
                if (a == null) continue;
                for (String part : a.split(",")) {
                    String t = part.trim().toLowerCase(Locale.ROOT);
                    if (t.isEmpty()) continue;
                    if (t.startsWith(".")) {
                        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(t.substring(1));
                        if (m != null) out.add(m);
                    } else if (t.contains("/")) {
                        out.add(t);
                    }
                }
            }
        }
        return out.toArray(new String[0]);
    }

    // ---------------------------------------------------------------- JS bridge ("Android")

    private class Bridge {
        @JavascriptInterface
        public void saveServer(String server) {
            String s = normalizeServer(server);
            prefs.edit().putString(KEY_SERVER, s).commit();
        }

        @JavascriptInterface
        public String getServer() {
            return MainActivity.this.getServer();
        }

        @JavascriptInterface
        public String deviceName() {
            String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
            String model = Build.MODEL == null ? "" : Build.MODEL;
            if (!maker.isEmpty()) maker = maker.substring(0, 1).toUpperCase(Locale.ROOT) + maker.substring(1);
            return (maker + " " + model).trim();
        }

        @JavascriptInterface
        public boolean isApp() {
            return true;
        }

        /** What was shared to the app, once (null when nothing is waiting). */
        @JavascriptInterface
        public String takeShare() {
            String s = pendingShare;
            pendingShare = null;
            return s;
        }

        /** Notifications: whether they're on, allowed by Android, and free of battery limits. */
        @JavascriptInterface
        public String notifyState() {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            JSONObject o = new JSONObject();
            try {
                o.put("on", NotifyService.isOn(MainActivity.this));
                o.put("allowed", nm.areNotificationsEnabled());
                o.put("battery", pm.isIgnoringBatteryOptimizations(getPackageName()));
                o.put("version", versionName());
            } catch (org.json.JSONException ignored) { }
            return o.toString();
        }

        @JavascriptInterface
        public void setNotify(final boolean on) {
            prefs.edit().putBoolean(NotifyService.KEY_ON, on).apply();
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (!on) { NotifyService.stop(MainActivity.this); return; }
                    keepCookie();
                    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
                    }
                    NotifyService.start(MainActivity.this);
                }
            });
        }

        /** Asks Android to let notifications arrive straight away, even while the phone sleeps. */
        @JavascriptInterface
        public void askBattery() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    try {
                        startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                    } catch (ActivityNotFoundException e) {
                        Log.w(TAG, "No battery settings", e);
                    }
                }
            });
        }

        /** Android's settings for this app's notifications (to allow them, or tune each kind). */
        @JavascriptInterface
        public void notifySettings() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = Build.VERSION.SDK_INT >= 26
                            ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                            : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    try { startActivity(i); } catch (ActivityNotFoundException e) { Log.w(TAG, "No notification settings", e); }
                }
            });
        }

        @JavascriptInterface
        public void disconnect() {
            prefs.edit().remove(KEY_SERVER).remove(NotifyService.KEY_COOKIE).putBoolean(NotifyService.KEY_ON, false).commit();
            NotifyService.stop(MainActivity.this);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    final CookieManager cm = CookieManager.getInstance();
                    cm.removeAllCookies(new ValueCallback<Boolean>() {
                        @Override
                        public void onReceiveValue(Boolean removed) {
                            cm.flush();
                        }
                    });
                    if (webView != null) loadConnect(null);
                }
            });
        }

        @JavascriptInterface
        public void share(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
                    try {
                        startActivity(Intent.createChooser(send, "Share"));
                    } catch (ActivityNotFoundException e) {
                        Log.w(TAG, "No share target", e);
                    }
                }
            });
        }

        @JavascriptInterface
        public void openExternal(final String url) {
            if (url == null) return;
            final Uri uri = Uri.parse(url.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) return;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MainActivity.this.openExternal(uri);
                }
            });
        }
    }
}
