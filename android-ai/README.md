# Vanguard AI for Android

The [desktop app](../desktop-ai/README.md) on your phone, with the same interface and the same models.
Online you get Claude, GPT, Gemini, Grok, DeepSeek, Mistral and OpenRouter. Offline, a small model
runs on the phone itself, so you can still draft, summarise and ask quick questions in airplane mode.

## Download
https://github.com/aymankal/Vanguard-/releases/download/vanguard-ai-android/VanguardAI.apk

On the phone: download it, open it, allow installs from your browser if Android asks, then tap Install.
It needs Android 8 or later on a 64-bit phone (almost every phone since 2017).

## Set up
1. ☰ → **Settings** → paste API keys (Claude, OpenAI, Gemini…). They're encrypted with the
   phone's Android Keystore.
2. **Offline models** → download one on Wi-Fi:
   - **qwen2.5-1.5b** (1.6 GB) is the default. It runs on most phones with 6 GB+ RAM.
   - **phi-4-mini** (3.9 GB) writes better and needs a recent phone with 8 GB+ RAM.
   - **Import file** loads any MediaPipe `.task` model you've already downloaded, for example Gemma
     from huggingface.co/litert-community (Gemma needs its licence accepted there first).
   - Or paste a direct link to a `.task` file.

## What to expect offline
Phone models are far smaller than Claude or GPT. They hold roughly 1,000 to 4,000 tokens (2 to 6 pages, depending on the model file), so
long documents are cut to the passages that best match the question. Use them for drafts, short
documents and quick answers, and the cloud models for full contracts and serious analysis. The
first answer after opening the app takes a few seconds longer while the model loads.

## How it's built
- The interface is `desktop-ai/renderer`, copied in at build time, so both apps stay identical.
  `assets/web/android-api.js` gives it the same `window.api` the desktop preload does.
- `Bridge.java` answers those calls natively: chat routing and offline fallback, documents
  (`Documents.java`: PDF via PdfBox, Word, Excel, text), Word export (`DocxWriter.java`), and
  storage (`Store.java`).
- `Cloud.java` covers Claude via the Anthropic Java SDK and other providers via the OpenAI Java SDK.
- `LocalModels.java` runs offline models through Google's MediaPipe LLM Inference.

## Builds
`.github/workflows/android-ai.yml` builds on every change to `android-ai/` or the shared interface.
To build locally: `npm ci --ignore-scripts` in `desktop-ai`, then `gradle assembleRelease` in
`android-ai` (needs the Android SDK).

Signing works like the other apps: add `VANGUARD_AI_KEYSTORE_BASE64`, `VANGUARD_AI_KEYSTORE_PASSWORD`,
`VANGUARD_AI_KEY_ALIAS` and `VANGUARD_AI_KEY_PASSWORD` secrets before any Play Store release.
