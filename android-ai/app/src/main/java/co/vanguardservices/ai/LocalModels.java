package co.vanguardservices.ai;

import android.content.Context;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import com.google.mediapipe.tasks.genai.llminference.LlmInferenceSession;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Offline models: MediaPipe LLM Inference running a model file stored in the app's private folder.
 * Model files come from the catalog below, any direct .task link, or a file already on the phone.
 */
final class LocalModels {
    /** A model the app knows how to fetch. Several links are tried in order. */
    static final class Entry {
        final String name, size, note;
        final List<String> urls;

        Entry(String name, String size, String note, String... urls) {
            this.name = name;
            this.size = size;
            this.note = note;
            this.urls = Arrays.asList(urls);
        }
    }

    private static final String HF = "https://huggingface.co/litert-community/";
    static final List<Entry> CATALOG = Arrays.asList(
            new Entry("qwen2.5-1.5b", "1.6 GB", "Fast and capable for its size. Good default for most phones (6 GB+ RAM).",
                    HF + "Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.task",
                    HF + "Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv1280.task"),
            new Entry("phi-4-mini", "3.9 GB", "Microsoft's Phi-4 mini. Better reasoning and writing; needs a recent phone with 8 GB+ RAM.",
                    HF + "Phi-4-mini-instruct/resolve/main/Phi-4-mini-instruct_multi-prefill-seq_q8_ekv4096.task",
                    HF + "Phi-4-mini-instruct/resolve/main/Phi-4-mini-instruct_multi-prefill-seq_q8_ekv1280.task"));

    private final Context context;
    private final File dir;
    private LlmInference engine;
    private String engineFile;

    LocalModels(Context context) {
        this.context = context.getApplicationContext();
        dir = new File(context.getFilesDir(), "models");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
    }

    // ---- What's installed ----

    /** Installed models as {name, size}; the name is the file name without extension. */
    JSONArray installed() throws JSONException {
        JSONArray out = new JSONArray();
        File[] files = dir.listFiles((d, n) -> n.endsWith(".task") || n.endsWith(".bin"));
        if (files == null) return out;
        Arrays.sort(files);
        for (File f : files) out.put(new JSONObject().put("name", baseName(f.getName())).put("size", f.length()));
        return out;
    }

    JSONArray catalog() throws JSONException {
        JSONArray out = new JSONArray();
        for (Entry e : CATALOG) out.put(new JSONObject().put("name", e.name).put("size", e.size).put("note", e.note));
        return out;
    }

    private static String baseName(String fileName) {
        int dot = fileName.lastIndexOf('.');
        return dot > 0 ? fileName.substring(0, dot) : fileName;
    }

    File file(String name) {
        for (String ext : new String[]{".task", ".bin"}) {
            File f = new File(dir, name + ext);
            if (f.exists()) return f;
        }
        return null;
    }

    synchronized void delete(String name) {
        File f = file(name);
        if (f == null) return;
        if (f.getAbsolutePath().equals(engineFile)) closeEngine();
        if (!f.delete()) throw new IllegalStateException("Could not remove " + name);
    }

    // ---- Getting models ----

    interface Progress {
        void update(String status, long done, long total);
    }

    /** Downloads a catalog model by name, or any direct https link to a .task file. */
    void download(String nameOrUrl, Progress progress) throws Exception {
        List<String> urls;
        String name;
        Entry entry = null;
        for (Entry e : CATALOG) if (e.name.equals(nameOrUrl)) entry = e;
        if (entry != null) {
            urls = entry.urls;
            name = entry.name;
        } else if (nameOrUrl.startsWith("https://")) {
            urls = Arrays.asList(nameOrUrl);
            String path = new URL(nameOrUrl).getPath();
            name = baseName(path.substring(path.lastIndexOf('/') + 1)).replaceAll("[^A-Za-z0-9._-]", "_");
        } else {
            throw new IllegalArgumentException("Pick a model from the list, or paste a direct https link to a .task model file.");
        }
        Exception last = null;
        for (String url : urls) {
            try {
                // The context size is part of the file name (…_ekv4096.task); keep it in ours.
                String suffix = kvSuffix(url);
                File target = new File(dir, (suffix == null || name.contains("ekv") ? name : name + "_" + suffix) + ".task");
                fetch(url, target, progress);
                return;
            } catch (Exception e) {
                last = e;
            }
        }
        throw last;
    }

    private static String kvSuffix(String s) {
        Matcher m = Pattern.compile("ekv(\\d+)").matcher(s);
        return m.find() ? "ekv" + m.group(1) : null;
    }

    private void fetch(String url, File target, Progress progress) throws IOException {
        File part = new File(target.getPath() + ".part");
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(60000);
        long have = part.exists() ? part.length() : 0;
        if (have > 0) conn.setRequestProperty("Range", "bytes=" + have + "-");
        int code = conn.getResponseCode();
        if (code == 401 || code == 403) {
            throw new IOException("This model needs a licence accepted on huggingface.co. Download it in your browser, then use Import file.");
        }
        if (code == 404) throw new IOException("Model file not found at " + url);
        if (code != 200 && code != 206) throw new IOException("Download failed (HTTP " + code + ")");
        boolean resume = code == 206;
        long total = conn.getContentLengthLong() + (resume ? have : 0);
        long done = resume ? have : 0;
        progress.update("downloading", done, total);
        try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(part, resume)) {
            byte[] buf = new byte[256 * 1024];
            long lastReport = 0;
            for (int n; (n = in.read(buf)) > 0; ) {
                out.write(buf, 0, n);
                done += n;
                if (done - lastReport > 4 * 1024 * 1024) {
                    progress.update("downloading", done, total);
                    lastReport = done;
                }
            }
        } finally {
            conn.disconnect();
        }
        if (total > 0 && done < total) throw new IOException("Download interrupted. Tap Download again to resume.");
        if (!part.renameTo(target)) throw new IOException("Could not save the model");
        progress.update("success", done, total);
    }

    /** Copies a model file the user picked (Downloads, Files app) into the app. */
    String importFrom(InputStream in, String fileName) throws IOException {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (!lower.endsWith(".task") && !lower.endsWith(".bin")) {
            throw new IOException("Pick a MediaPipe model file (.task). .litertlm and .gguf files are not supported.");
        }
        String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        File target = new File(dir, safe);
        File part = new File(dir, safe + ".part");
        try (FileOutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[256 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        }
        if (!part.renameTo(target)) throw new IOException("Could not save the model");
        return baseName(safe);
    }

    // ---- Running ----

    /** Tokens the model can hold (prompt + answer), from the ekv number in its file name. */
    static int contextTokens(String name) {
        String kv = kvSuffix(name);
        return kv == null ? 1024 : Integer.parseInt(kv.substring(3));
    }

    /** Chat format each model family was trained on. */
    static String prompt(String name, String system, List<JSONObject> history) throws JSONException {
        String n = name.toLowerCase(Locale.ROOT);
        StringBuilder sb = new StringBuilder();
        if (n.contains("gemma")) {
            // Gemma has no system role: it goes at the top of the first user turn.
            boolean first = true;
            for (JSONObject m : history) {
                boolean user = "user".equals(m.getString("role"));
                sb.append("<start_of_turn>").append(user ? "user" : "model").append('\n');
                if (user && first) sb.append(system).append("\n\n");
                if (user) first = false;
                sb.append(m.getString("content")).append("<end_of_turn>\n");
            }
            return sb.append("<start_of_turn>model\n").toString();
        }
        if (n.contains("phi")) {
            sb.append("<|system|>").append(system).append("<|end|>");
            for (JSONObject m : history) {
                sb.append("user".equals(m.getString("role")) ? "<|user|>" : "<|assistant|>").append(m.getString("content")).append("<|end|>");
            }
            return sb.append("<|assistant|>").toString();
        }
        // Qwen, DeepSeek and most others use ChatML.
        sb.append("<|im_start|>system\n").append(system).append("<|im_end|>\n");
        for (JSONObject m : history) {
            sb.append("<|im_start|>").append(m.getString("role")).append('\n').append(m.getString("content")).append("<|im_end|>\n");
        }
        return sb.append("<|im_start|>assistant\n").toString();
    }

    private synchronized LlmInference engine(File f, int maxTokens) {
        if (engine != null && f.getAbsolutePath().equals(engineFile)) return engine;
        closeEngine();
        LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                .setModelPath(f.getAbsolutePath())
                .setMaxTokens(maxTokens)
                .build();
        engine = LlmInference.createFromOptions(context, options);
        engineFile = f.getAbsolutePath();
        return engine;
    }

    synchronized void closeEngine() {
        if (engine != null) {
            try {
                engine.close();
            } catch (Exception ignored) {
                // Closing a broken engine.
            }
        }
        engine = null;
        engineFile = null;
    }

    /** Streams an answer. Blocks until done; text already streamed stays if the user stops. */
    void generate(String name, String prompt, Cloud.Cancel cancel, Consumer<String> onText) throws Exception {
        File f = file(name);
        if (f == null) throw new IllegalStateException("The offline model " + name + " is not on this phone any more.");
        LlmInference llm = engine(f, contextTokens(name));
        LlmInferenceSession session = LlmInferenceSession.createFromOptions(llm,
                LlmInferenceSession.LlmInferenceSessionOptions.builder().setTopK(40).setTemperature(0.6f).build());
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<Throwable> error = new AtomicReference<>();
        try {
            session.addQueryChunk(prompt);
            ListenableFuture<String> future = session.generateResponseAsync((partial, done) -> {
                if (!cancel.cancelled && partial != null && !partial.isEmpty()) onText.accept(partial);
                if (done) finished.countDown();
            });
            future.addListener(finished::countDown, Runnable::run);
            // Stop: stop waiting; the engine finishes the turn quietly and the session is closed.
            while (!finished.await(200, TimeUnit.MILLISECONDS)) {
                if (cancel.cancelled) break;
            }
            if (!cancel.cancelled) future.get();
        } catch (ExecutionException e) {
            error.set(e.getCause() == null ? e : e.getCause());
        } catch (Exception e) {
            error.set(e);
        } finally {
            if (!cancel.cancelled) session.close();
            else new Thread(() -> {
                try {
                    finished.await();
                } catch (InterruptedException ignored) {
                    // App closing.
                }
                session.close();
            }).start();
        }
        if (error.get() != null) {
            String msg = error.get().getMessage() == null ? "" : error.get().getMessage();
            if (msg.contains("exceed") || msg.contains("too long") || msg.contains("max_tokens")) {
                throw new IllegalStateException("Too much text for the offline model. Ask about a shorter document or start a new chat.");
            }
            throw new IllegalStateException("Offline model error: " + msg);
        }
    }
}
