package co.vanguardservices.deskai;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

/**
 * Scout Desk AI: opens the Scout Desk Claude artifact full screen in a Chrome Custom Tab.
 *
 * A Custom Tab shares Chrome's sign-in, so the claude.ai session (and Google sign-in, which an
 * embedded WebView blocks) works, along with everything the artifact uses: its shared database,
 * the viewer's identity and the Crunchbase connector. The link never changes when the artifact is
 * edited from Claude, so updates show up on the next open without reinstalling.
 *
 * This activity is only a launcher: it opens the tab, and when the tab is closed it closes too.
 */
public class MainActivity extends Activity {

    private boolean tabOpened;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tabOpened = savedInstanceState != null && savedInstanceState.getBoolean("tabOpened");
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (tabOpened) {
            // Back from the tab: leave instead of showing an empty screen.
            finish();
            return;
        }
        tabOpened = true;
        open(Uri.parse(getString(R.string.desk_url)));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putBoolean("tabOpened", tabOpened);
    }

    private void open(Uri url) {
        int navy = Color.parseColor("#0B1220");
        CustomTabColorSchemeParams colors = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(navy)
                .setNavigationBarColor(navy)
                .build();
        CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
                .setShowTitle(true)
                .setUrlBarHidingEnabled(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
                .setStartAnimations(this, android.R.anim.fade_in, android.R.anim.fade_out)
                .build();

        // Prefer Chrome (or whichever browser supports Custom Tabs) so the claude.ai login is shared.
        String pkg = CustomTabsClient.getPackageName(this, null);
        if (pkg != null) tab.intent.setPackage(pkg);

        try {
            tab.launchUrl(this, url);
        } catch (ActivityNotFoundException e) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, url));
            } catch (ActivityNotFoundException e2) {
                Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
                finish();
            }
        }
    }
}
