package ir.arklyn.besrah;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "پایان سفر" from the notification itself. The web card is ended the next time the app is opened. */
public class TripActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) { TripNotifier.cancel(context); }
}
