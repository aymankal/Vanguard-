package co.vanguardservices.scoutdesk;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/**
 * Scout Desk for Android: the live desk (aymankal.github.io/Vanguard-/scout-desk/) full screen,
 * with sign-in kept between launches. Pages on the desk and Supabase stay in the app; any other
 * link (LinkedIn, a pitch deck, a website) opens in the phone's browser.
 */
public class MainActivity extends ComponentActivity {

    private static final String DESK_HOST = "aymankal.github.io";
    private static final String DESK_PATH = "/Vanguard-/scout-desk";
    private static final String SUPABASE_HOST = "awmeixsvltzdspwnamyf.supabase.co";

    private WebView web;
    private SwipeRefreshLayout refresh;
    private ValueCallback<Uri[]> pendingFiles;

    private final ActivityResultLauncher<Intent> pickFile = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (pendingFiles == null) return;
                pendingFiles.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData()));
                pendingFiles = null;
            });

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B1220"));
        refresh = new SwipeRefreshLayout(this);
        refresh.addView(web);
        refresh.setOnRefreshListener(() -> web.reload());
        // Only pull-to-refresh from the very top, so scrolling lists never reloads the page.
        refresh.setOnChildScrollUpCallback((parent, child) -> web.getScrollY() > 0);
        setContentView(refresh);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        // Lets the page know it runs inside the app (it hides its own Install buttons).
        s.setUserAgentString(s.getUserAgentString() + " ScoutDeskAndroid/" + BuildConfigCompat.versionName(this));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (isInApp(u)) return false;
                openOutside(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                refresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    refresh.setRefreshing(false);
                    Toast.makeText(MainActivity.this, R.string.offline, Toast.LENGTH_LONG).show();
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("*/*");
                try {
                    pickFile.launch(Intent.createChooser(pick, "Choose a file"));
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(startUrl(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // A confirmation or password-reset link tapped while the app is open.
        Uri u = intent.getData();
        if (u != null && isInApp(u)) web.loadUrl(u.toString());
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    private String startUrl(Intent intent) {
        Uri u = intent != null ? intent.getData() : null;
        return u != null && isInApp(u) ? u.toString() : getString(R.string.desk_url);
    }

    private static boolean isInApp(Uri u) {
        String host = u.getHost();
        if (host == null || !"https".equals(u.getScheme())) return false;
        if (host.equals(SUPABASE_HOST)) return true;
        String path = u.getPath() == null ? "" : u.getPath();
        return host.equals(DESK_HOST) && path.startsWith(DESK_PATH);
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, u.toString(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            ((android.view.ViewGroup) web.getParent()).removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    /** Reads versionName without depending on generated BuildConfig. */
    static final class BuildConfigCompat {
        static String versionName(ComponentActivity a) {
            try {
                return a.getPackageManager().getPackageInfo(a.getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "1";
            }
        }
    }
}
