package com.velirandevu.app;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "CameraPermission",
    permissions = @Permission(strings = { Manifest.permission.CAMERA }, alias = CameraPermissionPlugin.CAMERA_PERMISSION)
)
public class CameraPermissionPlugin extends Plugin {

    static final String CAMERA_PERMISSION = "camera";

    @PluginMethod
    public void checkCameraPermission(PluginCall call) {
        resolvePermission(call);
    }

    @PluginMethod
    public void requestCameraPermission(PluginCall call) {
        if (getPermissionState(CAMERA_PERMISSION) == PermissionState.GRANTED) {
            resolvePermission(call);
            return;
        }
        requestPermissionForAlias(CAMERA_PERMISSION, call, "cameraPermissionCallback");
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PermissionCallback
    private void cameraPermissionCallback(PluginCall call) {
        resolvePermission(call);
    }

    private void resolvePermission(PluginCall call) {
        PermissionState permissionState = getPermissionState(CAMERA_PERMISSION);
        String state;
        if (permissionState == PermissionState.GRANTED) {
            state = "granted";
        } else if (permissionState == PermissionState.PROMPT_WITH_RATIONALE) {
            state = "rationale";
        } else if (permissionState == PermissionState.DENIED) {
            state = "permanently-denied";
        } else {
            state = "prompt";
        }
        JSObject result = new JSObject();
        result.put("state", state);
        call.resolve(result);
    }
}
