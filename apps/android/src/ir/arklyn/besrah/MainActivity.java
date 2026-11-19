package ir.arklyn.besrah;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;

    static boolean isOurs(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equals(uri.getHost());
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

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
    }

    boolean hasLocation() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Asked only when the user starts a trip (the moment a notification is actually needed). */
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
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
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
