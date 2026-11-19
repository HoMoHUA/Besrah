package ir.arklyn.besrah;

import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONObject;

/**
 * window.BesrahNative, exposed to the Besrah page only. Every call re-checks that the page currently loaded is our own
 * origin, so a provider page opened by mistake can never drive notifications. Input is the same small, device-only trip
 * summary the web app keeps (station names, line, times); nothing is stored by the shell.
 */
final class NativeBridge {
    private final MainActivity activity;
    private final WebView web;
    NativeBridge(MainActivity activity, WebView web) { this.activity = activity; this.web = web; }

    // The URL of the page now loaded, kept up to date by MainActivity on every navigation (JS calls arrive off the UI thread).
    private boolean fromOurPage() {
        String u = activity.currentUrl;
        return u != null && MainActivity.isOurs(Uri.parse(u));
    }

    @JavascriptInterface
    public int version() { return 1; }

    @JavascriptInterface
    public boolean liveNotifications() { return TripNotifier.liveCapsuleEnabled(activity); }

    @JavascriptInterface
    public boolean startTrip(String json) {
        if (!fromOurPage() || json == null || json.length() > 4000) return false;
        try {
            JSONObject t = new JSONObject(json);
            activity.runOnUiThread(activity::ensureNotificationPermission);
            return TripNotifier.show(activity, Trip.fromJson(t));
        } catch (Exception e) {
            return false;
        }
    }

    /** A two-minute test trip, so the phone lists Besrah under notification / Live view settings. */
    @JavascriptInterface
    public boolean testLiveNotification() {
        if (!fromOurPage()) return false;
        activity.runOnUiThread(activity::ensureNotificationPermission);
        long now = System.currentTimeMillis() / 1000;
        try {
            JSONObject t = new JSONObject().put("title", "آزمایش اعلان زندهٔ بِسراه").put("leaveEpoch", now + 60).put("arriveEpoch", now + 120).put("startedAt", now);
            return TripNotifier.show(activity, Trip.fromJson(t));
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public void openNotificationSettings() {
        if (fromOurPage()) activity.runOnUiThread(activity::openNotificationSettings);
    }

    @JavascriptInterface
    public boolean tripActive() { return fromOurPage() && TripNotifier.isActive(activity); }

    @JavascriptInterface
    public void endTrip() {
        if (fromOurPage()) TripNotifier.cancel(activity);
    }
}
