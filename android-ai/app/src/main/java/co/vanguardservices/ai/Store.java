package co.vanguardservices.ai;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.Iterator;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Settings, chats and API keys, all in the app's private storage. Keys are encrypted with a key
 * held in the Android Keystore, so a copied backup can't be read on another phone.
 */
final class Store {
    private static final String KEY_ALIAS = "vanguard-ai-keys";
    private final File dir;

    Store(Context context) {
        dir = context.getFilesDir();
    }

    // ---- JSON files ----

    private synchronized String read(String name) {
        File f = new File(dir, name);
        if (!f.exists()) return null;
        try {
            return new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private synchronized void write(String name, String text) {
        File tmp = new File(dir, name + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (Exception e) {
            throw new RuntimeException("Could not save " + name, e);
        }
        if (!tmp.renameTo(new File(dir, name))) throw new RuntimeException("Could not save " + name);
    }

    JSONObject settings() {
        JSONObject s = new JSONObject();
        try {
            s.put("model", new JSONObject().put("provider", "anthropic").put("id", "claude-opus-5-5"));
            s.put("localModel", "");
            s.put("autoOffline", true);
            s.put("webSearch", true);
            s.put("systemPrompt", "");
            s.put("models", new JSONObject());
            String saved = read("settings.json");
            if (saved != null) merge(s, new JSONObject(saved));
        } catch (JSONException ignored) {
            // Damaged settings fall back to the defaults.
        }
        return s;
    }

    JSONObject saveSettings(JSONObject patch) throws JSONException {
        JSONObject s = settings();
        merge(s, patch);
        write("settings.json", s.toString());
        return s;
    }

    private static void merge(JSONObject into, JSONObject from) throws JSONException {
        for (Iterator<String> it = from.keys(); it.hasNext(); ) {
            String k = it.next();
            into.put(k, from.get(k));
        }
    }

    JSONArray chats() {
        try {
            String saved = read("chats.json");
            return saved == null ? new JSONArray() : new JSONArray(saved);
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    void saveChats(JSONArray chats) {
        write("chats.json", chats.toString());
    }

    // ---- API keys ----

    private SecretKey secretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return (SecretKey) ks.getKey(KEY_ALIAS, null);
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return gen.generateKey();
    }

    private JSONObject rawKeys() {
        try {
            String saved = read("keys.json");
            return saved == null ? new JSONObject() : new JSONObject(saved);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    synchronized String key(String provider) {
        String enc = rawKeys().optString(provider, "");
        if (enc.isEmpty()) return null;
        try {
            byte[] all = Base64.decode(enc, Base64.NO_WRAP);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, all, 0, 12));
            return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null; // Keystore reset (new phone, restored backup): the user re-enters it.
        }
    }

    synchronized void setKey(String provider, String key) throws Exception {
        JSONObject keys = rawKeys();
        if (key == null || key.trim().isEmpty()) {
            keys.remove(provider);
        } else {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, secretKey());
            byte[] iv = c.getIV();
            byte[] body = c.doFinal(key.trim().getBytes(StandardCharsets.UTF_8));
            byte[] all = new byte[iv.length + body.length];
            System.arraycopy(iv, 0, all, 0, iv.length);
            System.arraycopy(body, 0, all, iv.length, body.length);
            keys.put(provider, Base64.encodeToString(all, Base64.NO_WRAP));
        }
        write("keys.json", keys.toString());
    }
}
