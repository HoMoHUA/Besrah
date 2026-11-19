package ir.arklyn.besrah;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.os.Bundle;
import java.lang.reflect.Method;

/**
 * "Trip in progress" as a real, ongoing notification with a countdown (Android chronometer).
 * On Huawei HarmonyOS 4.x the same notification also carries the system "live notification" extras, the documented-by-
 * observation keys the built-in Screen Recorder uses for its status-bar capsule (notification.live.*). Whether the system
 * shows the capsule for a third-party app is decided by the phone; without it the notification still works everywhere.
 * Times are the plan's estimates, said so in the text.
 */
final class TripNotifier {
    static final String CHANNEL = "besrah_trip";
    static final int ID = 7101;
    // HarmonyOS 4.x live notification / capsule keys (as used by com.huawei.screenrecorder 14.0.0.120).
    static final String LIVE_CAPSULE = "notification.live.capsule", LIVE_CAPSULE_STATUS = "notification.live.capsuleStatus",
        LIVE_CAPSULE_TYPE = "notification.live.capsuleType", LIVE_CAPSULE_BG = "notification.live.capsuleBgColor",
        LIVE_CAPSULE_ICON = "notification.live.capsuleIcon", LIVE_OPERATION = "notification.live.operation",
        LIVE_TYPE = "notification.live.type", LIVE_ICON_OVERLAY = "notification.live.iconOverlay",
        LIVE_EVENT = "notification.live.event", HW_SMALL_ICON = "hw_enable_small_icon";
    static final String EVENT = "NAVIGATION";
    private static boolean shown = false;

    private TripNotifier() { }

    /** True when the Huawei "live notifications" switch exists and is on for this app; false elsewhere. */
    static boolean liveCapsuleEnabled(Context c) {
        try {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            Method m = nm.getClass().getMethod("areLiveNtfsEnabled");
            Object r = m.invoke(nm);
            return r instanceof Boolean && (Boolean) r;
        } catch (Throwable t) {
            return false;
        }
    }

    private static boolean dark(Context c) {
        return (c.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    static String faDigits(String s) {
        StringBuilder b = new StringBuilder();
        for (char ch : s.toCharArray()) b.append(ch >= '0' && ch <= '9' ? (char) ('۰' + (ch - '0')) : ch);
        return b.toString();
    }
    private static String fa(long n) { return faDigits(Long.toString(n)); }

    static boolean show(Context c, Trip t) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        NotificationChannel ch = new NotificationChannel(CHANNEL, c.getString(R.string.channel_trip), NotificationManager.IMPORTANCE_LOW);
        ch.setDescription(c.getString(R.string.channel_trip_desc));
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);

        long now = System.currentTimeMillis() / 1000;
        boolean beforeLeave = now < t.leaveEpoch;
        long target = beforeLeave ? t.leaveEpoch : t.arriveEpoch;
        String title = beforeLeave ? "حرکت تا" : (now < t.arriveEpoch ? "رسیدن تا" : "زمان رسیدن گذشته است");
        StringBuilder text = new StringBuilder(t.title);
        if (t.line != null && t.from != null) {
            text.append(" · مترو خط ").append(fa(t.line)).append(" از ").append(t.from);
            if (t.departAt != null) text.append(" ساعت ").append(faDigits(t.departAt));
        }
        text.append(" · برآورد برنامه، نه موقعیت زنده");

        Intent open = new Intent(c, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(c, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent end = PendingIntent.getBroadcast(c, 2, new Intent(c, TripActionReceiver.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Icon small = Icon.createWithResource(c, R.drawable.ic_stat_trip);

        // HarmonyOS 4.x capsule data (ignored by other systems).
        Bundle capsule = new Bundle();
        capsule.putInt(LIVE_CAPSULE_STATUS, 1);
        capsule.putInt(LIVE_CAPSULE_TYPE, 2);
        capsule.putInt(LIVE_CAPSULE_BG, dark(c) ? 0xFF1F7A74 : 0xFF0E5A57);
        capsule.putParcelable(LIVE_CAPSULE_ICON, small);
        Bundle extras = new Bundle();
        extras.putInt(LIVE_OPERATION, shown ? 1 : 0);
        extras.putInt(LIVE_TYPE, 1);
        extras.putBoolean(LIVE_ICON_OVERLAY, true);
        extras.putBundle(LIVE_CAPSULE, capsule);
        extras.putString(LIVE_EVENT, EVENT);
        extras.putBoolean(HW_SMALL_ICON, true);

        Notification.Builder b = new Notification.Builder(c, CHANNEL)
            .setSmallIcon(small)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new Notification.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(target * 1000)
            .setUsesChronometer(now < target)
            .setChronometerCountDown(now < target)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setColor(0xFF0E5A57)
            .setContentIntent(content)
            .setTimeoutAfter(Math.max(1, t.endsAt - now) * 1000)
            .addAction(new Notification.Action.Builder(small, c.getString(R.string.trip_end), end).build())
            .addExtras(extras);
        nm.notify(ID, b.build());
        shown = true;
        return true;
    }

    /** Whether our trip notification is still on screen (the user may have ended it from the notification). */
    static boolean isActive(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return false;
        for (android.service.notification.StatusBarNotification n : nm.getActiveNotifications()) if (n.getId() == ID) return true;
        return false;
    }

    static void cancel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.cancel(ID);
        shown = false;
    }
}
