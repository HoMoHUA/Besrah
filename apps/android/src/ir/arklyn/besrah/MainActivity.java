package ir.arklyn.besrah;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceError;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.Toast;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * A thin, secure shell around https://besrah.arklyn.ir. The web app stays the single source of product behaviour;
 * the shell only adds what a browser cannot: a real "trip in progress" live notification (HarmonyOS 4.x capsule on
 * Huawei devices, a countdown notification elsewhere) and native location permission handling.
 */
public class MainActivity extends Activity {
    static final String HOST = "besrah.arklyn.ir";
    static final String HOME = "https://" + HOST + "/";
    private static final int REQ_LOCATION = 41, REQ_NOTIFY = 42;

    private WebView web;
    volatile String currentUrl = null;
    private LinearLayout splash;

    void hideSplash() {
        if (splash == null || splash.getVisibility() == View.GONE) return;
        splash.animate().alpha(0f).setDuration(250).withEndAction(() -> splash.setVisibility(View.GONE)).start();
    }

    /** Bundled page for a first launch without network (later launches use the site's own offline shell). */
    void showOffline() {
        try (InputStream in = getAssets().open("offline.html")) {
            String html = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            web.loadDataWithBaseURL(HOME, html, "text/html", "utf-8", HOME);
        } catch (Exception e) { /* keep the splash */ }
        hideSplash();
    }

    void openNotificationSettings() {
        try {
            startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName()));
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
        }
    }
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;

    static boolean isOurs(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost());
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xFF061C1D);
        // Native preloader in the app's own colours, shown until the first Besrah page has painted.
        splash = new LinearLayout(this);
        splash.setOrientation(LinearLayout.VERTICAL);
        splash.setGravity(Gravity.CENTER);
        splash.setBackgroundColor(0xFF061C1D);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        int px = (int) (88 * getResources().getDisplayMetrics().density);
        splash.addView(logo, new LinearLayout.LayoutParams(px, px));
        ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setIndeterminate(true);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams((int) (96 * getResources().getDisplayMetrics().density), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = (int) (20 * getResources().getDisplayMetrics().density);
        splash.addView(bar, lp);
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setGeolocationEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " BesrahAndroid/0.1");

        web.addJavascriptInterface(new NativeBridge(this, web), "BesrahNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) { currentUrl = url; }
            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) { currentUrl = url; }
            @Override
            public void onPageCommitVisible(WebView view, String url) { hideSplash(); }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Only a failed main page counts (the site's service worker already serves its cached shell when it can).
                if (request.isForMainFrame()) showOffline();
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isOurs(uri)) return false;
                // Provider hand-offs (SnappFood, TapsiFood, sellers, maps) open in their own apps or the browser.
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!isOurs(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
                if (hasLocation()) { callback.invoke(origin, true, false); return; }
                pendingGeo = callback; pendingGeoOrigin = origin;
                requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, REQ_LOCATION);
            }
        });

        Uri start = getIntent() != null ? getIntent().getData() : null;
        web.loadUrl(isOurs(start) ? start.toString() : HOME);
        web.postDelayed(this::hideSplash, 12000);   // never leave the preloader up for ever
        handleShortcut(getIntent());
    }

    boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Asked only when the user starts a trip (the moment a notification is actually needed). */
    static final String ACTION_TEST_LIVE = "ir.arklyn.besrah.TEST_LIVE";
    private boolean pendingLiveTest = false;

    boolean canNotify() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    /** Launcher shortcut and Settings button: post the test live notification, asking for permission first if needed. */
    void runLiveTest() {
        if (!canNotify()) {
            pendingLiveTest = true;
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
            return;
        }
        if (TripNotifier.showTest(this)) {
            Toast.makeText(this, "اعلان آزمایشی فرستاده شد؛ نوار وضعیت را نگاه کنید.", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "اعلان‌های بِسراه خاموش است؛ در تنظیمات روشنش کنید.", Toast.LENGTH_LONG).show();
            openNotificationSettings();
        }
    }

    private void handleShortcut(Intent intent) {
        if (intent != null && ACTION_TEST_LIVE.equals(intent.getAction())) runLiveTest();
    }

    void ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        if (code == REQ_LOCATION && pendingGeo != null) {
            pendingGeo.invoke(pendingGeoOrigin, hasLocation(), false);
            pendingGeo = null; pendingGeoOrigin = null;
        }
        if (code == REQ_NOTIFY && pendingLiveTest) {
            pendingLiveTest = false;
            if (canNotify()) runLiveTest();
            else { Toast.makeText(this, "بدون اجازهٔ اعلان، اعلان زنده نشان داده نمی‌شود.", Toast.LENGTH_LONG).show(); openNotificationSettings(); }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleShortcut(intent);
        Uri uri = intent.getData();
        if (isOurs(uri)) web.loadUrl(uri.toString());
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (web != null) { web.removeJavascriptInterface("BesrahNative"); web.destroy(); }
        super.onDestroy();
    }
}
