package com.velirandevu.app;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidSystemBarsPlugin.class);
        registerPlugin(NotificationSettingsPlugin.class);
        registerPlugin(CameraPermissionPlugin.class);
        super.onCreate(savedInstanceState);
        // Sayfa kenara gelince sert durmasın: Android'in doğal kenar efekti (eski sürümlerde parıltı,
        // Android 12+ esneme) içerik kayarken açık kalsın.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().setOverScrollMode(android.view.View.OVER_SCROLL_IF_CONTENT_SCROLLS);
        }
        WindowCompat.enableEdgeToEdge(getWindow());
        AndroidSystemBarsPlugin.restore(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        AndroidSystemBarsPlugin.restore(this);
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration configuration) {
        super.onConfigurationChanged(configuration);
        AndroidSystemBarsPlugin.restore(this);
    }
}
