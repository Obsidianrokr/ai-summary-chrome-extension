# AI Page & YouTube Summary

A Manifest V3 Chrome extension that summarizes **YouTube videos** and **web articles** with the DeepSeek API.

Inspired by techniques used in top extensions (Glasp, Eightify, xTil, TL;DR):

- **YouTube:** transcript panel first, caption URL fallback, deduplicated captions, timestamped key moments
- **Articles:** Mozilla Readability extraction (same approach as TL;DR and Firefox Reader View)
- **Long content:** rolling chunk summarization (map-reduce style) for better quality on long videos and articles

## What it does

- Summarizes the **active tab** when you click the extension icon
- Detects **YouTube watch pages** vs **regular articles**
- Renders summaries as rich formatted HTML with emoji section headings
- Stores the DeepSeek API key only in `chrome.storage.local`

## DeepSeek API settings

- Base URL: `https://api.deepseek.com`
- Endpoint: `/chat/completions`
- Default model: `deepseek-v4-flash`

## Install locally

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `/Users/vemelianov/projects/ai-summary-chrome-extension`
5. Open the popup, click **Settings**, and save your DeepSeek API key
6. Open a YouTube video with captions **or** any article/blog page and click the extension icon

## Summary formats

**YouTube**

- Summary
- Key Moments (with timestamps)
- Key Points
- Notable Details
- Bottom Line

**Articles**

- Summary
- Key Points
- Notable Quotes
- Implications
- Bottom Line

Customize prompts separately by saving settings while on a YouTube tab vs an article tab.

## Notes

- YouTube videos without captions cannot be summarized
- Article extraction skips pages that are not reader-friendly (homepages, dashboards, etc.)
- Long transcripts/articles are chunked and summarized in rolling passes before the final polished output
- Requests go directly from the extension to DeepSeek; no backend is included

## Local checks

```sh
node tests/extractor-smoke.test.mjs
node tests/renderer-smoke.test.mjs
node tests/chunker-smoke.test.mjs
node --check popup.js
node --check src/background.js
node --check src/lib/chunker.js
node --check src/lib/prompts.js
python3 -m json.tool manifest.json
```

## Research

Open-source extensions studied in `research/` (xTil, TL;DR) — not shipped with the extension.

## Deploy to MacBook (GitHub Actions)

Manual deploy from the Mac mini to your MacBook over SSH, triggered from GitHub Actions.

### One-time setup (Mac mini)

1. Ensure SSH works to the MacBook:
   ```sh
   ssh macbook 'echo ok'
   ```
2. Register a self-hosted runner on the Mac mini:
   ```sh
   cd /Users/vemelianov/projects/ai-summary-chrome-extension
   chmod +x scripts/setup-runner.sh scripts/install-remote.sh
   ./scripts/setup-runner.sh
   cd ~/actions-runners/ai-summary-chrome-extension && ./run.sh
   ```
   For a persistent runner: `sudo ./svc.sh install && sudo ./svc.sh start` in that directory.

The runner must run under the user whose `~/.ssh/config` contains the MacBook host (e.g. `macbook`).

### One-time setup (MacBook)

1. Enable **Remote Login** (System Settings → General → Sharing)
2. In Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → select `~/vscode/ai-summary-chrome-extension`

### Deploy

1. Open GitHub → **Actions** → **Deploy to MacBook** → **Run workflow**
2. Choose SSH host (`macbook` by default)
3. After deploy, click **Reload** on the extension in Chrome (the workflow can open `chrome://extensions` for you)

### Deploy manually (without GitHub)

```sh
./scripts/install-remote.sh macbook --open-extensions
```
