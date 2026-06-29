import {
  chunkContent,
  preprocessArticleContent,
  preprocessYouTubeTranscript
} from "./lib/chunker.js";
import {
  ARTICLE_SYSTEM_PROMPT,
  buildUserPrompt,
  INTERMEDIATE_CHUNK_PROMPT,
  YOUTUBE_SYSTEM_PROMPT
} from "./lib/prompts.js";

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "deepseek-v4-flash",
  thinkingMode: "disabled",
  summaryLanguage: "same",
  preferredCaptionLanguage: "en",
  summaryPrompt: "",
  youtubeSummaryPrompt: YOUTUBE_SYSTEM_PROMPT,
  articleSummaryPrompt: ARTICLE_SYSTEM_PROMPT,
  maxTranscriptChars: 180000,
  maxArticleChars: 180000,
  contextWindow: 64000
};

const DEEPSEEK_CHAT_COMPLETIONS_URL = "https://api.deepseek.com/chat/completions";
const WATCH_URL = "https://www.youtube.com/watch";
const REQUEST_TIMEOUT_MS = 120000;
const YOUTUBE_TIMEDTEXT_URL_FILTER = {
  urls: [
    "*://youtube.com/api/timedtext?*",
    "*://*.youtube.com/api/timedtext?*"
  ]
};

if (chrome.webRequest?.onBeforeRequest) {
  chrome.webRequest.onBeforeRequest.addListener(
    relayYouTubeTimedtextRequest,
    YOUTUBE_TIMEDTEXT_URL_FILTER
  );
}

function relayYouTubeTimedtextRequest(details) {
  if (!details?.url || typeof details.tabId !== "number" || details.tabId < 0) {
    return;
  }

  try {
    const maybePromise = chrome.tabs.sendMessage(details.tabId, {
      type: "youtubeTimedtextUrl",
      url: details.url
    });
    if (maybePromise && typeof maybePromise.catch === "function") {
      maybePromise.catch(() => {});
    }
  } catch (_error) {
    // The YouTube tab may not have the capture content script yet.
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "summarizeContent" || message.type === "summarizeVideo") {
    summarizeContent(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === "getSettings") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, result: redactSettings(settings) }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message.type === "getTranscript") {
    loadTranscriptForVideo(message.payload?.videoId, message.payload?.preferredLanguage)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

// Streaming summaries: the popup opens a port and receives deltas as DeepSeek writes.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "summarize-stream") {
    return;
  }

  let started = false;
  port.onMessage.addListener((message) => {
    if (started || message?.type !== "start") {
      return;
    }
    started = true;

    summarizeContent(message.payload, (delta) => {
      try { port.postMessage({ type: "delta", text: delta }); } catch (_error) {}
    })
      .then((result) => {
        try { port.postMessage({ type: "done", result }); } catch (_error) {}
        try { port.disconnect(); } catch (_error) {}
      })
      .catch((error) => {
        try { port.postMessage({ type: "error", error: getErrorMessage(error) }); } catch (_error) {}
        try { port.disconnect(); } catch (_error) {}
      });
  });
});

async function summarizeContent(payload = {}, onDelta = null) {
  const settings = await getSettings();
  const apiKey = settings.apiKey.trim();

  if (!apiKey) {
    throw new Error("Add your DeepSeek API key in the extension popup first.");
  }

  const contentType = payload.contentType === "article" ? "article" : "youtube";
  let sourcePayload = { ...payload };
  let rawContent = String(sourcePayload.content || "").trim();

  if (!rawContent && contentType === "youtube") {
    const videoId = normalizeVideoId(sourcePayload.videoId);
    if (videoId) {
      const transcriptPayload = await loadTranscriptForVideo(videoId, settings.preferredCaptionLanguage);
      sourcePayload = {
        ...sourcePayload,
        title: sourcePayload.title || transcriptPayload.title,
        channel: sourcePayload.channel || transcriptPayload.channel,
        duration: sourcePayload.duration || transcriptPayload.duration,
        transcriptMeta: sourcePayload.transcriptMeta || transcriptPayload.meta,
        content: transcriptPayload.transcript
      };
      rawContent = String(sourcePayload.content || "").trim();
    }
  }

  if (!rawContent) {
    throw new Error(contentType === "article"
      ? "Could not extract readable article text from this page."
      : "Could not read captions from this YouTube video.");
  }

  const contentLimit = contentType === "article"
    ? normalizeContentLimit(settings.maxArticleChars, DEFAULT_SETTINGS.maxArticleChars)
    : normalizeContentLimit(settings.maxTranscriptChars, DEFAULT_SETTINGS.maxTranscriptChars);

  const processedContent = contentType === "article"
    ? preprocessArticleContent(rawContent).slice(0, contentLimit)
    : preprocessYouTubeTranscript(rawContent).slice(0, contentLimit);

  const wasTruncated = rawContent.length > contentLimit;
  const metadata = buildMetadata(contentType, sourcePayload, wasTruncated, rawContent.length, processedContent.length);
  const systemPrompt = getPromptForContentType(settings, contentType);
  const chunks = chunkContent(processedContent, {
    contextWindow: normalizeContextWindow(settings.contextWindow)
  });

  const targetLanguage = resolveTargetLanguage(settings, contentType, payload, processedContent);

  const summary = chunks.length === 1
    ? await oneShotSummarize({
      apiKey,
      settings,
      contentType,
      systemPrompt,
      metadata,
      content: chunks[0],
      targetLanguage,
      onDelta
    })
    : await rollingSummarize({
      apiKey,
      settings,
      contentType,
      systemPrompt,
      metadata,
      chunks,
      targetLanguage,
      onDelta
    });

  return {
    summary: summary.text,
    usage: summary.usage,
    contentMeta: metadata
  };
}

async function oneShotSummarize({
  apiKey,
  settings,
  contentType,
  systemPrompt,
  metadata,
  content,
  targetLanguage,
  onDelta
}) {
  const body = buildChatRequest({
    settings,
    systemPrompt,
    targetLanguage,
    userPrompt: buildUserPrompt({
      contentType,
      metadata,
      content,
      chunkIndex: 0,
      totalChunks: 1
    }),
    maxTokens: 1800
  });

  if (onDelta) {
    const streamed = await callDeepSeekStreaming(apiKey, body, onDelta);
    return { text: ensureSummaryText(streamed.text), usage: streamed.usage || null };
  }

  const data = await callDeepSeek(apiKey, body);
  return {
    text: extractSummaryText(data),
    usage: data.usage || null
  };
}

async function rollingSummarize({
  apiKey,
  settings,
  contentType,
  systemPrompt,
  metadata,
  chunks,
  targetLanguage,
  onDelta
}) {
  let rollingSummary = "";

  for (let index = 0; index < chunks.length; index += 1) {
    const isLast = index === chunks.length - 1;
    const activeSystemPrompt = isLast ? systemPrompt : INTERMEDIATE_CHUNK_PROMPT;
    const userPrompt = buildUserPrompt({
      contentType,
      metadata,
      content: chunks[index],
      chunkIndex: index,
      totalChunks: chunks.length,
      rollingSummary,
      isFinalChunk: isLast
    });

    const body = buildChatRequest({
      settings,
      systemPrompt: activeSystemPrompt,
      targetLanguage: isLast ? targetLanguage : null,
      userPrompt,
      maxTokens: isLast ? 2200 : 1600
    });

    if (isLast && onDelta) {
      const streamed = await callDeepSeekStreaming(apiKey, body, onDelta);
      return { text: ensureSummaryText(streamed.text), usage: streamed.usage || null };
    }

    const data = await callDeepSeek(apiKey, body);
    const responseText = extractSummaryText(data);

    if (isLast) {
      return {
        text: responseText,
        usage: data.usage || null
      };
    }

    rollingSummary = responseText;
  }

  throw new Error("DeepSeek returned an empty summary.");
}

function buildChatRequest({ settings, systemPrompt, userPrompt, maxTokens, targetLanguage }) {
  const languageInstruction = targetLanguage?.name
    ? `Write the ENTIRE summary, including every heading and bullet, in ${targetLanguage.name}. Do not switch languages or mix in another language, regardless of the language of these instructions or examples.`
    : "Write the summary in the same language as the source transcript or article. Do not translate it into another language.";

  const request = {
    model: settings.model || DEFAULT_SETTINGS.model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `${languageInstruction}\n\n${userPrompt}`
      }
    ],
    stream: false,
    max_tokens: maxTokens,
    thinking: {
      type: settings.thinkingMode === "enabled" ? "enabled" : "disabled"
    }
  };

  if (request.thinking.type === "enabled") {
    request.reasoning_effort = "high";
  } else {
    request.temperature = 0.2;
  }

  return request;
}

async function callDeepSeek(apiKey, body) {
  const response = await fetchWithTimeout(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(formatDeepSeekError(response.status, data));
  }

  return data;
}

function extractSummaryText(data) {
  const summary = data?.choices?.[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error("DeepSeek returned an empty summary.");
  }
  return summary;
}

function ensureSummaryText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    throw new Error("DeepSeek returned an empty summary.");
  }
  return trimmed;
}

async function callDeepSeekStreaming(apiKey, body, onDelta) {
  const response = await fetchWithTimeout(DEEPSEEK_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ ...body, stream: true })
  });

  if (!response.ok) {
    const data = await parseJsonResponse(response);
    throw new Error(formatDeepSeekError(response.status, data));
  }

  // Fallback if the platform does not expose a readable stream.
  if (!response.body || typeof response.body.getReader !== "function") {
    const data = await parseJsonResponse(response);
    const text = extractSummaryText(data);
    onDelta(text);
    return { text, usage: data?.usage || null };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) {
        continue;
      }
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      let json;
      try {
        json = JSON.parse(data);
      } catch (_error) {
        continue;
      }
      const delta = json.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        onDelta(delta);
      }
      if (json.usage) {
        usage = json.usage;
      }
    }
  }

  return { text: full, usage };
}

const LANGUAGE_NAMES = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", pl: "Polish", ru: "Russian", uk: "Ukrainian",
  tr: "Turkish", sv: "Swedish", cs: "Czech", ro: "Romanian", el: "Greek",
  hu: "Hungarian", fi: "Finnish", da: "Danish", no: "Norwegian", id: "Indonesian",
  vi: "Vietnamese", th: "Thai", ar: "Arabic", fa: "Persian", he: "Hebrew",
  hi: "Hindi", ja: "Japanese", ko: "Korean", zh: "Chinese"
};

function languageEntry(code) {
  const normalized = String(code || "").toLowerCase().split(/[-_]/)[0];
  if (normalized && LANGUAGE_NAMES[normalized]) {
    return { code: normalized, name: LANGUAGE_NAMES[normalized] };
  }
  return null;
}

// Decide which language the summary should be written in.
// Auto rule: Russian source -> Russian, Czech source -> Czech, everything else -> English.
function resolveTargetLanguage(settings, contentType, payload, content) {
  const requested = String(settings.summaryLanguage || "same").toLowerCase();

  // An explicit manual choice always wins.
  if (requested && requested !== "same" && requested !== "auto") {
    const explicit = languageEntry(requested);
    if (explicit) {
      return explicit;
    }
  }

  const detected = detectSourceLanguageCode(payload, content);
  if (detected === "ru") {
    return languageEntry("ru");
  }
  if (detected === "cs") {
    return languageEntry("cs");
  }
  return languageEntry("en");
}

function detectSourceLanguageCode(payload, content) {
  const known = languageEntry(
    payload?.transcriptMeta?.languageCode ||
    payload?.contentMeta?.languageCode ||
    payload?.languageCode
  );
  if (known) {
    return known.code;
  }
  const detected = detectLanguage(content);
  return detected ? detected.code : null;
}

function detectLanguage(text) {
  const sample = String(text || "").slice(0, 4000);
  if (!sample.trim()) {
    return null;
  }

  // Non-Latin writing systems are highly reliable signals.
  const scripts = [
    [/[\u3040-\u309F\u30A0-\u30FF]/g, "ja"],
    [/[\uAC00-\uD7AF]/g, "ko"],
    [/[\u4E00-\u9FFF]/g, "zh"],
    [/[\u0E00-\u0E7F]/g, "th"],
    [/[\u0590-\u05FF]/g, "he"],
    [/[\u0600-\u06FF]/g, "ar"],
    [/[\u0900-\u097F]/g, "hi"],
    [/[\u0370-\u03FF]/g, "el"]
  ];
  for (const [re, code] of scripts) {
    const matches = sample.match(re);
    if (matches && matches.length > 12) {
      return languageEntry(code);
    }
  }

  // Cyrillic: Ukrainian has letters Russian lacks.
  if ((sample.match(/[\u0400-\u04FF]/g) || []).length > 12) {
    return /[іїєґ]/i.test(sample) ? languageEntry("uk") : languageEntry("ru");
  }

  // Czech uses Latin letters that are rare elsewhere (ř, ů, ě).
  if ((sample.match(/[řůěŘŮĚ]/g) || []).length > 3) {
    return languageEntry("cs");
  }

  // Latin scripts: score by frequent function words.
  const lower = ` ${sample.toLowerCase().replace(/[^a-zà-ÿ\s]/g, " ")} `;
  const stopwords = {
    en: ["the", "and", "to", "of", "is", "that", "it", "you"],
    es: ["el", "la", "que", "de", "los", "una", "para", "con"],
    fr: ["le", "la", "les", "des", "que", "une", "pour", "est"],
    de: ["der", "die", "und", "das", "ist", "nicht", "ein", "auch"],
    pt: ["que", "de", "para", "uma", "com", "nao", "isso", "voce"],
    it: ["che", "di", "il", "la", "per", "una", "non", "sono"],
    nl: ["de", "het", "een", "dat", "niet", "van", "ook", "maar"],
    pl: ["nie", "to", "sie", "jest", "na", "co", "jak", "tak"],
    id: ["yang", "dan", "di", "ini", "untuk", "dengan", "tidak", "kita"],
    tr: ["ve", "bir", "bu", "icin", "ile", "degil", "cok", "ama"]
  };
  let best = null;
  let bestScore = 0;
  for (const code of Object.keys(stopwords)) {
    let score = 0;
    for (const w of stopwords[code]) {
      const m = lower.match(new RegExp(` ${w} `, "g"));
      if (m) {
        score += m.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = code;
    }
  }
  return bestScore >= 3 ? languageEntry(best) : null;
}

function buildMetadata(contentType, payload, truncated, originalCharacters, submittedCharacters) {
  const base = {
    contentType,
    truncated,
    originalCharacters,
    submittedCharacters
  };

  if (contentType === "article") {
    return {
      ...base,
      url: payload.url || "",
      title: payload.title || "Untitled page",
      siteName: payload.siteName || "",
      author: payload.author || "",
      publishDate: payload.publishDate || "",
      excerpt: payload.excerpt || "",
      wordCount: payload.wordCount || 0,
      source: payload.contentMeta?.source || "readability"
    };
  }

  return {
    ...base,
    videoId: normalizeVideoId(payload.videoId),
    title: payload.title || "Untitled video",
    channel: payload.channel || "",
    duration: payload.duration || "",
    captionLabel: payload.transcriptMeta?.label || payload.contentMeta?.label || "YouTube captions",
    languageCode: payload.transcriptMeta?.languageCode || payload.contentMeta?.languageCode || "",
    isAutoGenerated: Boolean(payload.transcriptMeta?.isAutoGenerated),
    source: payload.transcriptMeta?.source || payload.contentMeta?.source || "youtube"
  };
}

async function loadTranscriptForVideo(videoId, preferredLanguage) {
  const playerResponse = await fetchPlayerResponse(videoId);
  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

  if (!captionTracks.length) {
    throw new Error("This video does not expose captions that the extension can summarize.");
  }

  const rankedTracks = rankCaptionTracks(captionTracks, preferredLanguage);
  let lastError = null;

  for (const track of rankedTracks) {
    if (!track?.baseUrl) {
      continue;
    }

    try {
      const transcript = await fetchTranscriptForTrack(track);
      if (!transcript.trim()) {
        continue;
      }

      return {
        transcript,
        title: playerResponse?.videoDetails?.title || "",
        channel: playerResponse?.videoDetails?.author || "",
        duration: formatDuration(playerResponse?.videoDetails?.lengthSeconds),
        meta: {
          label: getTrackLabel(track),
          languageCode: track.languageCode || "",
          isAutoGenerated: track.kind === "asr"
        }
      };
    } catch (error) {
      lastError = error;
      if (error?.status === 429) {
        break;
      }
    }
  }

  if (lastError?.status === 429) {
    throw new Error("YouTube is rate-limiting caption downloads (429). Wait a few minutes, reload the YouTube tab, then click the extension again.");
  }

  throw new Error(lastError?.message || "YouTube returned caption tracks, but none contained readable text.");
}

async function fetchPlayerResponse(videoId) {
  const url = new URL(WATCH_URL);
  url.searchParams.set("v", videoId);
  url.searchParams.set("hl", "en");

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    credentials: "include",
    headers: {
      "Accept-Language": "en-US,en;q=0.9"
    }
  });

  if (!response.ok) {
    throw new Error(`Could not load the YouTube watch page (${response.status}).`);
  }

  const html = await response.text();
  const playerResponse = extractYtInitialPlayerResponse(html);

  if (!playerResponse) {
    throw new Error("Could not read YouTube player metadata for this video.");
  }

  return playerResponse;
}

function extractYtInitialPlayerResponse(html) {
  const markers = [
    "ytInitialPlayerResponse =",
    "ytInitialPlayerResponse=",
    "window[\"ytInitialPlayerResponse\"] =",
    "window['ytInitialPlayerResponse'] ="
  ];

  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }

    const objectStart = html.indexOf("{", markerIndex + marker.length);
    if (objectStart === -1) {
      continue;
    }

    const jsonText = readBalancedJsonObject(html, objectStart);
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

async function fetchTranscriptForTrack(track) {
  const formats = ["json3", "vtt", "srv3", ""];
  let lastError = null;

  for (const format of formats) {
    try {
      const response = await fetchWithTimeout(buildCaptionUrl(track.baseUrl, format), {
        method: "GET",
        credentials: "include"
      });

      if (!response.ok) {
        lastError = createCaptionFetchError(response.status);
        if (response.status === 429) {
          throw lastError;
        }
        continue;
      }

      const text = await response.text();
      const transcript = parseCaptionResponse(text, format);
      if (transcript.trim()) {
        return transcript;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return "";
}

function createCaptionFetchError(status) {
  const error = new Error(`Could not fetch YouTube captions (${status}).`);
  error.status = status;
  return error;
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

function rankCaptionTracks(tracks, preferredLanguage = "en") {
  const normalizedPreferred = (preferredLanguage || "en").toLowerCase();
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

function scoreCaptionTrack(languageCode, isAutoGenerated, preferredLanguage) {
  if (languageCode === preferredLanguage && !isAutoGenerated) return 0;
  if (languageCode === preferredLanguage) return 1;
  if (languageCode.startsWith(`${preferredLanguage}-`) && !isAutoGenerated) return 2;
  if (languageCode.startsWith(`${preferredLanguage}-`)) return 3;
  if (languageCode.startsWith("en") && !isAutoGenerated) return 4;
  if (languageCode.startsWith("en")) return 5;
  if (!isAutoGenerated) return 6;
  return 7;
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

    if (!text) {
      continue;
    }

    lines.push(`[${formatTimestamp(event.tStartMs || 0)}] ${text}`);
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

  const milliseconds = attributeName === "start" ? value * 1000 : value;
  return formatTimestamp(milliseconds);
}

function stripHtmlTags(value) {
  return value.replace(/<[^>]+>/g, "").trim();
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

function formatDuration(lengthSeconds) {
  const seconds = Number(lengthSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  return formatTimestamp(seconds * 1000);
}

function getTrackLabel(track) {
  const simpleText = track?.name?.simpleText;
  if (simpleText) {
    return simpleText;
  }

  const runs = track?.name?.runs;
  if (Array.isArray(runs)) {
    return runs.map((run) => run.text || "").join("").trim();
  }

  return track?.languageCode || "Caption track";
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The request timed out. Try again with a shorter content limit.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function formatDeepSeekError(status, data) {
  const message = data?.error?.message || data?.message || data?.raw || "Unknown DeepSeek API error.";
  return `DeepSeek request failed (${status}): ${message}`;
}

function normalizeVideoId(videoId) {
  const normalized = String(videoId || "").trim();
  return /^[a-zA-Z0-9_-]{11}$/.test(normalized) ? normalized : "";
}

function normalizeContentLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.max(20000, Math.min(600000, Math.floor(number)));
}

function normalizeContextWindow(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_SETTINGS.contextWindow;
  }

  return Math.max(16000, Math.min(128000, Math.floor(number)));
}

function getPromptForContentType(settings, contentType) {
  const sharedPrompt = String(settings.summaryPrompt || "").trim();
  if (sharedPrompt) {
    return sharedPrompt;
  }

  if (contentType === "article") {
    return String(settings.articleSummaryPrompt || "").trim() || ARTICLE_SYSTEM_PROMPT;
  }

  return String(settings.youtubeSummaryPrompt || "").trim() || YOUTUBE_SYSTEM_PROMPT;
}

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      resolve({
        ...DEFAULT_SETTINGS,
        ...items
      });
    });
  });
}

function redactSettings(settings) {
  return {
    ...settings,
    apiKey: settings.apiKey ? "saved" : ""
  };
}

function getErrorMessage(error) {
  return error?.message || String(error);
}

export {
  loadTranscriptForVideo,
  summarizeContent
};
