# Vanguard AI (desktop)

One desktop app for every flagship model, built for document work. Online it uses Claude, GPT,
Gemini, Grok, DeepSeek, Mistral or anything on OpenRouter. Offline it switches to a model running on
your own computer, so contracts and reports still get read, summarised and drafted with no internet.

## Download

| System  | Installer |
| ------- | --------- |
| Windows | [VanguardAI-Setup.exe](https://github.com/aymankal/Vanguard-/releases/download/vanguard-ai/VanguardAI-Setup.exe) |
| macOS   | [VanguardAI-mac.dmg](https://github.com/aymankal/Vanguard-/releases/download/vanguard-ai/VanguardAI-mac.dmg) (Apple Silicon and Intel) |
| Linux   | [VanguardAI-linux.AppImage](https://github.com/aymankal/Vanguard-/releases/download/vanguard-ai/VanguardAI-linux.AppImage) |

GitHub Actions builds these on every push that touches `desktop-ai/` (workflow: *Vanguard AI desktop*).
The installers aren't code-signed yet: on Windows click **More info → Run anyway**; on macOS
right-click the app → **Open** the first time.

## Set up (5 minutes)

1. **Cloud models.** Open **Settings**, paste a key for each provider you pay for, and press Save.
   The app then pulls that provider's live model list, so a new flagship shows up the day it ships,
   with no app update needed.
   - Claude: console.anthropic.com → API keys
   - GPT: platform.openai.com → API keys
   - Gemini: aistudio.google.com → Get API key
   - One key for everything: openrouter.ai
2. **Offline models.** Install [Ollama](https://ollama.com/download) (free). Back in Settings →
   Offline models, download one model while you're online:
   - `qwen3:8b` (5 GB) is the best all-rounder on a 16 GB RAM laptop
   - `gemma3:4b` (3 GB) suits 8 GB RAM machines
   - `gpt-oss:20b` (14 GB) is OpenAI's open-weight model and the strongest option if you have 24 GB+ RAM

## How it works

- **Automatic offline mode.** When the connection drops, questions to a cloud model go to your
  local model. The answer is labelled *offline fallback*. Turn this off in Settings if you prefer.
- **Documents.** Attach or drag in PDF, Word (.docx), Excel (.xlsx), CSV, Markdown, text, JSON or HTML.
  Text is pulled out on your computer. Documents stay attached to the chat, so follow-up questions
  keep the context. Long files are trimmed to the passages most relevant to the question: about
  150k tokens for Claude and Gemini, and about 12k tokens for local models.
- **Web search.** Claude can search the web when you're online (toggle in Settings).
- **Output.** Every answer can be copied or saved as a Word document or a text file.
- **Privacy.** Keys are encrypted with the OS keychain. Chats are stored only on this computer (the
  app's data folder). With a local model, nothing leaves the machine at all.

Scanned PDFs (images only) have no text to read. Run OCR first, for example with Acrobat.

## Develop

```bash
cd desktop-ai
npm install
npm start          # run the app
npm test           # document parsing, Word export, local-model client
npm run dist:win   # or dist:mac / dist:linux, writes the installer to dist/
```

Code map: `main.js` handles the window, model routing and file dialogs. `src/providers.js` covers
Claude via the Anthropic SDK, the OpenAI-compatible providers via the OpenAI SDK, and Ollama.
`src/documents.js` does text extraction and context fitting. `src/store.js` holds settings,
encrypted keys and chats. `renderer/` is the UI.
