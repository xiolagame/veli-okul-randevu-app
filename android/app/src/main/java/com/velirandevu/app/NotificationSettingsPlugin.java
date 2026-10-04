package com.velirandevu.app;

import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {

    @PluginMethod
    public void areNotificationsEnabled(PluginCall call) {
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}
