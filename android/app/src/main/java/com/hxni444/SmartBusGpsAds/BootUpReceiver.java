package com.hxni444.SmartBusGpsAds;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;

public class BootUpReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(final Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || 
            "android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) {

            // 1. Force enable the Accessibility Auto-Clicker service using root.
            // This ensures the ghost clicker is always running without manual user setup.
            try {
                Process p = Runtime.getRuntime().exec("su");
                java.io.DataOutputStream os = new java.io.DataOutputStream(p.getOutputStream());
                os.writeBytes("settings put secure enabled_accessibility_services com.hxni444.SmartBusGpsAds/com.hxni444.SmartBusGpsAds.UsbAutoClickerService\n");
                os.writeBytes("settings put secure accessibility_enabled 1\n");
                os.writeBytes("exit\n");
                os.flush();
                p.waitFor();
            } catch (Exception e) {
                // Ignore errors
            }

            // 2. Launch the app with a slight delay
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    Intent launchIntent = new Intent(context, MainActivity.class);
                    launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(launchIntent);
                }
            }, 3000);
        }
    }
}
