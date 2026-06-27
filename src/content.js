const PANEL_ID = "yt-ai-summary-panel";
const URL_CHECK_INTERVAL_MS = 1000;

let currentVideoId = "";
let currentUrl = "";
let isSummarizing = false;

init();

function init() {
  currentUrl = location.href;
  currentVideoId = getCurrentVideoId();
  ensurePanel();

  const observer = new MutationObserver(() => {
    const nextUrl = location.href;
    const nextVideoId = getCurrentVideoId();

    if (nextUrl !== currentUrl || nextVideoId !== currentVideoId) {
      currentUrl = nextUrl;
      currentVideoId = nextVideoId;
      resetPanel();
    }

    ensurePanel();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  setInterval(() => {
    const nextUrl = location.href;
    const nextVideoId = getCurrentVideoId();
    if (nextUrl !== currentUrl || nextVideoId !== currentVideoId) {
      currentUrl = nextUrl;
      currentVideoId = nextVideoId;
      resetPanel();
      ensurePanel();
    }
  }, URL_CHECK_INTERVAL_MS);
}

function ensurePanel() {
  if (!isWatchPage()) {
    return;
  }

  const existing = document.getElementById(PANEL_ID);
  if (existing && document.documentElement.contains(existing)) {
    return;
  }

  const target = document.querySelector("#secondary-inner") ||
    document.querySelector("#secondary") ||
    document.querySelector("ytd-watch-flexy #columns") ||
    document.body;

  if (!target) {
    return;
  }

  const panel = buildPanel();
  target.prepend(panel);
}

function buildPanel() {
  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.className = "ytai-panel";

  const header = document.createElement("div");
  header.className = "ytai-header";

  const title = document.createElement("div");
  title.className = "ytai-title";
  title.textContent = "AI Summary";

  const badge = document.createElement("div");
  badge.className = "ytai-badge";
  badge.textContent = "DeepSeek";

  header.append(title, badge);

  const actions = document.createElement("div");
  actions.className = "ytai-actions";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ytai-button";
  button.textContent = "Summarize Video";
  button.addEventListener("click", handleSummarizeClick);

  actions.append(button);

  const status = document.createElement("div");
  status.className = "ytai-status";
  status.textContent = "Uses captions from this video.";

  const result = document.createElement("pre");
  result.className = "ytai-result";
  result.hidden = true;

  panel.append(header, actions, status, result);
  return panel;
}

function resetPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) {
    return;
  }

  const status = panel.querySelector(".ytai-status");
  const result = panel.querySelector(".ytai-result");
  const button = panel.querySelector(".ytai-button");

  if (status) {
    status.textContent = "Uses captions from this video.";
    status.className = "ytai-status";
  }

  if (result) {
    result.textContent = "";
    result.hidden = true;
  }

  if (button) {
    button.disabled = false;
    button.textContent = "Summarize Video";
  }

  isSummarizing = false;
}

async function handleSummarizeClick() {
  if (isSummarizing) {
    return;
  }

  const videoId = getCurrentVideoId();
  if (!videoId) {
    setStatus("Open a YouTube video page first.", "error");
    return;
  }

  isSummarizing = true;
  setButtonState(true, "Summarizing...");
  setStatus("Fetching captions and asking DeepSeek...", "loading");
  setResult("");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "summarizeVideo",
      payload: {
        videoId,
        title: getVideoTitle(),
        channel: getChannelName(),
        duration: getVideoDuration()
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "The extension could not summarize this video.");
    }

    const { summary, transcriptMeta, usage } = response.result;
    const meta = buildMetaLine(transcriptMeta, usage);
    setResult(`${summary}\n\n${meta}`);
    setStatus("Summary ready.", "success");
  } catch (error) {
    setStatus(error?.message || String(error), "error");
  } finally {
    isSummarizing = false;
    setButtonState(false, "Summarize Video");
  }
}

function setButtonState(disabled, label) {
  const button = document.querySelector(`#${PANEL_ID} .ytai-button`);
  if (!button) {
    return;
  }

  button.disabled = disabled;
  button.textContent = label;
}

function setStatus(message, state = "") {
  const status = document.querySelector(`#${PANEL_ID} .ytai-status`);
  if (!status) {
    return;
  }

  status.textContent = message;
  status.className = `ytai-status${state ? ` ytai-status--${state}` : ""}`;
}

function setResult(summary) {
  const result = document.querySelector(`#${PANEL_ID} .ytai-result`);
  if (!result) {
    return;
  }

  result.textContent = summary;
  result.hidden = !summary;
}

function buildMetaLine(transcriptMeta, usage) {
  const bits = [];

  if (transcriptMeta?.label) {
    bits.push(`Captions: ${transcriptMeta.label}`);
  }

  if (transcriptMeta?.truncated) {
    bits.push(`Transcript truncated to ${transcriptMeta.submittedCharacters.toLocaleString()} characters`);
  }

  if (usage?.total_tokens) {
    bits.push(`Tokens: ${usage.total_tokens.toLocaleString()}`);
  }

  return bits.length ? bits.join(" | ") : "Generated by DeepSeek.";
}

function isWatchPage() {
  return location.hostname.includes("youtube.com") &&
    location.pathname === "/watch" &&
    Boolean(getCurrentVideoId());
}

function getCurrentVideoId() {
  try {
    return new URL(location.href).searchParams.get("v") || "";
  } catch (_error) {
    return "";
  }
}

function getVideoTitle() {
  const candidates = [
    "h1.ytd-watch-metadata yt-formatted-string",
    "h1.title yt-formatted-string",
    "ytd-watch-metadata h1",
    "meta[property='og:title']"
  ];

  for (const selector of candidates) {
    const node = document.querySelector(selector);
    const value = node?.content || node?.textContent;
    if (value?.trim()) {
      return value.trim();
    }
  }

  return document.title.replace(/\s+-\s+YouTube$/, "").trim();
}

function getChannelName() {
  const candidates = [
    "ytd-watch-metadata ytd-channel-name yt-formatted-string a",
    "ytd-video-owner-renderer ytd-channel-name a",
    "link[itemprop='name']"
  ];

  for (const selector of candidates) {
    const node = document.querySelector(selector);
    const value = node?.content || node?.textContent;
    if (value?.trim()) {
      return value.trim();
    }
  }

  return "";
}

function getVideoDuration() {
  const video = document.querySelector("video");
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
    return "";
  }

  const totalSeconds = Math.floor(video.duration);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
