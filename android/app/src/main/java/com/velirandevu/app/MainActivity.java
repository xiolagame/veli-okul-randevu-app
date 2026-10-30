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
