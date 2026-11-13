package app.vibe.wallet;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.net.Uri;
import android.view.View;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int MIC_REQUEST = 42;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[] { Manifest.permission.RECORD_AUDIO, Manifest.permission.MODIFY_AUDIO_SETTINGS },
                    MIC_REQUEST);
        }
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        // Hands-free mode speaks replies without a fresh tap each time.
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= 26) {
            WebChromeClient current = webView.getWebChromeClient();
            webView.setWebChromeClient(new MicGrantChromeClient(current));
        }
    }
}

/**
 * Grants WebView microphone (and other) permission requests immediately after the
 * Android runtime permission is available, while delegating the rest of Capacitor's
 * Chrome client behavior.
 */
class MicGrantChromeClient extends WebChromeClient {
    private final WebChromeClient delegate;

    MicGrantChromeClient(WebChromeClient delegate) {
        this.delegate = delegate;
    }

    @Override
    public void onPermissionRequest(final PermissionRequest request) {
        if (request == null) return;
        request.grant(request.getResources());
    }

    @Override
    public void onShowCustomView(View view, CustomViewCallback callback) {
        if (delegate != null) delegate.onShowCustomView(view, callback);
        else super.onShowCustomView(view, callback);
    }

    @Override
    public void onHideCustomView() {
        if (delegate != null) delegate.onHideCustomView();
        else super.onHideCustomView();
    }

    @Override
    public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
        if (delegate != null) return delegate.onJsAlert(view, url, message, result);
        return super.onJsAlert(view, url, message, result);
    }

    @Override
    public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
        if (delegate != null) return delegate.onJsConfirm(view, url, message, result);
        return super.onJsConfirm(view, url, message, result);
    }

    @Override
    public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
        if (delegate != null) return delegate.onJsPrompt(view, url, message, defaultValue, result);
        return super.onJsPrompt(view, url, message, defaultValue, result);
    }

    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        if (delegate != null) delegate.onGeolocationPermissionsShowPrompt(origin, callback);
        else super.onGeolocationPermissionsShowPrompt(origin, callback);
    }

    @Override
    public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            FileChooserParams fileChooserParams) {
        if (delegate != null) return delegate.onShowFileChooser(webView, filePathCallback, fileChooserParams);
        return super.onShowFileChooser(webView, filePathCallback, fileChooserParams);
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
        if (delegate != null) return delegate.onConsoleMessage(consoleMessage);
        return super.onConsoleMessage(consoleMessage);
    }
}
