package ir.arklyn.besrah;

import org.json.JSONObject;

/** The validated trip summary (mirrors sanitizeActiveTrip in the Mini App store). Rejects anything malformed. */
final class Trip {
    static final long MAX_S = 8 * 3600, AFTER_ARRIVAL_S = 15 * 60;
    final String title; final long leaveEpoch, arriveEpoch, endsAt;
    final Integer line; final String from, to, toward, departAt;

    private Trip(String title, long leave, long arrive, long endsAt, Integer line, String from, String to, String toward, String departAt) {
        this.title = title; this.leaveEpoch = leave; this.arriveEpoch = arrive; this.endsAt = endsAt;
        this.line = line; this.from = from; this.to = to; this.toward = toward; this.departAt = departAt;
    }

    private static String name(JSONObject o, String k) {
        String v = o.optString(k, "").trim();
        return v.isEmpty() || v.length() > 64 ? null : v;
    }

    static Trip fromJson(JSONObject t) {
        String title = name(t, "title");
        long leave = t.optLong("leaveEpoch", -1), arrive = t.optLong("arriveEpoch", -1), started = t.optLong("startedAt", System.currentTimeMillis() / 1000);
        if (title == null || leave <= 0 || arrive < leave || arrive - started > MAX_S) throw new IllegalArgumentException("trip");
        long endsAt = Math.min(arrive + AFTER_ARRIVAL_S, started + MAX_S);
        if (System.currentTimeMillis() / 1000 >= endsAt) throw new IllegalArgumentException("expired");
        JSONObject r = t.optJSONObject("ride");
        Integer line = null; String from = null, to = null, toward = null, departAt = null;
        if (r != null) {
            int l = r.optInt("line", 0);
            String dep = r.optString("departAt", "");
            if ((l == 1 || l == 2) && dep.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) {
                line = l; from = name(r, "from"); to = name(r, "to"); toward = name(r, "toward"); departAt = dep;
            }
        }
        return new Trip(title, leave, arrive, endsAt, line, from, to, toward, departAt);
    }
}
