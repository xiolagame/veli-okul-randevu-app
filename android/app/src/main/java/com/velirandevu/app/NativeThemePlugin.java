package com.velirandevu.app;

import android.app.Activity;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeTheme")
public class NativeThemePlugin extends Plugin {
    static boolean isDark(Context context) {
        String choice = context.getSharedPreferences("veli-theme", Context.MODE_PRIVATE).getString("selected", null);
        return choice == null
            ? (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
            : choice.equals("dark");
    }

    static void applyWindow(Activity activity, boolean dark) {
        int color = Color.parseColor(dark ? "#0b1712" : "#f6f8f7");
        activity.getWindow().setBackgroundDrawable(new ColorDrawable(color));
        activity.getWindow().setStatusBarColor(color);
        activity.getWindow().setNavigationBarColor(color);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(activity.getWindow(), activity.getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }

    @PluginMethod
    public void apply(PluginCall call) {
        String theme = call.getString("theme");
        if (!"dark".equals(theme) && !"light".equals(theme)) { call.reject("Invalid theme"); return; }
        android.content.SharedPreferences.Editor editor = getContext().getSharedPreferences("veli-theme", Context.MODE_PRIVATE).edit();
        if (Boolean.TRUE.equals(call.getBoolean("manual", false))) editor.putString("selected", theme);
        else editor.remove("selected");
        editor.apply();
        getActivity().runOnUiThread(() -> {
            boolean dark = "dark".equals(theme);
            applyWindow(getActivity(), dark);
            if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().setBackgroundColor(Color.parseColor(dark ? "#0b1712" : "#f6f8f7"));
            call.resolve();
        });
    }
}
