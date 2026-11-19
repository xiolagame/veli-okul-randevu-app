package com.velirandevu.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        NativeThemePlugin.applyWindow(this, NativeThemePlugin.isDark(this));
        registerPlugin(NativeThemePlugin.class);
        registerPlugin(NotificationSettingsPlugin.class);
        registerPlugin(CameraPermissionPlugin.class);
        super.onCreate(savedInstanceState);
        NativeThemePlugin.applyWindow(this, NativeThemePlugin.isDark(this));
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().setBackgroundColor(android.graphics.Color.parseColor(NativeThemePlugin.isDark(this) ? "#0b1712" : "#f6f8f7"));
    }

    @Override
    public void onResume() {
        super.onResume();
        NativeThemePlugin.applyWindow(this, NativeThemePlugin.isDark(this));
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration);
        NativeThemePlugin.applyWindow(this, NativeThemePlugin.isDark(this));
    }
}
