package ir.arklyn.besrah;

import android.webkit.WebView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * Snapp requests made by the person's own phone (their own Iranian connection), for the Besrah page only.
 * Only five fixed Snapp endpoints can be reached: ride price, request SMS code, verify code, refresh session, captcha.
 * The page builds the JSON body; the answer goes back to the page. Nothing is stored or logged here.
 */
final class SnappNative {
    private static final String API = "https://app.snapp.taxi/api";
    private static final String OAUTH = "https://oauth-passenger.snapp.site";
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private final WebView web;
    SnappNative(WebView web) { this.web = web; }

    /** The fixed URL for a key, or null. `extra` is the captcha "type/clientId" for key "captcha". */
    static String urlFor(String key, String extra) {
        switch (key) {
            case "price": return API + "/v3/price";
            case "otp": return OAUTH + "/v3/mutotp";
            case "verify": return OAUTH + "/v3/mutotp/auth";
            case "refresh": return OAUTH + "/v2/auth";
            case "captcha":
                if (extra == null || !extra.matches("(numeric|alphabetic|alphanumeric)/[0-9A-Fa-f-]{36}")) return null;
                return API + "/captcha/api/v1/generate/text/" + extra;
            default: return null;
        }
    }

    void request(final String id, final String key, final String body, final String bearer, final String extra) {
        final String url = urlFor(key, extra);
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,40}")) return;
        if (url == null || (body != null && body.length() > 8000) || (bearer != null && bearer.length() > 4096)) { reply(id, 0, ""); return; }
        pool.execute(() -> {
            int status = 0; String text = "";
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(12000); c.setReadTimeout(15000); c.setInstanceFollowRedirects(false);
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("User-Agent", UA);
                c.setRequestProperty("Origin", "https://app.snapp.taxi");
                c.setRequestProperty("Referer", "https://app.snapp.taxi/");
                c.setRequestProperty("locale", "fa-IR");
                if (bearer != null && !bearer.isEmpty()) c.setRequestProperty("Authorization", "Bearer " + bearer);
                if ("captcha".equals(key)) c.setRequestMethod("GET");
                else {
                    c.setRequestMethod("POST"); c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "application/json");
                    try (OutputStream o = c.getOutputStream()) { o.write((body == null ? "{}" : body).getBytes(StandardCharsets.UTF_8)); }
                }
                status = c.getResponseCode();
                InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in != null) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n; long total = 0;
                    while ((n = in.read(b)) > 0 && total < 600_000) { buf.write(b, 0, n); total += n; }
                    in.close(); text = buf.toString("UTF-8");
                }
            } catch (Exception e) { status = 0; text = ""; }
            finally { if (c != null) c.disconnect(); }
            reply(id, status, text);
        });
    }

    private void reply(String id, int status, String text) {
        final String js = "window.__besrahSnappDone&&window.__besrahSnappDone(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }
}
