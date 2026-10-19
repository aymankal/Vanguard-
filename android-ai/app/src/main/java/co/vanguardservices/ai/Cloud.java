package co.vanguardservices.ai;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.http.StreamResponse;
import com.anthropic.helpers.BetaMessageAccumulator;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaRawMessageStreamEvent;
import com.anthropic.models.beta.messages.BetaStopReason;
import com.anthropic.models.beta.messages.BetaWebSearchTool20260209;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.openai.client.OpenAIClient;
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.chat.completions.ChatCompletionChunk;
import com.openai.models.chat.completions.ChatCompletionCreateParams;

import org.json.JSONObject;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/**
 * Cloud providers: Claude through the Anthropic SDK, everything else through providers'
 * OpenAI-compatible endpoints with the OpenAI SDK. Mirrors desktop-ai/src/providers.js.
 */
final class Cloud {
    static final class Provider {
        final String label, keyUrl, baseUrl;
        final List<String> models;

        Provider(String label, String keyUrl, String baseUrl, List<String> models) {
            this.label = label;
            this.keyUrl = keyUrl;
            this.baseUrl = baseUrl;
            this.models = models;
        }
    }

    static final Map<String, Provider> PROVIDERS = new LinkedHashMap<>();

    static {
        // Starting lists. Settings → Refresh replaces them with what each key can actually use.
        PROVIDERS.put("anthropic", new Provider("Anthropic (Claude)", "https://console.anthropic.com/settings/keys", null,
                Arrays.asList("claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5")));
        PROVIDERS.put("openai", new Provider("OpenAI (GPT)", "https://platform.openai.com/api-keys", "https://api.openai.com/v1", Collections.emptyList()));
        PROVIDERS.put("google", new Provider("Google (Gemini)", "https://aistudio.google.com/apikey", "https://generativelanguage.googleapis.com/v1beta/openai", Collections.emptyList()));
        PROVIDERS.put("xai", new Provider("xAI (Grok)", "https://console.x.ai", "https://api.x.ai/v1", Collections.emptyList()));
        PROVIDERS.put("deepseek", new Provider("DeepSeek", "https://platform.deepseek.com/api_keys", "https://api.deepseek.com", Collections.emptyList()));
        PROVIDERS.put("mistral", new Provider("Mistral", "https://console.mistral.ai/api-keys", "https://api.mistral.ai/v1", Collections.emptyList()));
        PROVIDERS.put("openrouter", new Provider("OpenRouter (any model, one key)", "https://openrouter.ai/keys", "https://openrouter.ai/api/v1", Collections.emptyList()));
    }

    // Chat models only: provider model lists also carry embedding, audio, image and moderation models.
    private static final Pattern NON_CHAT = Pattern.compile(
            "(?i)embed|whisper|tts|audio|realtime|transcribe|dall-e|image|moderation|search-preview|babbage|davinci|aqa|imagen|veo");
    // Claude models that take the dynamic-filtering web search tool.
    private static final Pattern WEB_SEARCH_MODELS = Pattern.compile("^claude-(opus-(5|4-[678])|sonnet-(5|4-6)|fable-5)");

    private Cloud() {}

    private static AnthropicClient anthropic(String key) {
        return AnthropicOkHttpClient.builder().apiKey(key).timeout(Duration.ofMinutes(10)).build();
    }

    private static OpenAIClient openai(String provider, String key) {
        return OpenAIOkHttpClient.builder().apiKey(key).baseUrl(PROVIDERS.get(provider).baseUrl).timeout(Duration.ofMinutes(10)).build();
    }

    static List<String> listModels(String provider, String key) {
        List<String> ids = new ArrayList<>();
        if ("anthropic".equals(provider)) {
            anthropic(key).models().list().autoPager().forEach(m -> ids.add(m.id()));
            return ids;
        }
        openai(provider, key).models().list().autoPager().forEach(m -> {
            String id = m.id().replaceFirst("^models/", "");
            if (!NON_CHAT.matcher(id).find()) ids.add(id);
        });
        Collections.sort(ids, Collections.reverseOrder());
        return ids;
    }

    /** Lets Stop close the open stream from another thread. */
    static final class Cancel {
        private volatile AutoCloseable open;
        volatile boolean cancelled;

        void set(AutoCloseable c) {
            open = c;
            if (cancelled) cancel();
        }

        void cancel() {
            cancelled = true;
            AutoCloseable c = open;
            if (c != null) {
                try {
                    c.close();
                } catch (Exception ignored) {
                    // Already closed.
                }
            }
        }
    }

    static void streamAnthropic(String key, String model, String system, List<JSONObject> history, boolean webSearch,
                                Cancel cancel, Consumer<String> onText, Consumer<String> onStatus) throws Exception {
        AnthropicClient client = anthropic(key);
        MessageCreateParams.Builder params = MessageCreateParams.builder()
                .model(model)
                .maxTokens(64000L)
                .system(system)
                .addBeta("server-side-fallback-2026-07-01")
                .fallbacksDefault();
        if (webSearch && WEB_SEARCH_MODELS.matcher(model).find()) {
            params.addTool(BetaWebSearchTool20260209.builder().maxUses(5L).build());
        }
        for (JSONObject m : history) {
            if ("user".equals(m.getString("role"))) params.addUserMessage(m.getString("content"));
            else params.addAssistantMessage(m.getString("content"));
        }
        // Web search can pause a long turn; send it back to let the model carry on.
        for (int round = 0; round < 4; round++) {
            BetaMessageAccumulator acc = BetaMessageAccumulator.create();
            try (StreamResponse<BetaRawMessageStreamEvent> stream = client.beta().messages().createStreaming(params.build())) {
                cancel.set(stream);
                stream.stream().forEach(event -> {
                    acc.accumulate(event);
                    event.contentBlockStart().ifPresent(start -> {
                        if (start.contentBlock().isServerToolUse()) onStatus.accept("Searching the web…");
                    });
                    event.contentBlockDelta().ifPresent(d -> d.delta().text().ifPresent(t -> onText.accept(t.text())));
                });
            }
            if (cancel.cancelled) return;
            BetaMessage message = acc.message();
            BetaStopReason stop = message.stopReason().orElse(null);
            if (BetaStopReason.REFUSAL.equals(stop)) {
                onText.accept("\n\n_The model declined this request._");
                return;
            }
            if (BetaStopReason.MAX_TOKENS.equals(stop)) onText.accept("\n\n_Answer cut off at the length limit._");
            if (!BetaStopReason.PAUSE_TURN.equals(stop)) return;
            params.addMessage(message);
        }
    }

    static void streamOpenAICompatible(String provider, String key, String model, String system, List<JSONObject> history,
                                       Cancel cancel, Consumer<String> onText) throws Exception {
        ChatCompletionCreateParams.Builder params = ChatCompletionCreateParams.builder().model(model).addSystemMessage(system);
        for (JSONObject m : history) {
            if ("user".equals(m.getString("role"))) params.addUserMessage(m.getString("content"));
            else params.addAssistantMessage(m.getString("content"));
        }
        try (com.openai.core.http.StreamResponse<ChatCompletionChunk> stream = openai(provider, key).chat().completions().createStreaming(params.build())) {
            cancel.set(stream);
            stream.stream().forEach(chunk -> {
                if (!chunk.choices().isEmpty()) chunk.choices().get(0).delta().content().ifPresent(onText);
            });
        }
    }
}
