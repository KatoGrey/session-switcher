package app.sessionswitcher.remote;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The "What needs you" home-screen widget: up to three chats that are waiting for you, newest
 * first, with Allow and Deny on the top one when it's a yes/no.
 *
 * NotifyService owns the list (it's the one hearing from the PC) and keeps it in the shared
 * preferences, so the widget can still draw it after the service or the whole app has gone. Every
 * change ends in update(), which redraws every copy of the widget. There's no list adapter on
 * purpose: three fixed rows are plenty for a glance and keep this to one RemoteViews.
 */
public class NeedsWidget extends AppWidgetProvider {
    private static final String TAG = "SessionSwitcherWidget";
    private static final String KEY_NEEDS = "widget_needs";
    static final String KEY_LIVE = "notify_live";
    private static final int MAX_KEPT = 20;

    private static final int[] ROWS = { R.id.row1, R.id.row2, R.id.row3 };
    private static final int[] TITLES = { R.id.row1_title, R.id.row2_title, R.id.row3_title };
    private static final int[] BODIES = { R.id.row1_body, R.id.row2_body, R.id.row3_body };

    // ---------------------------------------------------------------- the list (called by NotifyService)

    private static JSONArray load(Context c) {
        try { return new JSONArray(NotifyService.prefs(c).getString(KEY_NEEDS, "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    private static void save(Context c, JSONArray list) {
        NotifyService.prefs(c).edit().putString(KEY_NEEDS, list.toString()).apply();
        update(c);
    }

    /** A chat needs you: put it at the top (or refresh it, if a catch-up repeats one we have). */
    static synchronized void add(Context c, JSONObject m) {
        String id = m.optString("id");
        JSONObject item = new JSONObject();
        try {
            item.put("id", id);
            item.put("tag", m.optString("tag"));
            item.put("key", m.optString("key"));
            item.put("sessionId", m.isNull("sessionId") ? "" : m.optString("sessionId", ""));
            item.put("title", m.optString("chatTitle", "A chat"));
            item.put("body", m.optString("body"));
            item.put("act", m.isNull("act") ? "" : m.optString("act", ""));
        } catch (JSONException e) {
            return;
        }
        JSONArray old = load(c), list = new JSONArray();
        list.put(item);
        for (int i = 0; i < old.length() && list.length() < MAX_KEPT; i++) {
            JSONObject o = old.optJSONObject(i);
            if (o != null && !(id.length() > 0 && id.equals(o.optString("id")))) list.put(o);
        }
        save(c, list);
    }

    /** Drop what's answered: by its id, or everything for a chat (tag or key) when that's all we know. */
    static synchronized void remove(Context c, String id, String tag, String key) {
        JSONArray old = load(c), list = new JSONArray();
        for (int i = 0; i < old.length(); i++) {
            JSONObject o = old.optJSONObject(i);
            if (o == null) continue;
            boolean gone = (notEmpty(id) && id.equals(o.optString("id")))
                    || (notEmpty(tag) && tag.equals(o.optString("tag")))
                    || (notEmpty(key) && key.equals(o.optString("key")));
            if (!gone) list.put(o);
        }
        if (list.length() != old.length()) save(c, list);
    }

    /** A fresh connection: the PC is about to resend everything still waiting, so start over. */
    static synchronized void reset(Context c) {
        if (load(c).length() == 0) { update(c); return; }
        save(c, new JSONArray());
    }

    /** Show "Allowing…" on an item while its answer is on the way (decision null puts it back). */
    static synchronized void busy(Context c, String id, String decision) {
        if (!notEmpty(id)) return;
        JSONArray list = load(c);
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o == null || !id.equals(o.optString("id"))) continue;
            if (decision == null) o.remove("busy"); else try { o.put("busy", decision); } catch (JSONException ignored) { }
            save(c, list);
            return;
        }
    }

    static void live(Context c, boolean on) {
        SharedPreferences p = NotifyService.prefs(c);
        if (p.getBoolean(KEY_LIVE, false) == on) return;
        p.edit().putBoolean(KEY_LIVE, on).apply();
        update(c);
    }

    private static boolean notEmpty(String s) { return s != null && !s.isEmpty(); }

    // ---------------------------------------------------------------- drawing

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) draw(context, mgr, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager mgr, int id, Bundle options) {
        draw(context, mgr, id);   // resized: maybe more (or fewer) rows fit now
    }

    /** Redraw every copy of the widget on the home screen. Cheap, and safe to call from any thread. */
    static void update(Context c) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(c);
            if (mgr == null) return;
            for (int id : mgr.getAppWidgetIds(new ComponentName(c, NeedsWidget.class))) draw(c, mgr, id);
        } catch (RuntimeException e) {
            Log.w(TAG, "Couldn't update the widget", e);
        }
    }

    private static void draw(Context c, AppWidgetManager mgr, int widgetId) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.needs_widget);
        boolean on = NotifyService.isOn(c);
        boolean live = on && NotifyService.prefs(c).getBoolean(KEY_LIVE, false);
        // With notifications off nothing keeps the list fresh, so don't show an old one.
        JSONArray list = on ? load(c) : new JSONArray();
        int n = list.length();

        v.setTextViewText(R.id.count, n == 0 ? "Nothing needs you" : n + (n == 1 ? " needs you" : " need you"));
        v.setViewVisibility(R.id.status, live ? View.GONE : View.VISIBLE);
        v.setTextViewText(R.id.status, on ? "Not connected — open the app" : "Notifications are off — open the app");
        v.setViewVisibility(R.id.empty, n == 0 && live ? View.VISIBLE : View.GONE);
        v.setOnClickPendingIntent(R.id.header, open(c, null, null, 0));
        v.setOnClickPendingIntent(R.id.status, open(c, null, null, 0));

        int fit = rowsThatFit(mgr, widgetId);
        for (int r = 0; r < ROWS.length; r++) {
            JSONObject o = r < n && r < fit ? list.optJSONObject(r) : null;
            v.setViewVisibility(ROWS[r], o == null ? View.GONE : View.VISIBLE);
            if (o == null) continue;
            String busy = o.optString("busy", "");
            v.setTextViewText(TITLES[r], o.optString("title", "A chat"));
            v.setTextViewText(BODIES[r], busy.isEmpty() ? o.optString("body") : "allow".equals(busy) ? "Allowing…" : "Denying…");
            String key = o.optString("key", ""), sid = o.optString("sessionId", "");
            v.setOnClickPendingIntent(ROWS[r], open(c, key.isEmpty() ? null : key, sid.isEmpty() ? null : sid, 100 + r));
            if (r == 0) {
                boolean yesNo = !o.optString("act", "").isEmpty() && busy.isEmpty();
                v.setViewVisibility(R.id.row1_allow, yesNo ? View.VISIBLE : View.GONE);
                v.setViewVisibility(R.id.row1_deny, yesNo ? View.VISIBLE : View.GONE);
                if (yesNo) {
                    v.setOnClickPendingIntent(R.id.row1_allow, act(c, o, "allow", 200));
                    v.setOnClickPendingIntent(R.id.row1_deny, act(c, o, "deny", 201));
                }
            }
        }
        try { mgr.updateAppWidget(widgetId, v); } catch (RuntimeException e) { Log.w(TAG, "Couldn't draw the widget", e); }
    }

    /** How many rows the widget's height has room for: one at the smallest, three from about 4x2 up. */
    private static int rowsThatFit(AppWidgetManager mgr, int widgetId) {
        Bundle o = mgr.getAppWidgetOptions(widgetId);
        // In portrait the launcher gives the widget its max height; min height is the landscape one.
        int h = o == null ? 0 : o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
        if (h <= 0) return 3;
        return h >= 150 ? 3 : h >= 112 ? 2 : 1;
    }

    private static PendingIntent open(Context c, String key, String sessionId, int code) {
        Intent i = new Intent(c, MainActivity.class)
                .setAction(key == null && sessionId == null ? Intent.ACTION_MAIN : "open:" + (key != null ? key : sessionId))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (key != null) i.putExtra(MainActivity.EXTRA_KEY, key);
        if (sessionId != null) i.putExtra(MainActivity.EXTRA_SESSION, sessionId);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Allow / Deny: the same ACTION_ACT the notification's buttons send, so one path answers both. */
    private static PendingIntent act(Context c, JSONObject o, String decision, int code) {
        Intent i = new Intent(c, NotifyService.class).setAction(NotifyService.ACTION_ACT)
                .putExtra("token", o.optString("act"))
                .putExtra("decision", decision)
                .putExtra("tag", o.optString("tag"))
                .putExtra("title", o.optString("title", "A chat"))
                .putExtra("key", o.optString("key"))
                .putExtra("id", o.optString("id"));
        // Its own data so it never collides with (or overwrites) a notification's PendingIntent.
        i.setData(Uri.parse("ss://widget-act/" + decision + "/" + Uri.encode(o.optString("id"))));
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return Build.VERSION.SDK_INT >= 26 ? PendingIntent.getForegroundService(c, code, i, flags) : PendingIntent.getService(c, code, i, flags);
    }
}
