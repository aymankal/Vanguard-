package co.vanguardservices.ai;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The page's window.api (see assets/web/android-api.js): the same calls the desktop app's
 * preload exposes, answered natively. Every call runs off the UI thread and resolves a promise.
 */
final class Bridge {
    interface Host {
        /** Lets the user pick documents; calls back with the chosen files (empty if cancelled). */
        void pickFiles(String[] mimeTypes, boolean multiple, java.util.function.Consumer<List<Uri>> done);

        /** Lets the user choose where to save a file; calls back with its location or null. */
        void createFile(String name, String mime, java.util.function.Consumer<Uri> done);

        void openExternal(String url);
    }

    private final Context context;
    private final WebView web;
    private final Host host;
    private final Store store;
    private final LocalModels local;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, Cloud.Cancel> running = new ConcurrentHashMap<>();

    Bridge(Context context, WebView web, Host host) {
        this.context = context;
        this.web = web;
        this.host = host;
        this.store = new Store(context);
        this.local = new LocalModels(context);
        Documents.init(context);
    }

    void shutdown() {
        for (Cloud.Cancel c : running.values()) c.cancel();
        local.closeEngine();
        pool.shutdownNow();
    }

    // ---- Plumbing ----

    @JavascriptInterface
    public void call(String id, String method, String argsJson) {
        pool.execute(() -> {
            try {
                JSONArray args = new JSONArray(argsJson);
                Object result = dispatch(method, args, id);
                if (result != PENDING) resolve(id, true, result);
            } catch (Throwable t) {
                String msg = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
                resolve(id, false, msg);
            }
        });
    }

    /** Marks calls that resolve later (after a picker closes). */
    private static final Object PENDING = new Object();

    /** Results travel as JSON text inside a JS string; errors as the plain message. */
    private void resolve(String id, boolean ok, Object value) {
        String payload;
        if (!ok) payload = JSONObject.quote(String.valueOf(value));
        else if (value == null) payload = "undefined";
        else payload = JSONObject.quote(value instanceof String ? JSONObject.quote((String) value) : String.valueOf(value));
        String js = "window.__vai.resolve(" + JSONObject.quote(id) + "," + ok + "," + payload + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    private void emit(String channel, JSONObject data) {
        String js = "window.__vai.emit(" + JSONObject.quote(channel) + "," + JSONObject.quote(data.toString()) + ")";
        web.post(() -> web.evaluateJavascript(js, null));
    }

    private Object dispatch(String method, JSONArray a, String id) throws Exception {
        switch (method) {
            case "state": return state();
            case "online": return online();
            case "saveSettings": return store.saveSettings(a.getJSONObject(0));
            case "setKey":
                store.setKey(a.getString(0), a.optString(1, ""));
                return state();
            case "refreshModels": return refreshModels(a.getString(0));
            case "openExternal":
                if (a.getString(0).startsWith("https://")) host.openExternal(a.getString(0));
                return null;
            case "pickFiles": return pickFiles(id);
            case "extractFiles": return new JSONArray();
            case "exportDocx": return export(id, a.getString(0), a.optString(1, ""), true);
            case "exportMd": return export(id, a.getString(0), a.optString(1, ""), false);
            case "getChats": return store.chats();
            case "saveChats":
                store.saveChats(a.getJSONArray(0));
                return null;
            case "ollamaStatus": return localStatus();
            case "ollamaPull": return pull(a.getString(0));
            case "ollamaDelete":
                local.delete(a.getString(0));
                return null;
            case "importLocalModel": return importModel(id);
            case "send":
                send(a.getJSONObject(0));
                return null;
            case "stop": {
                Cloud.Cancel c = running.get(a.getString(0));
                if (c != null) c.cancel();
                return null;
            }
            case "copy": {
                String text = a.getString(0);
                web.post(() -> ((ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE))
                        .setPrimaryClip(ClipData.newPlainText("Vanguard AI", text)));
                return null;
            }
            default: throw new IllegalArgumentException("Unknown call " + method);
        }
    }

    // ---- State ----

    private boolean online() {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkCapabilities caps = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    private JSONObject localStatus() throws JSONException {
        return new JSONObject().put("running", true).put("models", local.installed());
    }

    private JSONObject state() throws Exception {
        JSONObject settings = store.settings();
        JSONObject saved = settings.optJSONObject("models");
        JSONArray cloud = new JSONArray();
        for (Map.Entry<String, Cloud.Provider> e : Cloud.PROVIDERS.entrySet()) {
            JSONArray models = saved == null ? null : saved.optJSONArray(e.getKey());
            if (models == null || models.length() == 0) models = new JSONArray(e.getValue().models);
            cloud.put(new JSONObject()
                    .put("id", e.getKey())
                    .put("label", e.getValue().label)
                    .put("keyUrl", e.getValue().keyUrl)
                    .put("hasKey", store.key(e.getKey()) != null)
                    .put("models", models));
        }
        String version;
        try {
            version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception ignored) {
            version = "";
        }
        return new JSONObject()
                .put("settings", settings)
                .put("cloud", cloud)
                .put("online", online())
                .put("ollama", localStatus())
                .put("local", new JSONObject().put("kind", "device").put("catalog", local.catalog()))
                .put("platform", "android")
                .put("version", version);
    }

    private JSONArray refreshModels(String provider) throws Exception {
        String key = store.key(provider);
        if (key == null) throw new IllegalStateException("Add a key first");
        JSONArray ids = new JSONArray(Cloud.listModels(provider, key));
        JSONObject models = store.settings().optJSONObject("models");
        if (models == null) models = new JSONObject();
        models.put(provider, ids);
        store.saveSettings(new JSONObject().put("models", models));
        return ids;
    }

    // ---- Files ----

    private String displayName(Uri uri) {
        try (Cursor c = context.getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {
            // Fall back to the last path segment.
        }
        String last = uri.getLastPathSegment();
        return last == null ? "document" : last;
    }

    private Object pickFiles(String id) {
        host.pickFiles(new String[]{"*/*"}, true, uris -> pool.execute(() -> {
            JSONArray out = new JSONArray();
            for (Uri uri : uris) {
                String name = displayName(uri);
                try (InputStream in = context.getContentResolver().openInputStream(uri)) {
                    out.put(Documents.extract(name, in));
                } catch (Throwable t) {
                    try {
                        out.put(new JSONObject().put("ok", false).put("name", name).put("error", t.getMessage()));
                    } catch (JSONException ignored) {
                        // Can't happen with string values.
                    }
                }
            }
            resolve(id, true, out);
        }));
        return PENDING;
    }

    private Object export(String id, String markdown, String title, boolean word) {
        String base = (title.isEmpty() ? "Vanguard AI answer" : title).replaceAll("[\\\\/:*?\"<>|]", "");
        if (base.length() > 80) base = base.substring(0, 80);
        String name = base + (word ? ".docx" : ".md");
        String mime = word ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "text/markdown";
        host.createFile(name, mime, uri -> pool.execute(() -> {
            if (uri == null) {
                resolve(id, true, false);
                return;
            }
            try (OutputStream out = context.getContentResolver().openOutputStream(uri)) {
                out.write(word ? DocxWriter.fromMarkdown(markdown, title) : markdown.getBytes(StandardCharsets.UTF_8));
                resolve(id, true, true);
            } catch (Exception e) {
                resolve(id, false, "Could not save: " + e.getMessage());
            }
        }));
        return PENDING;
    }

    // ---- Offline models ----

    private JSONObject pull(String name) throws Exception {
        local.download(name, (status, done, total) -> {
            try {
                emit("ollama:progress", new JSONObject().put("name", name).put("status", status).put("completed", done).put("total", total));
            } catch (JSONException ignored) {
                // Numbers and strings only.
            }
        });
        return localStatus();
    }

    private Object importModel(String id) {
        host.pickFiles(new String[]{"application/octet-stream", "*/*"}, false, uris -> pool.execute(() -> {
            if (uris.isEmpty()) {
                resolve(id, true, false);
                return;
            }
            Uri uri = uris.get(0);
            try (InputStream in = context.getContentResolver().openInputStream(uri)) {
                String name = local.importFrom(in, displayName(uri));
                JSONObject s = store.settings();
                if (s.optString("localModel", "").isEmpty()) store.saveSettings(new JSONObject().put("localModel", name));
                resolve(id, true, true);
            } catch (Exception e) {
                resolve(id, false, e.getMessage());
            }
        }));
        return PENDING;
    }

    // ---- Chat (mirrors chat:send in desktop-ai/main.js) ----

    private static final int CLOUD_DOC_BUDGET = 600_000;
    private static final int OTHER_DOC_BUDGET = 300_000;

    private String systemPrompt(JSONObject settings, String context, boolean trimmed, boolean offline) {
        StringBuilder sb = new StringBuilder();
        if (offline) {
            // Small models do better with a short brief.
            sb.append("You are Vanguard AI, a concise assistant for Vanguard Services SAL, a Beirut-based outsourcing company. ")
              .append("You run offline on a phone: no web access. Be brief and use bullet points.\n");
        } else {
            sb.append("You are Vanguard AI, a sharp, practical assistant for Vanguard Services SAL, a Beirut-based outsourcing and BPO company (SDR teams, sales outsourcing, customer support).\n")
              .append("Be direct and concise. Use Markdown headings, bullets and tables when they make an answer easier to use. Answers are read on a phone: keep tables narrow.\n");
        }
        sb.append("Today is ").append(LocalDate.now()).append(".\n");
        if (!context.isEmpty()) {
            sb.append("The user attached the documents below. Answer from them, quote exact wording when it matters, and cite page or sheet references like [Page 3]. If the documents do not contain the answer, say so.\n");
            if (trimmed) sb.append("The documents were too long to include whole; you see the passages most relevant to the question, separated by […]. Mention this if the answer may depend on parts not shown.\n");
        }
        String custom = settings.optString("systemPrompt", "").trim();
        if (!custom.isEmpty()) sb.append("User instructions: ").append(custom).append('\n');
        if (!context.isEmpty()) sb.append('\n').append(context);
        return sb.toString();
    }

    private String pickLocal(JSONObject settings) throws JSONException {
        JSONArray models = local.installed();
        String want = settings.optString("localModel", "");
        for (int i = 0; i < models.length(); i++) if (models.getJSONObject(i).getString("name").equals(want)) return want;
        return models.length() > 0 ? models.getJSONObject(0).getString("name") : null;
    }

    private void send(JSONObject payload) throws JSONException {
        String requestId = payload.getString("requestId");
        JSONObject model = payload.getJSONObject("model");
        Cloud.Cancel cancel = new Cloud.Cancel();
        running.put(requestId, cancel);
        String provider = model.getString("provider");
        String modelId = model.getString("id");
        JSONObject target = new JSONObject().put("provider", provider).put("id", modelId);
        JSONObject settings = store.settings();
        try {
            if (!"ollama".equals(provider) && !online()) {
                if (!settings.optBoolean("autoOffline", true)) {
                    throw new IllegalStateException("You are offline. Switch to an offline model, or turn on \"Use a local model when offline\" in Settings.");
                }
                String localName = pickLocal(settings);
                if (localName == null) throw new IllegalStateException("You are offline and no offline model is on this phone. Download one in Settings → Offline models next time you have Wi-Fi.");
                provider = "ollama";
                modelId = localName;
                target = new JSONObject().put("provider", provider).put("id", modelId);
                chatEvent(requestId, "route", new JSONObject().put("model", target).put("reason", "Offline: answered by the model on this phone"));
            }
            boolean offline = "ollama".equals(provider);

            List<JSONObject> messages = Documents.list(payload.getJSONArray("messages"));
            List<JSONObject> docs = Documents.list(payload.optJSONArray("docs"));
            String question = messages.isEmpty() ? "" : messages.get(messages.size() - 1).getString("content");
            int budget;
            List<JSONObject> history;
            if (offline) {
                // Room for the question, the last exchange and a ~400-token answer, at ~3 characters a token.
                int tokens = LocalModels.contextTokens(modelId);
                budget = Math.max(600, (int) ((tokens - 400 - question.length() / 3) * 0.6) * 3);
                history = messages.subList(Math.max(0, messages.size() - 3), messages.size());
            } else {
                budget = "anthropic".equals(provider) || "google".equals(provider) ? CLOUD_DOC_BUDGET : OTHER_DOC_BUDGET;
                history = messages;
            }
            String[] ctx = Documents.buildContext(docs, question, budget);
            boolean trimmed = Boolean.parseBoolean(ctx[1]);
            if (trimmed) chatEvent(requestId, "status", new JSONObject().put("text", offline ? "Long document: reading the most relevant passages" : "Very long document: sending the most relevant passages"));
            String system = systemPrompt(settings, ctx[0], trimmed, offline);

            java.util.function.Consumer<String> onText = t -> {
                try {
                    chatEvent(requestId, "text", new JSONObject().put("text", t));
                } catch (JSONException ignored) {
                    // String values only.
                }
            };
            if (offline) {
                chatEvent(requestId, "status", new JSONObject().put("text", "Thinking on this phone…"));
                local.generate(modelId, LocalModels.prompt(modelId, system, new ArrayList<>(history)), cancel, onText);
            } else {
                String key = store.key(provider);
                Cloud.Provider p = Cloud.PROVIDERS.get(provider);
                if (key == null) throw new IllegalStateException("No API key for " + (p == null ? provider : p.label) + ". Add one in Settings.");
                if ("anthropic".equals(provider)) {
                    Cloud.streamAnthropic(key, modelId, system, history, settings.optBoolean("webSearch", true), cancel, onText, t -> {
                        try {
                            chatEvent(requestId, "status", new JSONObject().put("text", t));
                        } catch (JSONException ignored) {
                            // String values only.
                        }
                    });
                } else {
                    Cloud.streamOpenAICompatible(provider, key, modelId, system, history, cancel, onText);
                }
            }
            JSONObject done = new JSONObject().put("model", target);
            if (cancel.cancelled) done.put("stopped", true);
            chatEvent(requestId, "done", done);
        } catch (Throwable t) {
            if (cancel.cancelled) chatEvent(requestId, "done", new JSONObject().put("model", target).put("stopped", true));
            else chatEvent(requestId, "error", new JSONObject().put("message", friendlyError(t)));
        } finally {
            running.remove(requestId);
        }
    }

    private void chatEvent(String requestId, String type, JSONObject data) throws JSONException {
        data.put("requestId", requestId).put("type", type);
        emit("chat:event", data);
    }

    private static String friendlyError(Throwable t) {
        String cls = t.getClass().getSimpleName();
        String msg = t.getMessage() == null ? cls : t.getMessage();
        if (cls.contains("Unauthorized") || cls.contains("PermissionDenied")) return "The API key was rejected. Check it in Settings.";
        if (cls.contains("NotFound")) return "That model is not available on your account. Pick another, or refresh the model list in Settings.";
        if (cls.contains("RateLimit")) return "Rate limit or credit limit reached on this provider. Wait a moment, check billing, or switch model.";
        if (cls.contains("InternalServer") || cls.contains("Unexpected")) return "The provider is having trouble right now. Try again or switch model.";
        if (cls.contains("IoException") || cls.contains("UnknownHost") || cls.contains("SocketTimeout") || cls.contains("ConnectException")) {
            return "Could not reach the provider. Check your connection, or switch to an offline model.";
        }
        return msg;
    }
}
