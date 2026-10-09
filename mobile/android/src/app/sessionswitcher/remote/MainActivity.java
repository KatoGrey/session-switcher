package app.sessionswitcher.remote;

import android.annotation.SuppressLint;
import android.app.Activity;
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

import java.io.File;
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
        s.setUserAgentString(s.getUserAgentString() + " SessionSwitcherAndroid/5.2");
        CaptureProvider.cleanOld(this);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);

        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new Chrome());

        // Process death / fresh launch: just (re)load the start page.
        loadStart();
    }

    private void loadStart() {
        String server = getServer();
        webView.loadUrl(server.isEmpty() ? CONNECT_URL : serverUrl(server));
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

        @JavascriptInterface
        public void disconnect() {
            prefs.edit().remove(KEY_SERVER).commit();
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
