package co.vanguardservices.ai;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/**
 * Vanguard AI for Android: the desktop app's interface (bundled in assets/web) in a WebView, with
 * Bridge answering its calls natively. Nothing is loaded from the web; links open in the browser.
 */
public class MainActivity extends Activity implements Bridge.Host {

    // A fixed https origin for the bundled files, so the page runs as a secure context.
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START = ORIGIN + "/assets/web/renderer/index.html";
    private static final int PICK = 1;
    private static final int CREATE = 2;

    private WebView web;
    private Bridge bridge;
    private Consumer<List<Uri>> pendingPick;
    private Consumer<Uri> pendingCreate;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0f1115"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        s.setTextZoom(100);

        bridge = new Bridge(this, web, this);
        web.addJavascriptInterface(bridge, "VAIBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!u.toString().startsWith(ORIGIN + "/assets/")) return null;
                String path = u.getPath().substring("/assets/".length());
                try {
                    InputStream in = getAssets().open(path);
                    return new WebResourceResponse(mime(path), "utf-8", in);
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u.toString().startsWith(ORIGIN + "/")) return false;
                openExternal(u.toString());
                return true;
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        // Back closes Settings or the chat list first, then leaves the app.
        web.evaluateJavascript(
                "(() => { const d = document.querySelector('#settings'); if (d && d.open) { d.close(); return true; }"
                        + " if (document.body.classList.contains('drawer-open')) { document.body.classList.remove('drawer-open'); return true; }"
                        + " return false; })()",
                handled -> {
                    if (!"true".equals(handled)) super.onBackPressed();
                });
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.shutdown();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ---- Bridge.Host ----

    @Override
    public void pickFiles(String[] mimeTypes, boolean multiple, Consumer<List<Uri>> done) {
        runOnUiThread(() -> {
            pendingPick = done;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
            if (mimeTypes.length > 1 || !"*/*".equals(mimeTypes[0])) i.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
            try {
                startActivityForResult(i, PICK);
            } catch (ActivityNotFoundException e) {
                pendingPick = null;
                done.accept(new ArrayList<>());
            }
        });
    }

    @Override
    public void createFile(String name, String mime, Consumer<Uri> done) {
        runOnUiThread(() -> {
            pendingCreate = done;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(mime)
                    .putExtra(Intent.EXTRA_TITLE, name);
            try {
                startActivityForResult(i, CREATE);
            } catch (ActivityNotFoundException e) {
                pendingCreate = null;
                done.accept(null);
            }
        });
    }

    @Override
    public void openExternal(String url) {
        runOnUiThread(() -> {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, "No app can open this link", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK && pendingPick != null) {
            List<Uri> uris = new ArrayList<>();
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            }
            Consumer<List<Uri>> cb = pendingPick;
            pendingPick = null;
            cb.accept(uris);
        } else if (requestCode == CREATE && pendingCreate != null) {
            Consumer<Uri> cb = pendingCreate;
            pendingCreate = null;
            cb.accept(resultCode == RESULT_OK && data != null ? data.getData() : null);
        }
    }
}
