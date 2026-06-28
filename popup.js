const LEGACY_SUMMARY_PROMPT = [
  "You summarize YouTube video transcripts for a viewer who wants the useful content quickly.",
  "Return Markdown with these sections: Summary, Key Points, Notable Details.",
  "Be concise, factual, and avoid inventing details that are not supported by the transcript.",
  "If the transcript is mostly music, silence, or unavailable, say that clearly."
].join(" ");

const DEFAULT_SUMMARY_PROMPT = [
  "You summarize YouTube video transcripts for a viewer who wants the useful content quickly.",
  "Return concise Markdown with emoji section headings: ## 🧠 Summary, ## ✅ Key Points, ## 💡 Notable Details, and ## 🎯 Bottom Line.",
  "Use short paragraphs, bullet lists, and bold text for important names, numbers, decisions, warnings, and recommendations.",
  "Keep the tone clear and useful. Avoid inventing details that are not supported by the transcript.",
  "If the transcript is mostly music, silence, or unavailable, say that clearly."
].join(" ");

const DEFAULT_ARTICLE_PROMPT = [
  "You summarize web articles for a reader who wants the useful content quickly.",
  "Return concise Markdown with emoji section headings: ## 🧠 Summary, ## ✅ Key Points, ## 💬 Notable Quotes, ## 🔍 Implications, and ## 🎯 Bottom Line.",
  "Use short paragraphs, bullet lists, and bold text for important names, numbers, claims, and recommendations.",
  "Separate facts from the author's opinion when the article mixes both.",
  "Avoid inventing details that are not supported by the article."
].join(" ");

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "deepseek-v4-flash",
  thinkingMode: "disabled",
  summaryLanguage: "same",
  preferredCaptionLanguage: "en",
  summaryPrompt: "",
  youtubeSummaryPrompt: DEFAULT_SUMMARY_PROMPT,
  articleSummaryPrompt: DEFAULT_ARTICLE_PROMPT,
  maxTranscriptChars: 180000,
  maxArticleChars: 180000
};

const ARTICLE_EXTRACTOR_CACHE_VERSION = "article-extractor-v2";

const form = document.getElementById("settings-form");
const summaryView = document.getElementById("summary-view");
const settingsView = document.getElementById("settings-view");
const subtitleNode = document.getElementById("subtitle");
const settingsOpenButton = document.getElementById("settings-open");
const summarizeButton = document.getElementById("summarize-button");
const copyButton = document.getElementById("copy-button");
const summaryResultNode = document.getElementById("summary-result");
const apiKeyInput = document.getElementById("api-key");
const modelInput = document.getElementById("model");
const thinkingModeInput = document.getElementById("thinking-mode");
const summaryLanguageInput = document.getElementById("summary-language");
const outputLanguageInput = document.getElementById("output-language");
const summaryPromptInput = document.getElementById("summary-prompt");
const preferredCaptionLanguageInput = document.getElementById("preferred-caption-language");
const maxTranscriptCharsInput = document.getElementById("max-transcript-chars");
const maxArticleCharsInput = document.getElementById("max-article-chars");
const clearKeyButton = document.getElementById("clear-key");
const statusNode = document.getElementById("status");
const settingsStatusNode = document.getElementById("settings-status");

let activePage = null;
let currentSummary = "";

init();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveSettings();
});

settingsOpenButton.addEventListener("click", () => {
  if (settingsView.hidden) {
    showSettings();
  } else {
    showSummary();
  }
});

summarizeButton.addEventListener("click", async () => {
  await summarizeCurrentPage({ force: true });
});

copyButton.addEventListener("click", async () => {
  if (!currentSummary) {
    return;
  }

  await navigator.clipboard.writeText(currentSummary);
  setStatus("📋 Summary copied.", "success");
});

clearKeyButton.addEventListener("click", async () => {
  apiKeyInput.value = "";
  await chrome.storage.local.set({ apiKey: "" });
  setSettingsStatus("🧹 API key cleared.");
});

async function init() {
  activePage = await getActivePageContext();
  const settings = await loadSettings();

  if (!activePage) {
    summarizeButton.disabled = true;
    copyButton.disabled = true;
    subtitleNode.textContent = "Open a page to summarize";
    setStatus("📄 Open a YouTube video or article tab, then click this extension again.");
    return;
  }

  subtitleNode.textContent = activePage.title || (activePage.contentType === "youtube" ? "YouTube video" : "Web page");
  summarizeButton.disabled = false;

  if (!settings.apiKey) {
    setStatus("🔑 Add your DeepSeek API key in Settings first.");
    return;
  }

  await summarizeCurrentPage({ force: false });
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  apiKeyInput.value = settings.apiKey || "";
  modelInput.value = settings.model || DEFAULT_SETTINGS.model;
  thinkingModeInput.checked = settings.thinkingMode === "enabled";
  summaryLanguageInput.value = settings.summaryLanguage || DEFAULT_SETTINGS.summaryLanguage;
  if (outputLanguageInput) {
    outputLanguageInput.value = settings.summaryLanguage || DEFAULT_SETTINGS.summaryLanguage;
  }
  summaryPromptInput.value = getPromptForPageType(settings, activePage?.contentType || "youtube");
  preferredCaptionLanguageInput.value = settings.preferredCaptionLanguage || DEFAULT_SETTINGS.preferredCaptionLanguage;
  maxTranscriptCharsInput.value = settings.maxTranscriptChars || DEFAULT_SETTINGS.maxTranscriptChars;
  if (maxArticleCharsInput) {
    maxArticleCharsInput.value = settings.maxArticleChars || DEFAULT_SETTINGS.maxArticleChars;
  }

  return settings;
}

async function saveSettings() {
  const pageType = activePage?.contentType || "youtube";
  const promptValue = normalizeSummaryPrompt(summaryPromptInput.value, pageType);
  const existing = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const nextSettings = {
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value,
    thinkingMode: thinkingModeInput.checked ? "enabled" : "disabled",
    summaryLanguage: summaryLanguageInput.value,
    summaryPrompt: promptValue,
    youtubeSummaryPrompt: pageType === "youtube"
      ? promptValue
      : (existing.youtubeSummaryPrompt || DEFAULT_SUMMARY_PROMPT),
    articleSummaryPrompt: pageType === "article"
      ? promptValue
      : (existing.articleSummaryPrompt || DEFAULT_ARTICLE_PROMPT),
    preferredCaptionLanguage: normalizeLanguage(preferredCaptionLanguageInput.value),
    maxTranscriptChars: normalizeTranscriptLimit(maxTranscriptCharsInput.value),
    maxArticleChars: normalizeTranscriptLimit(maxArticleCharsInput?.value || DEFAULT_SETTINGS.maxArticleChars)
  };

  await chrome.storage.local.set(nextSettings);
  summaryPromptInput.value = getPromptForPageType(nextSettings, pageType);
  preferredCaptionLanguageInput.value = nextSettings.preferredCaptionLanguage;
  maxTranscriptCharsInput.value = nextSettings.maxTranscriptChars;
  if (maxArticleCharsInput) {
    maxArticleCharsInput.value = nextSettings.maxArticleChars;
  }
  setSettingsStatus("✅ Settings saved.");
  if (outputLanguageInput) {
    outputLanguageInput.value = nextSettings.summaryLanguage;
  }
  showSummary();

  if (activePage && nextSettings.apiKey) {
    await summarizeCurrentPage({ force: true });
  }
}

function normalizeLanguage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || DEFAULT_SETTINGS.preferredCaptionLanguage;
}

function normalizeTranscriptLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_SETTINGS.maxTranscriptChars;
  }

  return Math.max(20000, Math.min(600000, Math.floor(number)));
}

function normalizeSummaryPrompt(value, contentType = "youtube") {
  const prompt = String(value || "").trim();
  if (!prompt || prompt === LEGACY_SUMMARY_PROMPT) {
    return contentType === "article" ? DEFAULT_ARTICLE_PROMPT : DEFAULT_SUMMARY_PROMPT;
  }

  return prompt;
}

function getPromptForPageType(settings, contentType) {
  if (settings.summaryPrompt && settings.summaryPrompt !== LEGACY_SUMMARY_PROMPT) {
    return settings.summaryPrompt;
  }

  if (contentType === "article") {
    return settings.articleSummaryPrompt || DEFAULT_ARTICLE_PROMPT;
  }

  return settings.youtubeSummaryPrompt || DEFAULT_SUMMARY_PROMPT;
}

async function loadTranscriptFromActiveTab(tabId, preferredLanguage) {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Reload the extension in chrome://extensions/ so it can read captions from the active YouTube tab.");
  }

  setStatus("📖 Reading captions from the YouTube tab...");

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: extractYouTubeTranscriptFromPage,
      args: [preferredLanguage || DEFAULT_SETTINGS.preferredCaptionLanguage]
    });

    const result = results?.[0]?.result;
    if (result?.ok && result.transcript) {
      return {
        transcript: result.transcript,
        transcriptMeta: result.meta || {},
        title: result.title || activePage?.title || "",
        channel: result.channel || "",
        duration: result.duration || ""
      };
    }

    if (result?.error) {
      throw new Error(result.error);
    }

    throw new Error("Could not read captions from the active YouTube tab.");
  } catch (error) {
    const message = error?.message || String(error);
    throw new Error(message);
  }
}

async function loadTranscriptViaPlayerResponse(tabId, preferredLanguage) {
  const language = preferredLanguage || DEFAULT_SETTINGS.preferredCaptionLanguage;
  let pageError = "";
  const rememberError = (message) => {
    if (message) {
      pageError = message;
    }
  };

  // Primary: read captions straight from the live page's player response.
  // This never opens the transcript panel, so the tab does not visibly change.
  if (tabId && chrome.scripting?.executeScript) {
    setStatus("📖 Fetching captions...");
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: extractTranscriptViaPlayerResponse,
        args: [language]
      });
      const result = results?.[0]?.result;
      if (result?.ok && result.transcript) {
        return {
          transcript: result.transcript,
          transcriptMeta: result.meta || {},
          title: result.title || activePage?.title || "",
          channel: result.channel || "",
          duration: result.duration || ""
        };
      }
      rememberError(result?.error || "");
    } catch (error) {
      rememberError(error?.message || String(error));
    }
  }

  // Fallback: trigger the real YouTube player caption request and let the
  // content script fetch the exact timedtext URL observed by webRequest.
  if (tabId && chrome.tabs?.sendMessage) {
    setStatus("📖 Asking the YouTube player for captions...");
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "captureYouTubeTimedtextTranscript",
        preferredLanguage: language
      });
      if (result?.ok && result.transcript) {
        return {
          transcript: result.transcript,
          transcriptMeta: result.meta || {},
          title: result.title || activePage?.title || "",
          channel: result.channel || "",
          duration: result.duration || ""
        };
      }
      rememberError(result?.error || "");
    } catch (error) {
      rememberError(error?.message || String(error));
    }
  }

  // Fallback: open/read the transcript panel from the live page. This can still
  // work when YouTube rate-limits caption URL downloads.
  if (tabId && chrome.scripting?.executeScript) {
    setStatus("📖 Reading the YouTube transcript panel...");
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: extractYouTubeTranscriptFromPage,
        args: [language]
      });
      const result = results?.[0]?.result;
      if (result?.ok && result.transcript) {
        return {
          transcript: result.transcript,
          transcriptMeta: result.meta || {},
          title: result.title || activePage?.title || "",
          channel: result.channel || "",
          duration: result.duration || ""
        };
      }
      rememberError(result?.error || "");
    } catch (error) {
      rememberError(error?.message || String(error));
    }
  }

  // Last fallback: let the background fetch the player response server-side.
  try {
    const response = await chrome.runtime.sendMessage({
      type: "getTranscript",
      payload: { videoId: activePage?.videoId, preferredLanguage: language }
    });
    if (response?.ok && response.result?.transcript) {
      const result = response.result;
      return {
        transcript: result.transcript,
        transcriptMeta: result.meta || {},
        title: result.title || activePage?.title || "",
        channel: result.channel || "",
        duration: result.duration || ""
      };
    }
    rememberError(response?.error || "");
  } catch (error) {
    rememberError(error?.message || String(error));
  }

  throw new Error(pageError || "Could not read captions for this video.");
}

// Injected into the YouTube page (MAIN world). Reads ytInitialPlayerResponse and
// downloads the caption track directly — no transcript panel, no UI change.
function extractTranscriptViaPlayerResponse(preferredLanguage) {
  function findPlayerResponse() {
    if (window.ytInitialPlayerResponse && window.ytInitialPlayerResponse.captions) {
      return window.ytInitialPlayerResponse;
    }

    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const response = extractYtInitialPlayerResponse(script.textContent || "");
      if (response?.captions) {
        return response;
      }
    }

    return window.ytInitialPlayerResponse || null;
  }

  function extractYtInitialPlayerResponse(source) {
    const markers = [
      "ytInitialPlayerResponse =",
      "ytInitialPlayerResponse=",
      "window[\"ytInitialPlayerResponse\"] =",
      "window['ytInitialPlayerResponse'] =",
      "\"ytInitialPlayerResponse\":"
    ];

    for (const marker of markers) {
      const markerIndex = source.indexOf(marker);
      if (markerIndex === -1) {
        continue;
      }

      const objectStart = source.indexOf("{", markerIndex + marker.length);
      if (objectStart === -1) {
        continue;
      }

      const jsonText = readBalancedJsonObject(source, objectStart);
      if (!jsonText) {
        continue;
      }

      try {
        const parsed = JSON.parse(jsonText);
        if (parsed?.captions || parsed?.videoDetails) {
          return parsed;
        }
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  function readBalancedJsonObject(source, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }
    }

    return "";
  }

  function trackLabel(track) {
    if (track.name && track.name.simpleText) {
      return track.name.simpleText;
    }
    if (track.name && Array.isArray(track.name.runs)) {
      return track.name.runs.map((run) => run.text || "").join("").trim();
    }
    return track.languageCode || "captions";
  }

  function buildCaptionUrl(baseUrl, format) {
    if (!format) {
      return baseUrl;
    }

    if (new RegExp(`[?&]fmt=${format}(?:&|$)`).test(baseUrl)) {
      return baseUrl;
    }

    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}fmt=${encodeURIComponent(format)}`;
  }

  async function readResponseText(response) {
    if (typeof response.text === "function") {
      return await response.text();
    }

    if (typeof response.json === "function") {
      return JSON.stringify(await response.json());
    }

    return "";
  }

  function parseCaptionResponse(text, format) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      return "";
    }

    if (format === "json3" || trimmed.startsWith("{")) {
      try {
        return parseJson3Captions(JSON.parse(trimmed));
      } catch (_error) {
        return "";
      }
    }

    if (format === "vtt" || trimmed.startsWith("WEBVTT")) {
      return parseVttCaptions(trimmed);
    }

    if (trimmed.includes("<text") || trimmed.includes("<p ")) {
      return parseXmlCaptions(trimmed);
    }

    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  function parseJson3Captions(captionJson) {
    const events = Array.isArray(captionJson?.events) ? captionJson.events : [];
    const lines = [];

    for (const event of events) {
      if (!Array.isArray(event.segs)) {
        continue;
      }

      const text = event.segs
        .map((segment) => segment?.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      if (text) {
        lines.push(`[${formatTimestamp(event.tStartMs || 0)}] ${text}`);
      }
    }

    return lines.join("\n");
  }

  function formatDuration(lengthSeconds) {
    const seconds = Number(lengthSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "";
    }

    return formatTimestamp(seconds * 1000);
  }

  function parseVttCaptions(vttText) {
    return String(vttText || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (line === "WEBVTT") return false;
        if (/^\d+$/.test(line)) return false;
        if (line.includes("-->")) return false;
        if (line.startsWith("NOTE")) return false;
        return true;
      })
      .map(stripHtmlTags)
      .map(decodeHtmlEntities)
      .filter(Boolean)
      .join("\n");
  }

  function parseXmlCaptions(xmlText) {
    const lines = [];
    const textNodeRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    const paragraphRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;

    collectXmlCaptionLines(xmlText, textNodeRegex, "start", lines);
    if (!lines.length) {
      collectXmlCaptionLines(xmlText, paragraphRegex, "t", lines);
    }

    return lines.join("\n");
  }

  function collectXmlCaptionLines(xmlText, regex, timeAttribute, lines) {
    let match = regex.exec(xmlText);
    while (match) {
      const attributes = match[1] || "";
      const rawText = match[2] || "";
      const text = decodeHtmlEntities(stripHtmlTags(rawText).replace(/\s+/g, " ").trim());
      const timestamp = getXmlTimestamp(attributes, timeAttribute);

      if (text) {
        lines.push(timestamp ? `[${timestamp}] ${text}` : text);
      }

      match = regex.exec(xmlText);
    }
  }

  function getXmlTimestamp(attributes, attributeName) {
    const match = attributes.match(new RegExp(`${attributeName}="([^"]+)"`));
    if (!match) {
      return "";
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value)) {
      return "";
    }

    return formatTimestamp(attributeName === "start" ? value * 1000 : value);
  }

  function stripHtmlTags(value) {
    return String(value || "").replace(/<[^>]+>/g, "").trim();
  }

  function decodeHtmlEntities(value) {
    return String(value || "").replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, code) => {
      if (code[0] === "#") {
        const isHex = code[1]?.toLowerCase() === "x";
        const numberText = isHex ? code.slice(2) : code.slice(1);
        const number = Number.parseInt(numberText, isHex ? 16 : 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
      }

      const namedEntities = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        nbsp: " "
      };

      return namedEntities[code] || entity;
    });
  }

  function formatTimestamp(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function run() {
    const player = findPlayerResponse();
    const tracks = (player && player.captions &&
      player.captions.playerCaptionsTracklistRenderer &&
      player.captions.playerCaptionsTracklistRenderer.captionTracks) || [];

    if (!tracks.length) {
      return Promise.resolve({ ok: false, error: "This video does not have captions the extension can read." });
    }

    const pref = String(preferredLanguage || "en").toLowerCase();
    const prefBase = pref.split("-")[0];

    function score(track) {
      const lc = String(track.languageCode || "").toLowerCase();
      let value = 0;
      if (lc === pref) {
        value += 100;
      } else if (lc.split("-")[0] === prefBase) {
        value += 60;
      }
      if (track.kind !== "asr") {
        value += 10;
      }
      return value;
    }

    const ranked = tracks.slice().sort((a, b) => score(b) - score(a));
    const title = (player.videoDetails && player.videoDetails.title) || "";
    const channel = (player.videoDetails && player.videoDetails.author) || "";
    const duration = formatDuration(player.videoDetails && player.videoDetails.lengthSeconds);

    return (async () => {
      let lastError = "Found caption tracks but could not download readable text.";
      for (const track of ranked) {
        if (!track.baseUrl) {
          continue;
        }

        for (const format of ["json3", "vtt", "srv3", ""]) {
          try {
            const url = buildCaptionUrl(track.baseUrl, format);
            const response = await fetch(url, { credentials: "include" });
            if (!response.ok) {
              lastError = `Caption download failed (${response.status}).`;
              continue;
            }
            const transcript = parseCaptionResponse(await readResponseText(response), format);
            if (transcript.trim()) {
              return {
                ok: true,
                transcript,
                title,
                channel,
                duration,
                meta: {
                  label: trackLabel(track),
                  languageCode: track.languageCode || "",
                  isAutoGenerated: track.kind === "asr",
                  source: "caption-url-fallback"
                }
              };
            }
          } catch (error) {
            lastError = (error && error.message) || String(error);
          }
        }
      }
      return { ok: false, error: lastError };
    })();
  }

  return run();
}

function summarizeViaStream(payload, onPartial) {
  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connect({ name: "summarize-stream" });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let accumulated = "";

    const finish = (fn, arg) => {
      if (settled) {
        return;
      }
      settled = true;
      try { port.disconnect(); } catch (_error) {}
      fn(arg);
    };

    port.onMessage.addListener((message) => {
      if (!message) {
        return;
      }
      if (message.type === "delta") {
        accumulated += message.text || "";
        onPartial(accumulated);
      } else if (message.type === "done") {
        const result = message.result || {};
        finish(resolve, { ...result, summary: result.summary ?? accumulated });
      } else if (message.type === "error") {
        finish(reject, new Error(message.error || "The extension could not summarize this page."));
      }
    });

    port.onDisconnect.addListener(() => {
      finish(reject, new Error("The summary connection closed unexpectedly."));
    });

    port.postMessage({ type: "start", payload });
  });
}

async function loadArticleFromActiveTab(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) {
    throw new Error("Reload the extension in chrome://extensions/ so it can read article text from the active tab.");
  }

  setStatus("📰 Extracting article text from the page...");

  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [
      "src/lib/readability-readerable.js",
      "src/lib/readability.js"
    ]
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: extractArticleFromPage
  });

  const result = results?.[0]?.result;
  if (result?.ok && result.content) {
    return result;
  }

  throw new Error(result?.error || "Could not extract readable article text from this page.");
}

async function summarizeCurrentPage({ force }) {
  if (!activePage) {
    setStatus("📄 Open a YouTube video or article tab, then click this extension again.", "error");
    return;
  }

  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (!settings.apiKey) {
    setStatus("🔑 Add your DeepSeek API key in Settings first.", "error");
    showSettings();
    return;
  }

  const effectiveSettings = {
    ...settings,
    summaryPrompt: getPromptForPageType(settings, activePage.contentType)
  };
  const cacheKey = getCacheKey(activePage, effectiveSettings);
  if (!force) {
    const cached = await chrome.storage.local.get({ summaryCache: {} });
    const cachedSummary = cached.summaryCache?.[cacheKey];
    if (cachedSummary?.summary) {
      renderSummary(cachedSummary.summary);
      setStatus("✅ Loaded saved summary. Use Regenerate to refresh.", "success");
      return;
    }
  }

  summarizeButton.disabled = true;
  summarizeButton.textContent = "Summarizing...";
  copyButton.disabled = true;
  setStatus(activePage.contentType === "youtube"
    ? "🤖 Summarizing this video automatically..."
    : "🤖 Summarizing this page automatically...");
  renderSummary("");

  try {
    let payload = { ...activePage };

    if (activePage.contentType === "youtube") {
      const transcriptPayload = await loadTranscriptViaPlayerResponse(
        activePage.tabId,
        settings.preferredCaptionLanguage
      );
      payload = {
        ...payload,
        ...transcriptPayload,
        content: transcriptPayload.transcript
      };
    } else {
      const articlePayload = await loadArticleFromActiveTab(activePage.tabId);
      payload = {
        ...payload,
        ...articlePayload,
        content: articlePayload.content
      };
    }

    const result = await summarizeViaStream(payload, (partialText) => {
      renderSummary(partialText);
    });

    const { summary, contentMeta, usage } = result;
    const rendered = `${summary}\n\n${buildMetaLine(contentMeta, usage)}`;
    renderSummary(rendered);
    setStatus("✅ Summary ready.", "success");
    await saveSummaryCache(cacheKey, rendered);
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  } finally {
    summarizeButton.disabled = false;
    summarizeButton.textContent = "Regenerate";
    copyButton.disabled = !currentSummary;
  }
}

async function extractArticleFromPage() {
  try {
    const access = detectArticleAccessLimits();
    const readabilityArticle = extractArticleWithReadability();
    const domArticle = extractArticleFromSemanticDom();
    const article = chooseBestArticle(readabilityArticle, domArticle);

    if (!article?.textContent?.trim()) {
      const readerable = typeof isProbablyReaderable !== "function" ||
        isProbablyReaderable(document, { minContentLength: 120, minScore: 18 });
      return {
        ok: false,
        error: access.isPreviewOnly
          ? buildPaywallError()
          : readerable
            ? "Could not extract readable article text from this page."
            : "This page does not look like a readable article. Try a news article, blog post, or documentation page."
      };
    }

    const textContent = normalizeArticleText(article.textContent);
    if (textContent.length < 120 || access.isPreviewOnly) {
      return {
        ok: false,
        error: access.isPreviewOnly
          ? buildPaywallError()
          : "The extracted article text is too short to summarize."
      };
    }

    const publishDate =
      document.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ||
      document.querySelector("time[datetime]")?.getAttribute("datetime") ||
      "";

    const author =
      article.byline ||
      document.querySelector('meta[name="author"]')?.getAttribute("content") ||
      "";

    const siteName = article.siteName || extractDomain(window.location.href);
    const wordCount = textContent.split(/\s+/).filter(Boolean).length;

    return {
      ok: true,
      contentType: "article",
      url: window.location.href,
      title: article.title || document.title,
      siteName,
      author,
      publishDate,
      excerpt: article.excerpt || textContent.slice(0, 220),
      wordCount,
      contentMeta: {
        source: article.source || "readability",
        lang: article.lang || document.documentElement.lang || "",
        access: access.isLikelyPaywalled ? "paywalled-browser-session" : "standard-page"
      },
      content: textContent
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }

  function extractArticleWithReadability() {
    if (typeof Readability !== "function") {
      return null;
    }

    const clone = document.cloneNode(true);
    clone.querySelectorAll([
      "script",
      "style",
      "noscript",
      "iframe",
      "svg",
      "canvas",
      "form",
      "nav",
      "aside",
      "[role='navigation']",
      "[role='complementary']"
    ].join(", ")).forEach((node) => node.remove());

    const reader = new Readability(clone, {
      charThreshold: 120,
      keepClasses: false,
      nbTopCandidates: 8
    });
    const parsed = reader.parse();
    if (!parsed?.textContent?.trim()) {
      return null;
    }

    return {
      ...parsed,
      textContent: normalizeArticleText(parsed.textContent),
      source: "readability"
    };
  }

  function extractArticleFromSemanticDom() {
    const selectors = [
      "article",
      "main article",
      "main [itemprop='articleBody']",
      "[itemprop='articleBody']",
      "[data-testid='article-body']",
      "[data-testid='story-body']",
      "[data-testid='prism-article-body']",
      "[data-testid='meteredContent']",
      "[data-qa='article-body']",
      "[data-qa='story-body']",
      "[data-qa='article']",
      "[data-el='article-body']",
      "[data-module='ArticleBody']",
      "section[name='articleBody']",
      ".meteredContent",
      ".article-body",
      ".articleBody",
      ".story-body",
      ".storyBody",
      ".entry-content",
      ".post-content"
    ];

    const candidates = Array.from(document.querySelectorAll(selectors.join(", ")))
      .map((root, index) => {
        const text = collectArticleTextFromRoot(root);
        return {
          title: getDocumentTitle(),
          byline: getDocumentAuthor(),
          siteName: extractSiteName(),
          excerpt: text.slice(0, 220),
          textContent: text,
          lang: document.documentElement.lang || "",
          source: "semantic-dom",
          index,
          score: scoreArticleCandidate(root, text)
        };
      })
      .filter((candidate) => candidate.textContent.length >= 120)
      .sort((left, right) => right.score - left.score || left.index - right.index);

    return candidates[0] || null;
  }

  function collectArticleTextFromRoot(root) {
    const contentSelectors = [
      "h1",
      "h2",
      "h3",
      "p",
      "li",
      "blockquote",
      "[data-el='text']",
      "[data-testid='paragraph']",
      "[class*='paragraph' i]"
    ];
    const nodes = Array.from(root.querySelectorAll(contentSelectors.join(", ")));
    const sourceNodes = nodes.length ? nodes : [root];
    const lines = [];
    const seen = new Set();

    for (const node of sourceNodes) {
      if (!isVisibleArticleNode(node) || isArticleChromeNode(node)) {
        continue;
      }

      const text = normalizeArticleText(node.innerText || node.textContent || "");
      if (!text || text.length < 2 || seen.has(text)) {
        continue;
      }

      seen.add(text);
      lines.push(text);
    }

    return lines.join("\n\n").trim();
  }

  function chooseBestArticle(readabilityArticle, domArticle) {
    if (!readabilityArticle) {
      return domArticle;
    }
    if (!domArticle) {
      return readabilityArticle;
    }

    const readabilityLength = normalizeArticleText(readabilityArticle.textContent).length;
    const domLength = normalizeArticleText(domArticle.textContent).length;
    return domLength > readabilityLength * 1.25 ? domArticle : readabilityArticle;
  }

  function scoreArticleCandidate(root, text) {
    let score = text.length;
    const tagName = String(root.tagName || "").toLowerCase();
    const attrs = [
      root.id || "",
      root.className || "",
      root.getAttribute?.("data-testid") || "",
      root.getAttribute?.("data-qa") || "",
      root.getAttribute?.("itemprop") || ""
    ].join(" ").toLowerCase();

    if (tagName === "article") score += 2500;
    if (attrs.includes("article")) score += 1800;
    if (attrs.includes("story")) score += 1200;
    if (attrs.includes("body")) score += 1000;
    if (attrs.includes("content")) score += 700;
    if (attrs.includes("comment")) score -= 2500;
    if (attrs.includes("related")) score -= 2000;
    return score;
  }

  function detectArticleAccessLimits() {
    const paywallSelectors = [
      "[data-testid*='paywall' i]",
      "[data-test-id*='paywall' i]",
      "[data-qa*='paywall' i]",
      "[id*='paywall' i]",
      "[class*='paywall' i]",
      "[class*='metered' i]"
    ];
    const paywallNodes = Array.from(document.querySelectorAll(paywallSelectors.join(", ")));
    const visiblePaywallText = paywallNodes
      .filter(isVisibleArticleNode)
      .map((node) => normalizeArticleText(node.innerText || node.textContent || ""))
      .join(" ");
    const accessibleForFreeMeta = getMetaContent("isAccessibleForFree");
    const accessibleForFreeJson = document.querySelector("script[type='application/ld+json']")
      ?.textContent
      ?.match(/"isAccessibleForFree"\s*:\s*(true|false)/i)?.[1] || "";
    const isAccessibleForFree = accessibleForFreeMeta || accessibleForFreeJson;
    const bodyText = normalizeArticleText(document.body?.innerText || document.body?.textContent || "");
    const publisherGate = /two ways to read this article|access this article|start reading|already have an account\?\s*sign in/i.test(bodyText) &&
      /subscribe|subscription|create an account|sign in|log in|register/i.test(bodyText);
    const likelyPaywall = publisherGate ||
      /paywall|subscribe|subscription|sign in|log in|register|already a subscriber|continue reading|read full article/i.test(visiblePaywallText) ||
      String(isAccessibleForFree).toLowerCase() === "false";

    return {
      isLikelyPaywalled: likelyPaywall,
      isPreviewOnly: publisherGate ||
        /subscribe|subscription|sign in|log in|register|already a subscriber|continue reading|read full article/i.test(visiblePaywallText)
    };
  }

  function isVisibleArticleNode(node) {
    if (!node || typeof getComputedStyle !== "function") {
      return true;
    }

    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }

    const rect = typeof node.getBoundingClientRect === "function"
      ? node.getBoundingClientRect()
      : { width: 1, height: 1 };
    return rect.width > 0 && rect.height > 0;
  }

  function isArticleChromeNode(node) {
    const label = [
      node.getAttribute?.("aria-label") || "",
      node.getAttribute?.("role") || "",
      node.className || "",
      node.id || ""
    ].join(" ").toLowerCase();
    const text = normalizeArticleText(node.innerText || node.textContent || "").toLowerCase();

    return /comment|newsletter|promo|advert|related|share|social|caption|figcaption|nav|footer/.test(label) ||
      /^(advertisement|share|read more|subscribe|sign in|log in)$/i.test(text);
  }

  function normalizeArticleText(value) {
    return String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function buildPaywallError() {
    return "This page appears to expose only a paywall, registration wall, or article preview to the browser. Sign in or create the required access, reload the page, then try again. The extension will summarize paid articles only from content available in your browser session.";
  }

  function getDocumentTitle() {
    return getMetaContent("og:title") || getMetaContent("twitter:title") || document.title || "";
  }

  function getDocumentAuthor() {
    return getMetaContent("author") ||
      getMetaContent("article:author") ||
      "";
  }

  function extractSiteName() {
    return getMetaContent("og:site_name") || extractDomain(window.location.href);
  }

  function getMetaContent(name) {
    return document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ||
      document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ||
      "";
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (_error) {
      return "";
    }
  }
}

async function extractYouTubeTranscriptFromPage(preferredLanguage) {
  try {
    const panelResult = await readTranscriptFromYouTubePanel();
    if (panelResult.transcript) {
      return {
        ok: true,
        transcript: panelResult.transcript,
        title: getVideoTitle(),
        channel: getChannelName(),
        duration: getVideoDuration(),
        meta: {
          label: panelResult.label || "YouTube transcript panel",
          languageCode: "",
          isAutoGenerated: false,
          source: "youtube-transcript-panel"
        }
      };
    }

    return await readTranscriptFromCaptionTracks(preferredLanguage);
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }

  async function readTranscriptFromYouTubePanel() {
    let scraped = scrapeTranscriptPanel();
    if (scraped.transcript) {
      return scraped;
    }

    await openTranscriptPanel();
    scraped = await waitForTranscriptPanel(20000);
    if (!scraped.transcript) {
      return scraped;
    }

    return scraped;
  }

  async function openTranscriptPanel() {
    const visiblePanel = getTranscriptPanel();
    if (visiblePanel && isPanelVisible(visiblePanel)) {
      return;
    }

    await expandDescription();

    const transcriptButton = findTranscriptButton();
    if (!transcriptButton) {
      throw new Error("Could not find YouTube's Show transcript button. Make sure the video has captions available.");
    }

    transcriptButton.click();
    await wait(800);
  }

  async function expandDescription() {
    const expandSelectors = [
      "tp-yt-paper-button#expand",
      "#expand",
      "ytd-text-inline-expander #expand",
      "button[aria-label*='more' i]"
    ];

    for (const selector of expandSelectors) {
      const button = findVisibleElement(selector);
      if (button) {
        button.click();
        await wait(500);
        return;
      }
    }

    const moreButton = Array.from(document.querySelectorAll("button, tp-yt-paper-button"))
      .find((button) => {
        const text = getElementText(button).toLowerCase();
        const label = String(button.getAttribute("aria-label") || "").toLowerCase();
        return isVisibleElement(button) && (text === "...more" || text === "more" || label.includes("more"));
      });

    if (moreButton) {
      moreButton.click();
      await wait(500);
    }
  }

  function findTranscriptButton() {
    const selectors = [
      "ytd-video-description-transcript-section-renderer button",
      "button[aria-label*='Show transcript' i]",
      "button[aria-label*='transcript' i]",
      "[class*='transcript' i] button"
    ];

    for (const selector of selectors) {
      const button = findVisibleElement(selector);
      if (button) {
        return button;
      }
    }

    return Array.from(document.querySelectorAll("button, yt-button-shape button, tp-yt-paper-button"))
      .find((button) => {
        const text = getElementText(button).toLowerCase();
        const label = String(button.getAttribute("aria-label") || "").toLowerCase();
        return isVisibleElement(button) && (text.includes("transcript") || label.includes("transcript"));
      }) || null;
  }

  async function waitForTranscriptPanel(timeoutMs) {
    const startedAt = Date.now();
    let best = { transcript: "", label: "" };

    while (Date.now() - startedAt < timeoutMs) {
      const scraped = await scrapeTranscriptPanelWithScroll();
      if (scraped.transcript.length > best.transcript.length) {
        best = scraped;
      }

      if (best.transcript) {
        return best;
      }

      await wait(250);
    }

    return best;
  }

  async function scrapeTranscriptPanelWithScroll() {
    const panel = getTranscriptPanel();
    const scrollContainer = getTranscriptScrollContainer(panel);
    const segments = new Map();

    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
      await wait(100);
    }

    let previousScrollTop = -1;
    let stuckCount = 0;

    for (let index = 0; index < 120; index += 1) {
      collectTranscriptSegments(segments);

      if (!scrollContainer) {
        break;
      }

      const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      if (scrollContainer.scrollTop >= maxScrollTop - 4) {
        break;
      }

      previousScrollTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop = Math.min(maxScrollTop, scrollContainer.scrollTop + Math.max(240, scrollContainer.clientHeight * 0.85));
      await wait(60);

      if (Math.abs(scrollContainer.scrollTop - previousScrollTop) < 4) {
        stuckCount += 1;
        if (stuckCount >= 2) {
          break;
        }
      } else {
        stuckCount = 0;
      }
    }

    collectTranscriptSegments(segments);

    return {
      transcript: Array.from(segments.values()).join("\n"),
      label: "YouTube transcript panel"
    };
  }

  function scrapeTranscriptPanel() {
    const segments = new Map();
    collectTranscriptSegments(segments);

    return {
      transcript: Array.from(segments.values()).join("\n"),
      label: "YouTube transcript panel"
    };
  }

  function collectTranscriptSegments(segments) {
    const panel = getTranscriptPanel();
    if (!panel || !isTranscriptPanelUsable(panel)) {
      return;
    }

    const segmentNodes = panel.querySelectorAll([
      "ytd-transcript-segment-renderer",
      "transcript-segment-view-model",
      "macro-markers-panel-item-view-model",
      "timeline-item-view-model",
      "ytd-transcript-segment-list-renderer [role='button']",
      "yt-list-item-view-model",
      "[class*='transcript-segment' i]",
      "[class*='TranscriptSegment' i]",
      "[class*='segment-renderer' i]"
    ].join(", "));

    for (const segment of Array.from(segmentNodes)) {
      addTranscriptSegment(segments, segment);
    }

    if (!segments.size) {
      collectTranscriptFromVisibleText(segments, panel);
    }
  }

  function addTranscriptSegment(segments, segment) {
    const textNode = segment.querySelector([
      ".segment-text",
      "yt-formatted-string.segment-text",
      "#content-text",
      "[class*='segment-text' i]",
      "[id*='content-text' i]"
    ].join(", "));
    const timestampNode = segment.querySelector([
      ".segment-timestamp",
      ".segment-start-offset",
      "#timestamp",
      "[class*='timestamp' i]",
      "[class*='time' i]"
    ].join(", "));
    const rawSegmentText = normalizeVisibleText(segment.innerText || segment.textContent || "");
    const parsed = parseTranscriptTextLine(
      normalizeVisibleText(textNode?.textContent || rawSegmentText),
      normalizeVisibleText(timestampNode?.textContent || "")
    );

    if (!parsed.text || isTranscriptChromeText(parsed.text)) {
      return;
    }

    const key = `${parsed.timestamp}|${parsed.text}`;
    segments.set(key, parsed.timestamp ? `[${parsed.timestamp}] ${parsed.text}` : parsed.text);
  }

  function collectTranscriptFromVisibleText(segments, panel) {
    const lines = normalizeTranscriptLines(panel.innerText || panel.textContent || "");

    for (let index = 0; index < lines.length; index += 1) {
      const current = lines[index];
      const inline = current.match(/^((?:\d+:)?\d{1,2}:\d{2})\s+(.+)$/);

      if (inline) {
        addParsedTranscriptLine(segments, inline[1], inline[2]);
        continue;
      }

      if (isTimestamp(current)) {
        const textParts = [];
        let nextIndex = index + 1;

        while (nextIndex < lines.length && !isTimestamp(lines[nextIndex]) && !startsWithTimestamp(lines[nextIndex])) {
          if (!isTranscriptChromeText(lines[nextIndex])) {
            textParts.push(lines[nextIndex]);
          }
          nextIndex += 1;
        }

        addParsedTranscriptLine(segments, current, textParts.join(" "));
        index = nextIndex - 1;
      }
    }
  }

  function addParsedTranscriptLine(segments, timestamp, text) {
    const normalizedText = normalizeVisibleText(text);
    const normalizedTimestamp = normalizeVisibleText(timestamp);

    if (!normalizedText || isTranscriptChromeText(normalizedText)) {
      return;
    }

    const key = `${normalizedTimestamp}|${normalizedText}`;
    segments.set(key, normalizedTimestamp ? `[${normalizedTimestamp}] ${normalizedText}` : normalizedText);
  }

  function parseTranscriptTextLine(rawText, explicitTimestamp) {
    let text = normalizeVisibleText(rawText);
    let timestamp = normalizeVisibleText(explicitTimestamp);

    if (!timestamp) {
      const match = text.match(/^((?:\d+:)?\d{1,2}:\d{2})\s+(.+)$/);
      if (match) {
        timestamp = match[1];
        text = stripSpokenTimestamp(match[2]);
      }
    } else {
      text = stripSpokenTimestamp(text.replace(new RegExp(`^${escapeRegExp(timestamp)}\\s*`), "").trim());
    }

    return {
      timestamp,
      text
    };
  }

  function stripSpokenTimestamp(value) {
    return normalizeVisibleText(value)
      .replace(/^\d+\s+minute(?:s)?,\s*\d+\s+seconds?\s+/i, "")
      .replace(/^\d+\s+minute(?:s)?\s+/i, "")
      .replace(/^\d+\s+seconds?\s+/i, "")
      .trim();
  }

  function normalizeTranscriptLines(value) {
    return String(value || "")
      .split("\n")
      .map(normalizeVisibleText)
      .filter(Boolean);
  }

  function isTimestamp(value) {
    return /^(?:\d+:)?\d{1,2}:\d{2}$/.test(value);
  }

  function startsWithTimestamp(value) {
    return /^((?:\d+:)?\d{1,2}:\d{2})\s+/.test(value);
  }

  function isTranscriptChromeText(value) {
    const normalized = normalizeVisibleText(value).toLowerCase();
    return normalized === "transcript" ||
      normalized === "search transcript" ||
      normalized === "show transcript" ||
      normalized === "close" ||
      normalized === "more actions" ||
      normalized === "search";
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function getTranscriptPanel() {
    const candidates = Array.from(document.querySelectorAll([
      "ytd-engagement-panel-section-list-renderer",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-searchable-transcript']",
      "ytd-engagement-panel-section-list-renderer[target-id='PAmodern_transcript_view']",
      "ytd-transcript-renderer",
      "ytd-transcript-search-panel-renderer"
    ].join(", ")));

    if (!candidates.length) {
      return null;
    }

    return candidates
      .map((panel, index) => ({
        panel,
        index,
        score: scoreTranscriptPanel(panel)
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index)[0].panel;
  }

  function getTranscriptScrollContainer(panel) {
    if (!panel) {
      return null;
    }

    return panel.querySelector("#segments-container") ||
      panel.querySelector("ytd-transcript-segment-list-renderer") ||
      panel.querySelector("#body") ||
      panel;
  }

  function isPanelVisible(panel) {
    if (!panel) {
      return false;
    }

    const visibility = panel.getAttribute("visibility");
    return visibility !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" && isVisibleElement(panel);
  }

  function isTranscriptPanelUsable(panel) {
    if (!panel) {
      return false;
    }

    if (panel.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN") {
      return false;
    }

    return isPanelVisible(panel) || hasTranscriptText(panel);
  }

  function scoreTranscriptPanel(panel) {
    let score = 0;
    const targetId = panel.getAttribute("target-id") || "";

    if (isPanelVisible(panel)) score += 100;
    if (panel.getAttribute("visibility") !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN" && hasTranscriptText(panel)) score += 80;
    if (targetId === "engagement-panel-searchable-transcript") score += 30;
    if (targetId === "PAmodern_transcript_view") score += 20;
    if (!targetId && /\bTranscript\b/i.test(normalizeVisibleText(panel.innerText || panel.textContent || ""))) score += 15;
    if (panel.matches("ytd-transcript-renderer, ytd-transcript-search-panel-renderer")) score += 10;
    if (panel.getAttribute("visibility") === "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN") score -= 50;

    return score;
  }

  function hasTranscriptText(panel) {
    const text = normalizeVisibleText(panel.innerText || panel.textContent || "");
    return /(?:^|\s)(?:\d+:)?\d{1,2}:\d{2}\s+/.test(text);
  }

  async function readTranscriptFromCaptionTracks(language) {
    const playerResponse = getPlayerResponse();
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

    if (!captionTracks.length) {
      return {
        ok: false,
        error: "This video does not expose captions that the extension can summarize."
      };
    }

    const rankedTracks = rankCaptionTracks(captionTracks, language);
    const track = rankedTracks[0];

    if (!track?.baseUrl) {
      return {
        ok: false,
        error: "YouTube returned captions without a readable transcript URL."
      };
    }

    const response = await fetch(buildCaptionUrl(track.baseUrl, "json3"), {
      credentials: "include"
    });

    if (response.status === 429) {
      return {
        ok: false,
        error: "YouTube is rate-limiting caption downloads (429). The transcript panel method also failed, so wait a few minutes, reload the YouTube tab, then click the extension again."
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        error: `Could not fetch YouTube captions (${response.status}).`
      };
    }

    const transcript = parseCaptionResponse(await response.text(), "json3");
    if (!transcript.trim()) {
      return {
        ok: false,
        error: "YouTube returned caption tracks, but none contained readable text."
      };
    }

    return {
      ok: true,
      transcript,
      title: getVideoTitle(),
      channel: getChannelName(),
      duration: getVideoDuration(),
      meta: {
        label: getTrackLabel(track),
        languageCode: track.languageCode || "",
        isAutoGenerated: track.kind === "asr",
        source: "caption-url-fallback"
      }
    };
  }

  function getPlayerResponse() {
    if (globalThis.ytInitialPlayerResponse) {
      return globalThis.ytInitialPlayerResponse;
    }

    const configResponse = globalThis.ytplayer?.config?.args?.player_response;
    if (configResponse) {
      try {
        return JSON.parse(configResponse);
      } catch (_error) {
        return null;
      }
    }

    for (const script of Array.from(document.scripts)) {
      const text = script.textContent || "";
      const response = extractYtInitialPlayerResponse(text);
      if (response) {
        return response;
      }
    }

    return null;
  }

  function extractYtInitialPlayerResponse(source) {
    const markers = [
      "ytInitialPlayerResponse =",
      "ytInitialPlayerResponse=",
      "window[\"ytInitialPlayerResponse\"] =",
      "window['ytInitialPlayerResponse'] ="
    ];

    for (const marker of markers) {
      const markerIndex = source.indexOf(marker);
      if (markerIndex === -1) {
        continue;
      }

      const objectStart = source.indexOf("{", markerIndex + marker.length);
      if (objectStart === -1) {
        continue;
      }

      const jsonText = readBalancedJsonObject(source, objectStart);
      if (!jsonText) {
        continue;
      }

      try {
        return JSON.parse(jsonText);
      } catch (_error) {
        continue;
      }
    }

    return null;
  }

  function readBalancedJsonObject(source, startIndex) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < source.length; index += 1) {
      const char = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, index + 1);
        }
      }
    }

    return "";
  }

  function rankCaptionTracks(tracks, language = "en") {
    const normalizedPreferred = (language || "en").toLowerCase();
    return tracks
      .map((track, index) => {
        const languageCode = (track.languageCode || "").toLowerCase();
        const isAutoGenerated = track.kind === "asr";
        return {
          track,
          index,
          score: scoreCaptionTrack(languageCode, isAutoGenerated, normalizedPreferred)
        };
      })
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .map((item) => item.track);
  }

  function scoreCaptionTrack(languageCode, isAutoGenerated, language) {
    if (languageCode === language && !isAutoGenerated) return 0;
    if (languageCode === language) return 1;
    if (languageCode.startsWith(`${language}-`) && !isAutoGenerated) return 2;
    if (languageCode.startsWith(`${language}-`)) return 3;
    if (languageCode.startsWith("en") && !isAutoGenerated) return 4;
    if (languageCode.startsWith("en")) return 5;
    if (!isAutoGenerated) return 6;
    return 7;
  }

  function buildCaptionUrl(baseUrl, format) {
    if (!format || new RegExp(`[?&]fmt=${format}(?:&|$)`).test(baseUrl)) {
      return baseUrl;
    }

    const separator = baseUrl.includes("?") ? "&" : "?";
    return `${baseUrl}${separator}fmt=${encodeURIComponent(format)}`;
  }

  function parseCaptionResponse(text, format) {
    const trimmed = text.trim();
    if (!trimmed) {
      return "";
    }

    if (format === "json3" || trimmed.startsWith("{")) {
      try {
        return parseJson3Captions(JSON.parse(trimmed));
      } catch (_error) {
        return "";
      }
    }

    if (format === "vtt" || trimmed.startsWith("WEBVTT")) {
      return parseVttCaptions(trimmed);
    }

    if (trimmed.includes("<text") || trimmed.includes("<p ")) {
      return parseXmlCaptions(trimmed);
    }

    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }

  function parseJson3Captions(captionJson) {
    const events = Array.isArray(captionJson?.events) ? captionJson.events : [];
    const lines = [];

    for (const event of events) {
      if (!Array.isArray(event.segs)) {
        continue;
      }

      const text = event.segs
        .map((segment) => segment?.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      if (text) {
        lines.push(`[${formatTimestamp(event.tStartMs || 0)}] ${text}`);
      }
    }

    return lines.join("\n");
  }

  function parseVttCaptions(vttText) {
    return vttText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (line === "WEBVTT") return false;
        if (/^\d+$/.test(line)) return false;
        if (line.includes("-->")) return false;
        if (line.startsWith("NOTE")) return false;
        return true;
      })
      .map(stripHtmlTags)
      .map(decodeHtmlEntities)
      .filter(Boolean)
      .join("\n");
  }

  function parseXmlCaptions(xmlText) {
    const lines = [];
    const textNodeRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    const paragraphRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;

    collectXmlCaptionLines(xmlText, textNodeRegex, "start", lines);
    if (!lines.length) {
      collectXmlCaptionLines(xmlText, paragraphRegex, "t", lines);
    }

    return lines.join("\n");
  }

  function collectXmlCaptionLines(xmlText, regex, timeAttribute, lines) {
    let match = regex.exec(xmlText);
    while (match) {
      const attributes = match[1] || "";
      const rawText = match[2] || "";
      const text = decodeHtmlEntities(stripHtmlTags(rawText).replace(/\s+/g, " ").trim());
      const timestamp = getXmlTimestamp(attributes, timeAttribute);

      if (text) {
        lines.push(timestamp ? `[${timestamp}] ${text}` : text);
      }

      match = regex.exec(xmlText);
    }
  }

  function getXmlTimestamp(attributes, attributeName) {
    const match = attributes.match(new RegExp(`${attributeName}="([^"]+)"`));
    if (!match) {
      return "";
    }

    const value = Number(match[1]);
    if (!Number.isFinite(value)) {
      return "";
    }

    return formatTimestamp(attributeName === "start" ? value * 1000 : value);
  }

  function getTrackLabel(track) {
    if (track?.name?.simpleText) {
      return track.name.simpleText;
    }

    if (Array.isArray(track?.name?.runs)) {
      return track.name.runs.map((run) => run.text || "").join("").trim();
    }

    return track?.languageCode || "Caption track";
  }

  function formatDuration(lengthSeconds) {
    const seconds = Number(lengthSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return "";
    }

    return formatTimestamp(seconds * 1000);
  }

  function getVideoTitle() {
    const titleNode = document.querySelector("ytd-watch-metadata h1, h1.ytd-watch-metadata yt-formatted-string");
    return normalizeVisibleText(titleNode?.textContent || document.title.replace(/\s+-\s+YouTube$/, ""));
  }

  function getChannelName() {
    const channelNode = document.querySelector("ytd-watch-metadata ytd-channel-name a, ytd-video-owner-renderer ytd-channel-name a");
    return normalizeVisibleText(channelNode?.textContent || "");
  }

  function getVideoDuration() {
    const video = document.querySelector("video");
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      return formatTimestamp(video.duration * 1000);
    }

    return formatDuration(getPlayerResponse()?.videoDetails?.lengthSeconds);
  }

  function formatTimestamp(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function stripHtmlTags(value) {
    return value.replace(/<[^>]+>/g, "").trim();
  }

  function findVisibleElement(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisibleElement) || null;
  }

  function isVisibleElement(element) {
    if (!element) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none";
  }

  function getElementText(element) {
    return normalizeVisibleText(element?.textContent || "");
  }

  function normalizeVisibleText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function decodeHtmlEntities(value) {
    return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, code) => {
      if (code[0] === "#") {
        const isHex = code[1]?.toLowerCase() === "x";
        const numberText = isHex ? code.slice(2) : code.slice(1);
        const number = Number.parseInt(numberText, isHex ? 16 : 10);
        return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
      }

      const namedEntities = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: "\"",
        apos: "'",
        nbsp: " "
      };

      return namedEntities[code] || entity;
    });
  }
}

function renderSummary(summary) {
  currentSummary = summary;
  summaryResultNode.innerHTML = summary ? renderRichMarkdown(summary) : "";
  summaryResultNode.hidden = !summary;
  copyButton.disabled = !summary;
}

function renderRichMarkdown(markdown) {
  const blocks = [];
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let paragraph = [];
  let listItems = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = parseHeading(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h${heading.level}>${formatInline(decorateHeading(heading.text))}</h${heading.level}>`);
      continue;
    }

    const meta = parseMetaLine(line);
    if (meta) {
      flushParagraph();
      flushList();
      blocks.push(`<div class="summary-meta">${meta.map((item) => `<span>${formatInline(item)}</span>`).join("")}</div>`);
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      listItems.push(`<li>${formatInline(listItem[1])}</li>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return blocks.join("");

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }

    blocks.push(`<p>${formatInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length) {
      return;
    }

    blocks.push(`<ul>${listItems.join("")}</ul>`);
    listItems = [];
  }
}

function parseHeading(line) {
  const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/);
  if (markdownHeading) {
    return {
      level: markdownHeading[1].length <= 2 ? 2 : 3,
      text: stripMarkdownEmphasis(markdownHeading[2])
    };
  }

  const boldHeading = line.match(/^\*\*(.+?)\*\*:?\s*$/);
  if (boldHeading) {
    return {
      level: 2,
      text: stripMarkdownEmphasis(boldHeading[1])
    };
  }

  return null;
}

function parseMetaLine(line) {
  const text = String(line || "").trim();
  if (!/^(Site|Source|Tokens|Captions|Content truncated to|Generated by DeepSeek)\b/.test(text)) {
    return null;
  }

  return text
    .split(/\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function decorateHeading(text) {
  const cleanText = stripLeadingEmoji(text);
  const normalized = cleanText.toLowerCase();
  const knownHeadings = [
    ["summary", "🧠 Summary"],
    ["key moments", "⏱️ Key Moments"],
    ["key points", "✅ Key Points"],
    ["notable quotes", "💬 Notable Quotes"],
    ["notable details", "💡 Notable Details"],
    ["implications", "🔍 Implications"],
    ["bottom line", "🎯 Bottom Line"],
    ["recommendation", "🎯 Recommendation"],
    ["verdict", "🎯 Verdict"],
    ["warnings", "⚠️ Warnings"],
    ["caveats", "⚠️ Caveats"]
  ];

  const match = knownHeadings.find(([label]) => normalized === label || normalized.includes(label));
  return match ? match[1] : text;
}

function stripLeadingEmoji(text) {
  return String(text || "").replace(/^[^\p{L}\p{N}#*]+/u, "").trim();
}

function stripMarkdownEmphasis(text) {
  return String(text || "").replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
}

function formatInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMetaLine(contentMeta, usage) {
  const bits = [];

  if (contentMeta?.contentType === "article") {
    if (contentMeta.siteName) {
      bits.push(`Site: ${contentMeta.siteName}`);
    }
    if (contentMeta.source) {
      bits.push(`Source: ${contentMeta.source}`);
    }
  } else {
    if (contentMeta?.captionLabel) {
      bits.push(`Captions: ${contentMeta.captionLabel}`);
    } else if (contentMeta?.label) {
      bits.push(`Captions: ${contentMeta.label}`);
    }
    if (contentMeta?.source) {
      bits.push(`Source: ${contentMeta.source}`);
    }
  }

  if (contentMeta?.truncated) {
    bits.push(`Content truncated to ${contentMeta.submittedCharacters.toLocaleString()} characters`);
  }

  if (usage?.total_tokens) {
    bits.push(`Tokens: ${usage.total_tokens.toLocaleString()}`);
  }

  return bits.length ? bits.join(" | ") : "Generated by DeepSeek.";
}

async function getActivePageContext() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.url || !tab.id) {
    return null;
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch (_error) {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const isYouTubeWatch = url.hostname.includes("youtube.com") && url.pathname === "/watch";
  const videoId = url.searchParams.get("v") || "";

  if (isYouTubeWatch && /^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return {
      contentType: "youtube",
      tabId: tab.id,
      url: tab.url,
      videoId,
      title: cleanPageTitle(tab.title || "", "youtube"),
      channel: "",
      duration: ""
    };
  }

  if (isYouTubeWatch) {
    return null;
  }

  return {
    contentType: "article",
    tabId: tab.id,
    url: tab.url,
    title: cleanPageTitle(tab.title || "", "article"),
    siteName: url.hostname.replace(/^www\./, ""),
    author: "",
    publishDate: "",
    excerpt: "",
    wordCount: 0
  };
}

function cleanPageTitle(title, contentType) {
  if (contentType === "youtube") {
    return title.replace(/\s+-\s+YouTube$/, "").trim();
  }

  return title.trim();
}

function getCacheKey(activePage, settings) {
  const identity = activePage.contentType === "youtube"
    ? activePage.videoId
    : activePage.url;

  return [
    activePage.contentType,
    identity,
    activePage.contentType === "article" ? ARTICLE_EXTRACTOR_CACHE_VERSION : "youtube-extractor-v1",
    settings.model || DEFAULT_SETTINGS.model,
    settings.summaryLanguage || DEFAULT_SETTINGS.summaryLanguage,
    getPromptForPageType(settings, activePage.contentType),
    settings.preferredCaptionLanguage || DEFAULT_SETTINGS.preferredCaptionLanguage,
    settings.maxTranscriptChars || DEFAULT_SETTINGS.maxTranscriptChars,
    settings.maxArticleChars || DEFAULT_SETTINGS.maxArticleChars
  ].join(":");
}

async function saveSummaryCache(cacheKey, summary) {
  const { summaryCache = {} } = await chrome.storage.local.get({ summaryCache: {} });
  const entries = Object.entries({
    ...summaryCache,
    [cacheKey]: {
      summary,
      savedAt: Date.now()
    }
  }).sort((left, right) => right[1].savedAt - left[1].savedAt);

  await chrome.storage.local.set({
    summaryCache: Object.fromEntries(entries.slice(0, 12))
  });
}

function showSettings() {
  summaryView.hidden = true;
  settingsView.hidden = false;
  settingsOpenButton.textContent = "Done";
  settingsOpenButton.setAttribute("aria-label", "Back to summary");
}

function showSummary() {
  settingsView.hidden = true;
  summaryView.hidden = false;
  settingsOpenButton.textContent = "Settings";
  settingsOpenButton.setAttribute("aria-label", "Open settings");
}

function setStatus(message, state = "") {
  statusNode.textContent = message;
  statusNode.className = `status${state ? ` ${state}` : ""}`;
}

function setSettingsStatus(message, state = "") {
  settingsStatusNode.textContent = message;
  settingsStatusNode.className = `status${state ? ` ${state}` : ""}`;
}

if (outputLanguageInput) {
  outputLanguageInput.addEventListener("change", async () => {
    const value = outputLanguageInput.value;
    if (summaryLanguageInput) {
      summaryLanguageInput.value = value;
    }
    await chrome.storage.local.set({ summaryLanguage: value });
    if (activePage) {
      const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
      if (stored.apiKey) {
        await summarizeCurrentPage({ force: true });
      }
    }
  });
}
