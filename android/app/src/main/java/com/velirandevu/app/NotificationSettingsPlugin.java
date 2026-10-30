package com.velirandevu.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {

    @PluginMethod
    public void getPushAvailability(PluginCall call) {
        boolean configured = false;
        try {
            // Inspect the existing default app; never initialize Firebase or add credentials.
            // Reflection keeps Firebase an optional runtime dependency of this host plugin.
            Class.forName("com.google.firebase.FirebaseApp").getMethod("getInstance").invoke(null);
            configured = true;
        } catch (ReflectiveOperationException | RuntimeException | LinkageError unavailable) {
            // Missing/uninitialized Firebase must be a recoverable feature state.
        }
        JSObject result = new JSObject();
        result.put("configured", configured);
        call.resolve(result);
    }

    @PluginMethod
    public void areNotificationsEnabled(PluginCall call) {
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String packageName = getContext().getPackageName();
        try {
            Intent notificationSettings = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            notificationSettings.putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
            if (notificationSettings.resolveActivity(getContext().getPackageManager()) == null) {
                throw new IllegalStateException("Notification settings are not available");
            }
            getActivity().startActivity(notificationSettings);
            call.resolve();
        } catch (RuntimeException notificationSettingsError) {
            try {
                Intent applicationSettings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                applicationSettings.setData(Uri.fromParts("package", packageName, null));
                getActivity().startActivity(applicationSettings);
                call.resolve();
            } catch (RuntimeException applicationSettingsError) {
                call.reject("Notification settings could not be opened", applicationSettingsError);
            }
        }
    }
}
