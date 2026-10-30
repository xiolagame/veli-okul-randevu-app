package com.velirandevu.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AndroidSystemBars")
public class AndroidSystemBarsPlugin extends Plugin {
    private static final String PREFERENCES = "veli-system-bars";

    static void restore(Activity activity) {
        SharedPreferences preferences = activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        boolean systemDark = (activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
            == Configuration.UI_MODE_NIGHT_YES;
        applyWindow(activity, preferences.getBoolean("dark", systemDark), preferences.getBoolean("login", true));
    }

    @SuppressWarnings("deprecation")
    private static void applyWindow(Activity activity, boolean dark, boolean login) {
        Window window = activity.getWindow();
        int background = Color.parseColor(login ? "#123f34" : dark ? "#101c19" : "#f6f8f7");
        window.setBackgroundDrawable(new ColorDrawable(background));
        window.getDecorView().setBackgroundColor(background);
        window.setStatusBarColor(Color.TRANSPARENT);
        // API 24/25 cannot render dark navigation icons, so retain a dark fallback.
        window.setNavigationBarColor(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? Color.TRANSPARENT : Color.parseColor("#123f34"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) window.setNavigationBarDividerColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        boolean darkIcons = !dark && !login;
        controller.setAppearanceLightStatusBars(darkIcons);
        controller.setAppearanceLightNavigationBars(darkIcons && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        // Capacitor's SystemBars owns insets/IME resizing; do not replace its listener.
    }

    @PluginMethod
    public void apply(PluginCall call) {
        String theme = call.getString("theme");
        if (!"light".equals(theme) && !"dark".equals(theme)) { call.reject("Invalid theme"); return; }
        boolean dark = "dark".equals(theme);
        boolean login = Boolean.TRUE.equals(call.getBoolean("login", true));
        getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
            .putBoolean("dark", dark).putBoolean("login", login).apply();
        getActivity().runOnUiThread(() -> { applyWindow(getActivity(), dark, login); call.resolve(); });
    }
}
