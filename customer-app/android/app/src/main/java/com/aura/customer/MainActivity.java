package com.aura.customer;

import android.os.Build;
import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getBridge() != null) {
            getBridge().getWebView().setWebViewClient(new RecoveringBridgeWebViewClient(getBridge()));
        }
    }

    private static final class RecoveringBridgeWebViewClient extends BridgeWebViewClient {
        RecoveringBridgeWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            view.post(view::reload);
            return true;
        }
    }
}
