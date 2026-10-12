package app.sessionswitcher.remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * Notifications from your PC. While notifications are on, this keeps one light connection to
 * Session Switcher on your PC (its /api/notify/stream) whenever the phone is on your Wi-Fi, and shows
 * what comes in: a chat that needs your OK (with Allow and Deny on it) or one that replied. Off your
 * Wi-Fi it waits, and when you're back it shows what's waiting. Nothing goes anywhere but your PC.
 *
 * Android needs a running connection like this to show a notification of its own while it runs
 * ("Watching your chats"); it's on the quietest channel, so it can be collapsed.
 */
public class NotifyService extends Service {
    private static final String TAG = "SessionSwitcherNotify";
    static final String PREFS = "session_switcher";
    static final String KEY_SERVER = "server";
    static final String KEY_ON = "notify_on";
    static final String KEY_COOKIE = "cookie";
    private static final String KEY_SINCE = "notify_since";
    private static final String KEY_SEEN = "notify_seen";
    static final String CH_NEEDS = "needs", CH_REPLIES = "replies", CH_STATUS = "status";
    private static final int STATUS_ID = 1;
    static final String ACTION_ACT = "app.sessionswitcher.remote.ACT";
    static final String ACTION_OFF = "app.sessionswitcher.remote.OFF";
    static final String ACTION_REPLY = "app.sessionswitcher.remote.REPLY";
    private static final String KEY_TEXT = "reply_text";

    private volatile boolean running;
    private volatile HttpURLConnection conn;
    private Thread worker;
    private final Object wake = new Object();
    private ConnectivityManager.NetworkCallback netCallback;
    private final LinkedHashSet<String> seen = new LinkedHashSet<>();
    private String statusText = "Connecting to your PC…";

    // ---------------------------------------------------------------- starting and stopping

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static boolean isOn(Context c) { return prefs(c).getBoolean(KEY_ON, false); }

    static void start(Context c) {
        Intent i = new Intent(c, NotifyService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (RuntimeException e) {
            Log.w(TAG, "Couldn't start notifications", e);
        }
    }

    static void stop(Context c) { c.stopService(new Intent(c, NotifyService.class)); }

    @Override
    public void onCreate() {
        super.onCreate();
        channels(this);
        String saved = prefs(this).getString(KEY_SEEN, "");
        if (!saved.isEmpty()) seen.addAll(Arrays.asList(saved.split("\n")));
        goForeground();
        if (Build.VERSION.SDK_INT >= 24) {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            netCallback = new ConnectivityManager.NetworkCallback() {
                @Override public void onAvailable(Network network) { nudge(); }
            };
            try { cm.registerDefaultNetworkCallback(netCallback); } catch (RuntimeException e) { netCallback = null; }
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        goForeground();
        String action = intent == null ? null : intent.getAction();
        if (ACTION_OFF.equals(action)) {
            prefs(this).edit().putBoolean(KEY_ON, false).apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_ACT.equals(action)) {
            final String token = intent.getStringExtra("token"), decision = intent.getStringExtra("decision");
            final String tag = intent.getStringExtra("tag"), title = intent.getStringExtra("title");
            final String key = intent.getStringExtra("key");
            new Thread(new Runnable() {
                @Override public void run() {
                    answer(token, decision, tag, title, key);
                    if (!isOn(NotifyService.this)) stopSelf();
                }
            }, "ss-answer").start();
        }
        if (ACTION_REPLY.equals(action)) {
            Bundle in = RemoteInput.getResultsFromIntent(intent);
            CharSequence typed = in == null ? null : in.getCharSequence(KEY_TEXT);
            final String text = typed == null ? "" : typed.toString().trim();
            final String token = intent.getStringExtra("token"), tag = intent.getStringExtra("tag");
            final String title = intent.getStringExtra("title"), key = intent.getStringExtra("key");
            if (!text.isEmpty()) new Thread(new Runnable() {
                @Override public void run() {
                    sendReply(token, text, tag, title, key);
                    if (!isOn(NotifyService.this)) stopSelf();
                }
            }, "ss-reply").start();
        }
        if (!isOn(this)) {
            if (!ACTION_ACT.equals(action) && !ACTION_REPLY.equals(action)) stopSelf();
            return START_NOT_STICKY;
        }
        if (worker == null) {
            running = true;
            worker = new Thread(new Runnable() { @Override public void run() { loop(); } }, "ss-notify");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        HttpURLConnection c = conn;
        if (c != null) c.disconnect();
        nudge();
        if (worker != null) worker.interrupt();
        if (netCallback != null) {
            try { ((ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(netCallback); } catch (RuntimeException ignored) { }
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    // ---------------------------------------------------------------- the connection

    private void loop() {
        int backoff = 0;
        while (running) {
            SharedPreferences p = prefs(this);
            String server = p.getString(KEY_SERVER, ""), cookie = p.getString(KEY_COOKIE, "");
            if (server.isEmpty() || cookie.isEmpty()) {
                status("Open the app once to connect it to your PC.");
                pause(60000);
                continue;
            }
            boolean connected = false;
            try {
                long since = p.getLong(KEY_SINCE, 0);
                HttpURLConnection c = (HttpURLConnection) new URL("http://" + server + "/api/notify/stream?since=" + since).openConnection();
                conn = c;
                c.setConnectTimeout(8000);
                c.setReadTimeout(75000);   // the PC says something every 25 seconds
                c.setRequestProperty("Cookie", cookie);
                c.setRequestProperty("Accept", "text/event-stream");
                int code = c.getResponseCode();
                if (code == 401 || code == 403) {
                    status("This phone isn’t paired any more. Open the app to pair it again.");
                    pause(5 * 60000);
                    continue;
                }
                if (code != 200) throw new IOException("HTTP " + code);
                BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"));
                connected = true;
                backoff = 0;
                status("Connected to your PC.");
                StringBuilder data = new StringBuilder();
                String line;
                while (running && (line = r.readLine()) != null) {
                    if (line.isEmpty()) {
                        if (data.length() > 0) { handle(data.toString()); data.setLength(0); }
                    } else if (line.startsWith("data:")) {
                        data.append(line.substring(5).trim());
                    }
                }
            } catch (IOException e) {
                Log.d(TAG, "Connection: " + e.getMessage());
            } finally {
                HttpURLConnection c = conn;
                conn = null;
                if (c != null) c.disconnect();
            }
            if (!running) break;
            status("Waiting for your PC: on your home Wi-Fi, with Session Switcher running there.");
            backoff = connected ? 2 : Math.min(backoff == 0 ? 5 : backoff * 2, 120);
            pause(backoff * 1000L);
        }
    }

    private void pause(long ms) {
        synchronized (wake) {
            try { wake.wait(ms); } catch (InterruptedException ignored) { }
        }
    }

    /** The network changed (back on Wi-Fi, say): try again now instead of waiting. */
    private void nudge() { synchronized (wake) { wake.notifyAll(); } }

    private void handle(String json) {
        try {
            JSONObject m = new JSONObject(json);
            String kind = m.optString("kind");
            long at = m.optLong("at", 0);
            if ("hello".equals(kind)) { if (at > 0) prefs(this).edit().putLong(KEY_SINCE, at).apply(); return; }
            if ("clear".equals(kind)) { nm().cancel(m.optString("tag"), 0); return; }
            String id = m.optString("id");
            if (!id.isEmpty() && !seen.add(id)) return;   // shown already
            remember();
            show(m);
            if (at > 0 && "reply".equals(kind)) prefs(this).edit().putLong(KEY_SINCE, at).apply();
        } catch (JSONException e) {
            Log.w(TAG, "Bad message", e);
        }
    }

    private void remember() {
        while (seen.size() > 200) seen.remove(seen.iterator().next());
        StringBuilder sb = new StringBuilder();
        for (String s : seen) { if (sb.length() > 0) sb.append('\n'); sb.append(s); }
        prefs(this).edit().putString(KEY_SEEN, sb.toString()).apply();
    }

    // ---------------------------------------------------------------- notifications

    static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel needs = new NotificationChannel(CH_NEEDS, "Needs you", NotificationManager.IMPORTANCE_HIGH);
        needs.setDescription("A chat is waiting for your OK or your answer.");
        NotificationChannel replies = new NotificationChannel(CH_REPLIES, "Replies", NotificationManager.IMPORTANCE_DEFAULT);
        replies.setDescription("A chat finished its turn.");
        NotificationChannel status = new NotificationChannel(CH_STATUS, "Connection", NotificationManager.IMPORTANCE_MIN);
        status.setDescription("Shown while the app listens for your PC. You can turn this one off.");
        status.setShowBadge(false);
        List<NotificationChannel> all = new ArrayList<>(Arrays.asList(needs, replies, status));
        nm.createNotificationChannels(all);
    }

    private NotificationManager nm() { return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE); }

    @SuppressWarnings("deprecation")
    private Notification.Builder builder(String channel) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, channel) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_notify).setColor(0xFFA5463F);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(CH_NEEDS.equals(channel) ? Notification.PRIORITY_HIGH : CH_STATUS.equals(channel) ? Notification.PRIORITY_MIN : Notification.PRIORITY_DEFAULT);
        return b;
    }

    private void goForeground() {
        Notification n = statusNotification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(STATUS_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
        else startForeground(STATUS_ID, n);
    }

    private Notification statusNotification() {
        Intent off = new Intent(this, NotifyService.class).setAction(ACTION_OFF);
        PendingIntent offPi = Build.VERSION.SDK_INT >= 26
                ? PendingIntent.getForegroundService(this, 9, off, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                : PendingIntent.getService(this, 9, off, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return builder(CH_STATUS)
                .setContentTitle("Watching your chats")
                .setContentText(statusText)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(openApp(null, null, 8))
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_notify), "Turn off", offPi).build())
                .build();
    }

    private void status(String text) {
        if (text.equals(statusText)) return;
        statusText = text;
        try { nm().notify(STATUS_ID, statusNotification()); } catch (RuntimeException ignored) { }
    }

    private PendingIntent openApp(String key, String sessionId, int code) {
        Intent i = new Intent(this, MainActivity.class)
                .setAction(key == null ? Intent.ACTION_MAIN : "open:" + key)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (key != null) i.putExtra(MainActivity.EXTRA_KEY, key);
        if (sessionId != null) i.putExtra(MainActivity.EXTRA_SESSION, sessionId);
        return PendingIntent.getActivity(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent actIntent(JSONObject m, String decision, int code) {
        Intent i = new Intent(this, NotifyService.class).setAction(ACTION_ACT)
                .putExtra("token", m.optString("act"))
                .putExtra("decision", decision)
                .putExtra("tag", m.optString("tag"))
                .putExtra("title", m.optString("chatTitle", "A chat"))
                .putExtra("key", m.optString("key"));
        i.setData(android.net.Uri.parse("ss://act/" + decision + "/" + m.optString("id")));   // one per notification and button
        return Build.VERSION.SDK_INT >= 26
                ? PendingIntent.getForegroundService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                : PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void show(JSONObject m) {
        String kind = m.optString("kind"), tag = m.optString("tag", "test");
        boolean needs = "needs".equals(kind);
        String key = m.optString("key", null), sid = m.isNull("sessionId") ? null : m.optString("sessionId", null);
        int code = tag.hashCode() & 0xfffffff;
        Notification.Builder b = builder(needs ? CH_NEEDS : CH_REPLIES)
                .setContentTitle(m.optString("title", "Session Switcher"))
                .setContentText(m.optString("body"))
                .setStyle(new Notification.BigTextStyle().bigText(m.optString("body")))
                .setAutoCancel(true)
                .setWhen(System.currentTimeMillis())
                .setShowWhen(true)
                .setCategory(needs ? Notification.CATEGORY_REMINDER : Notification.CATEGORY_MESSAGE)
                .setContentIntent(openApp(key == null || key.isEmpty() ? null : key, sid, code));
        if (m.optBoolean("catchUp")) b.setOnlyAlertOnce(true);
        String act = m.isNull("act") ? "" : m.optString("act", "");
        Icon icon = Icon.createWithResource(this, R.drawable.ic_notify);
        if (needs && !act.isEmpty()) {
            b.addAction(new Notification.Action.Builder(icon, "Allow", actIntent(m, "allow", code + 1)).build());
            b.addAction(new Notification.Action.Builder(icon, "Deny", actIntent(m, "deny", code + 2)).build());
        }
        // A question with a few answers: each answer is a button.
        JSONArray choices = m.optJSONArray("choices");
        if (needs && act.isEmpty() && choices != null) {
            for (int i = 0; i < choices.length() && i < 3; i++) {
                JSONObject ch = choices.optJSONObject(i);
                if (ch == null) continue;
                try {
                    JSONObject one = new JSONObject(m.toString());
                    one.put("act", ch.optString("token"));
                    one.put("id", m.optString("id") + "#" + i);
                    b.addAction(new Notification.Action.Builder(icon, ch.optString("label", "Answer " + (i + 1)), actIntent(one, "allow", code + 3 + i)).build());
                } catch (JSONException ignored) { }
            }
        }
        // A reply: answer it right here.
        String reply = m.isNull("reply") ? "" : m.optString("reply", "");
        if (!reply.isEmpty() && Build.VERSION.SDK_INT >= 24) {
            RemoteInput input = new RemoteInput.Builder(KEY_TEXT).setLabel("Reply to " + m.optString("who", "it") + "…").build();
            Intent ri = new Intent(this, NotifyService.class).setAction(ACTION_REPLY)
                    .putExtra("token", reply).putExtra("tag", tag).putExtra("title", m.optString("chatTitle", "A chat")).putExtra("key", key)
                    .setData(android.net.Uri.parse("ss://reply/" + m.optString("id")));
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent rpi = Build.VERSION.SDK_INT >= 26 ? PendingIntent.getForegroundService(this, code + 7, ri, flags) : PendingIntent.getService(this, code + 7, ri, flags);
            b.addAction(new Notification.Action.Builder(icon, "Reply", rpi).addRemoteInput(input).build());
        }
        try { nm().notify(tag, 0, b.build()); } catch (RuntimeException e) { Log.w(TAG, "Couldn't notify", e); }
    }

    // ---------------------------------------------------------------- Allow / Deny

    private void answer(String token, String decision, String tag, String title, String key) {
        nm().notify(tag, 0, builder(CH_NEEDS).setContentTitle(title).setContentText("allow".equals(decision) ? "Allowing…" : "Denying…").setOnlyAlertOnce(true).build());
        String why;
        try {
            SharedPreferences p = prefs(this);
            HttpURLConnection c = (HttpURLConnection) new URL("http://" + p.getString(KEY_SERVER, "") + "/api/push/act").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(15000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Cookie", p.getString(KEY_COOKIE, ""));
            c.setRequestProperty("Content-Type", "application/json");
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("decision", decision);
            OutputStream out = c.getOutputStream();
            out.write(body.toString().getBytes("UTF-8"));
            out.close();
            int code = c.getResponseCode();
            if (code == 200) { nm().cancel(tag, 0); c.disconnect(); return; }
            why = errorOf(c.getErrorStream(), "It didn’t go through (" + code + ").");
            c.disconnect();
        } catch (IOException | JSONException e) {
            why = "Couldn’t reach your PC. Is the phone on your home Wi-Fi?";
        }
        int code = tag.hashCode() & 0xfffffff;
        nm().notify(tag, 0, builder(CH_NEEDS).setContentTitle(title + ": not answered").setContentText(why + " Tap to open it.")
                .setStyle(new Notification.BigTextStyle().bigText(why + " Tap to open it."))
                .setAutoCancel(true).setOnlyAlertOnce(true).setContentIntent(openApp(key, null, code)).build());
    }

    private void sendReply(String token, String text, String tag, String title, String key) {
        String why;
        try {
            SharedPreferences p = prefs(this);
            HttpURLConnection c = (HttpURLConnection) new URL("http://" + p.getString(KEY_SERVER, "") + "/api/push/reply").openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(20000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Cookie", p.getString(KEY_COOKIE, ""));
            c.setRequestProperty("Content-Type", "application/json");
            JSONObject body = new JSONObject();
            body.put("token", token);
            body.put("text", text);
            OutputStream out = c.getOutputStream();
            out.write(body.toString().getBytes("UTF-8"));
            out.close();
            int code = c.getResponseCode();
            if (code == 200) {
                c.disconnect();
                Notification.Builder ok = builder(CH_REPLIES).setContentTitle(title).setContentText("Sent: " + text).setOnlyAlertOnce(true).setAutoCancel(true);
                if (Build.VERSION.SDK_INT >= 26) ok.setTimeoutAfter(6000);
                nm().notify(tag, 0, ok.build());
                return;
            }
            why = errorOf(c.getErrorStream(), "It didn’t go through (" + code + ").");
            c.disconnect();
        } catch (IOException | JSONException e) {
            why = "Couldn’t reach your PC. Is the phone on your home Wi-Fi?";
        }
        int code = tag.hashCode() & 0xfffffff;
        nm().notify(tag, 0, builder(CH_REPLIES).setContentTitle(title + ": not sent").setContentText(why + " Tap to open it.")
                .setStyle(new Notification.BigTextStyle().bigText(why + " Tap to open it."))
                .setAutoCancel(true).setOnlyAlertOnce(true).setContentIntent(openApp(key, null, code)).build());
    }

    private static String errorOf(InputStream in, String fallback) {
        if (in == null) return fallback;
        try {
            BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null && sb.length() < 4000) sb.append(line);
            String e = new JSONObject(sb.toString()).optString("error", "");
            return e.isEmpty() ? fallback : e;
        } catch (IOException | JSONException e) {
            return fallback;
        }
    }
}
