import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const popupSource = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const extractorSource = extractFunctionSource(popupSource, "extractYouTubeTranscriptFromPage");
const playerResponseExtractorSource = extractFunctionSource(popupSource, "extractTranscriptViaPlayerResponse");
const loadTranscriptSource = extractFunctionSource(popupSource, "loadTranscriptViaPlayerResponse");
const articleExtractorSource = extractFunctionSource(popupSource, "extractArticleFromPage");

await testVisibleTranscriptPanel();
await testShowTranscriptButtonOpensPanel();
await testVisibleTextTranscriptFallback();
await testChoosesExpandedTranscriptPanel();
await testModernTranscriptPanel();
await testEmptyPanelFallsBackToCaptionTracks();
await testPlayerResponseExtractorHandlesBracesInsideStrings();
await testPlayerResponseExtractorTriesAlternateCaptionFormats();
await testLoadTranscriptUsesTimedtextInterceptBeforePanelFallback();
await testLoadTranscriptUsesPanelFallbackAfterCaptionDownloadFailure();
await testLoadTranscriptReportsLatestFallbackError();
await testArticleSemanticDomFallback();
await testArticlePreviewPaywallMessage();
await testArticleRegistrationWallMessage();

console.log("extractor smoke tests passed");

function extractFunctionSource(source, functionName) {
  const asyncMarker = `async function ${functionName}`;
  const functionMarker = `function ${functionName}`;
  const asyncStart = source.indexOf(asyncMarker);
  const start = asyncStart !== -1 ? asyncStart : source.indexOf(functionMarker);
  assert.notEqual(start, -1, `Could not find ${functionName}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === stringQuote) {
        inString = false;
        stringQuote = "";
      }
      continue;
    }

    if (char === "/" && nextChar === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`Could not parse ${functionName}`);
}

async function testVisibleTranscriptPanel() {
  const fixture = createYouTubeFixture({ panelVisible: true });
  const result = await runExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, "youtube-transcript-panel");
  assert.match(result.transcript, /\[0:01\] First line/);
  assert.match(result.transcript, /\[0:04\] Second line/);
  assert.equal(fixture.button.clicked, false);
}

async function testShowTranscriptButtonOpensPanel() {
  const fixture = createYouTubeFixture({ panelVisible: false });
  const result = await runExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, "youtube-transcript-panel");
  assert.match(result.transcript, /First line/);
  assert.equal(fixture.button.clicked, true);
}

async function testVisibleTextTranscriptFallback() {
  const fixture = createYouTubeFixture({
    panelVisible: true,
    panelMode: "visibleText"
  });
  const result = await runExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, "youtube-transcript-panel");
  assert.match(result.transcript, /\[0:01\] First visible line/);
  assert.match(result.transcript, /\[0:08\] Second visible line/);
  assert.equal(fixture.button.clicked, false);
}

async function testChoosesExpandedTranscriptPanel() {
  const fixture = createYouTubeFixture({
    panelVisible: true,
    hiddenEmptyPanelBeforeTranscript: true
  });
  const result = await runExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, "youtube-transcript-panel");
  assert.match(result.transcript, /\[0:01\] First line/);
  assert.match(result.transcript, /\[0:04\] Second line/);
  assert.equal(fixture.button.clicked, false);
}

async function testModernTranscriptPanel() {
  const fixture = createYouTubeFixture({
    panelVisible: true,
    panelMode: "modernSegments",
    panelTargetId: "",
    panelInnerText: [
      "In this video",
      "Chapters",
      "Transcript",
      "Search transcript",
      "0:00 First modern line",
      "0:09 9 seconds Second modern line",
      "1:05 1 minute, 5 seconds Third modern line"
    ].join("\n")
  });
  const result = await runExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, "youtube-transcript-panel");
  assert.match(result.transcript, /\[0:00\] First modern line/);
  assert.match(result.transcript, /\[0:09\] Second modern line/);
  assert.match(result.transcript, /\[1:05\] Third modern line/);
  assert.equal(fixture.button.clicked, false);
}

async function testEmptyPanelFallsBackToCaptionTracks() {
  const fetchCalls = [];
  const fixture = createYouTubeFixture({
    panelVisible: false,
    panelMode: "empty",
    panelInnerText: "Transcript\nSearch transcript",
    playerResponse: {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://example.test/captions",
              languageCode: "en",
              kind: "asr",
              name: { simpleText: "English (auto-generated)" }
            }
          ]
        }
      },
      videoDetails: {
        lengthSeconds: "125"
      }
    },
    async fetch(url) {
      fetchCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            events: [
              { tStartMs: 1000, segs: [{ utf8: "Caption fallback line" }] },
              { tStartMs: 4000, segs: [{ utf8: "Second caption line" }] }
            ]
          });
        }
      };
    }
  });
  const result = await runExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.meta.source, "caption-url-fallback");
  assert.equal(result.meta.label, "English (auto-generated)");
  assert.match(result.transcript, /\[0:01\] Caption fallback line/);
  assert.match(fetchCalls[0], /fmt=json3/);
  assert.equal(fixture.button.clicked, true);
}

async function runExtractor(fixture) {
  const context = {
    console,
    document: fixture.document,
    getComputedStyle: fixture.getComputedStyle,
    fetch: fixture.fetch,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  if (fixture.playerResponse) {
    context.ytInitialPlayerResponse = fixture.playerResponse;
  }
  vm.createContext(context);
  vm.runInContext(`${extractorSource}; globalThis.__extractor = extractYouTubeTranscriptFromPage;`, context);
  return await context.__extractor("en");
}

async function runArticleExtractor(fixture) {
  const context = {
    console,
    document: fixture.document,
    window: {
      location: {
        href: fixture.url || "https://example.test/story"
      }
    },
    getComputedStyle: fixture.getComputedStyle,
    Readability: fixture.Readability,
    isProbablyReaderable: fixture.isProbablyReaderable
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${articleExtractorSource}; globalThis.__articleExtractor = extractArticleFromPage;`, context);
  return await context.__articleExtractor();
}

async function runPlayerResponseExtractor(fixture) {
  const context = {
    console,
    document: fixture.document,
    fetch: fixture.fetch,
    window: fixture.window || {}
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${playerResponseExtractorSource}; globalThis.__playerExtractor = extractTranscriptViaPlayerResponse;`, context);
  return await context.__playerExtractor("en");
}

async function testPlayerResponseExtractorHandlesBracesInsideStrings() {
  const fetchCalls = [];
  const playerResponse = {
    videoDetails: {
      title: "Creator setup } walkthrough",
      author: "Fixture Blogger",
      lengthSeconds: "92"
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://example.test/api/timedtext",
            languageCode: "en",
            name: { runs: [{ text: "English" }] }
          }
        ]
      }
    }
  };
  const fixture = {
    document: {
      querySelectorAll(selector) {
        if (selector === "script") {
          return [{ textContent: `window["ytInitialPlayerResponse"] = ${JSON.stringify(playerResponse)};` }];
        }
        return [];
      }
    },
    async fetch(url) {
      fetchCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            events: [
              { tStartMs: 0, segs: [{ utf8: "First caption line." }] },
              { tStartMs: 4200, segs: [{ utf8: "Second caption line." }] }
            ]
          };
        }
      };
    }
  };
  const result = await runPlayerResponseExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.title, "Creator setup } walkthrough");
  assert.equal(result.channel, "Fixture Blogger");
  assert.equal(result.duration, "1:32");
  assert.equal(result.meta.label, "English");
  assert.match(result.transcript, /\[0:00\] First caption line\./);
  assert.match(result.transcript, /\[0:04\] Second caption line\./);
  assert.equal(fetchCalls[0], "https://example.test/api/timedtext?fmt=json3");
}

async function testPlayerResponseExtractorTriesAlternateCaptionFormats() {
  const fetchCalls = [];
  const playerResponse = {
    videoDetails: {
      title: "Blogger caption format fallback",
      author: "Fixture Blogger",
      lengthSeconds: "12"
    },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://example.test/api/timedtext",
            languageCode: "en",
            name: { simpleText: "English" }
          }
        ]
      }
    }
  };
  const fixture = {
    window: { ytInitialPlayerResponse: playerResponse },
    document: {
      querySelectorAll() {
        return [];
      }
    },
    async fetch(url) {
      fetchCalls.push(String(url));
      if (String(url).includes("fmt=json3")) {
        return {
          ok: false,
          status: 429,
          async text() {
            return "rate limited";
          }
        };
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return [
            "WEBVTT",
            "",
            "00:00:01.000 --> 00:00:03.000",
            "First VTT fallback line.",
            "",
            "00:00:04.000 --> 00:00:06.000",
            "Second VTT fallback line."
          ].join("\n");
        }
      };
    }
  };
  const result = await runPlayerResponseExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(fetchCalls[0], "https://example.test/api/timedtext?fmt=json3");
  assert.equal(fetchCalls[1], "https://example.test/api/timedtext?fmt=vtt");
  assert.match(result.transcript, /First VTT fallback line\./);
  assert.match(result.transcript, /Second VTT fallback line\./);
}

async function testLoadTranscriptUsesTimedtextInterceptBeforePanelFallback() {
  const executeCalls = [];
  let tabMessage = null;
  let backgroundFallbackCalled = false;
  const context = {
    console,
    activePage: {
      videoId: "fixture12345",
      title: "Active fixture video"
    },
    DEFAULT_SETTINGS: {
      preferredCaptionLanguage: "en"
    },
    setStatus() {},
    chrome: {
      scripting: {
        async executeScript(options) {
          executeCalls.push(options.func.name);
          if (options.func.name === "extractTranscriptViaPlayerResponse") {
            return [{
              result: {
                ok: false,
                error: "Caption download failed (429)."
              }
            }];
          }

          throw new Error("Transcript panel fallback should not run after timedtext interception succeeds.");
        }
      },
      tabs: {
        async sendMessage(tabId, message) {
          tabMessage = { tabId, message };
          return {
            ok: true,
            transcript: "[0:00] Intercepted timedtext line.",
            title: "Timedtext fixture video",
            channel: "Fixture Blogger",
            duration: "0:42",
            meta: {
              label: "YouTube player captions",
              languageCode: "en",
              source: "youtube-player-timedtext"
            }
          };
        }
      },
      runtime: {
        async sendMessage() {
          backgroundFallbackCalled = true;
          return {
            ok: false,
            error: "Background fallback should not run after timedtext interception succeeds."
          };
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext([
    extractorSource,
    playerResponseExtractorSource,
    loadTranscriptSource,
    "globalThis.__loadTranscript = loadTranscriptViaPlayerResponse;"
  ].join("\n"), context);

  const result = await context.__loadTranscript(123, "en");

  assert.deepEqual(executeCalls, ["extractTranscriptViaPlayerResponse"]);
  assert.equal(tabMessage.tabId, 123);
  assert.equal(tabMessage.message.type, "captureYouTubeTimedtextTranscript");
  assert.equal(tabMessage.message.preferredLanguage, "en");
  assert.equal(backgroundFallbackCalled, false);
  assert.equal(result.transcript, "[0:00] Intercepted timedtext line.");
  assert.equal(result.transcriptMeta.source, "youtube-player-timedtext");
  assert.equal(result.title, "Timedtext fixture video");
}

async function testLoadTranscriptUsesPanelFallbackAfterCaptionDownloadFailure() {
  const executeCalls = [];
  const context = {
    console,
    activePage: {
      videoId: "fixture12345",
      title: "Active fixture video"
    },
    DEFAULT_SETTINGS: {
      preferredCaptionLanguage: "en"
    },
    setStatus() {},
    chrome: {
      scripting: {
        async executeScript(options) {
          executeCalls.push(options.func.name);
          if (options.func.name === "extractTranscriptViaPlayerResponse") {
            return [{
              result: {
                ok: false,
                error: "Caption download failed (429)."
              }
            }];
          }

          if (options.func.name === "extractYouTubeTranscriptFromPage") {
            return [{
              result: {
                ok: true,
                transcript: "[0:00] Panel transcript line.",
                title: "Panel fixture video",
                channel: "Fixture Blogger",
                duration: "0:20",
                meta: {
                  label: "YouTube transcript panel",
                  source: "youtube-transcript-panel"
                }
              }
            }];
          }

          throw new Error(`Unexpected executeScript call: ${options.func.name}`);
        }
      },
      runtime: {
        async sendMessage() {
          return {
            ok: false,
            error: "Background caption download should not run before the panel fallback."
          };
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext([
    extractorSource,
    playerResponseExtractorSource,
    loadTranscriptSource,
    "globalThis.__loadTranscript = loadTranscriptViaPlayerResponse;"
  ].join("\n"), context);

  const result = await context.__loadTranscript(123, "en");

  assert.deepEqual(executeCalls, [
    "extractTranscriptViaPlayerResponse",
    "extractYouTubeTranscriptFromPage"
  ]);
  assert.equal(result.transcript, "[0:00] Panel transcript line.");
  assert.equal(result.transcriptMeta.source, "youtube-transcript-panel");
  assert.equal(result.title, "Panel fixture video");
}

async function testLoadTranscriptReportsLatestFallbackError() {
  const context = {
    console,
    activePage: {
      videoId: "fixture12345",
      title: "Active fixture video"
    },
    DEFAULT_SETTINGS: {
      preferredCaptionLanguage: "en"
    },
    setStatus() {},
    chrome: {
      scripting: {
        async executeScript(options) {
          if (options.func.name === "extractTranscriptViaPlayerResponse") {
            return [{ result: { ok: false, error: "Caption download failed (429)." } }];
          }

          if (options.func.name === "extractYouTubeTranscriptFromPage") {
            return [{ result: { ok: false, error: "Transcript panel opened, but YouTube did not return transcript rows." } }];
          }

          throw new Error(`Unexpected executeScript call: ${options.func.name}`);
        }
      },
      runtime: {
        async sendMessage() {
          return {
            ok: false,
            error: "YouTube is rate-limiting caption downloads (429). Wait a few minutes, reload the YouTube tab, then click the extension again."
          };
        }
      }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext([
    extractorSource,
    playerResponseExtractorSource,
    loadTranscriptSource,
    "globalThis.__loadTranscript = loadTranscriptViaPlayerResponse;"
  ].join("\n"), context);

  await assert.rejects(
    () => context.__loadTranscript(123, "en"),
    /rate-limiting caption downloads/
  );
}

async function testArticleSemanticDomFallback() {
  const fixture = createArticleFixture({
    url: "https://publisher.test/news/story",
    isProbablyReaderable: () => false,
    readabilityResult: null,
    articleText: [
      "Publisher test headline",
      "The first paragraph has enough detail to prove semantic DOM extraction works on custom publisher markup.",
      "A second paragraph preserves useful article facts after Readability fails or rejects the page layout.",
      "A third paragraph makes the article long enough to summarize without relying on navigation text."
    ]
  });
  const result = await runArticleExtractor(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.contentType, "article");
  assert.equal(result.contentMeta.source, "semantic-dom");
  assert.match(result.content, /semantic DOM extraction works/);
  assert.doesNotMatch(result.content, /Subscribe to continue reading/);
  assert.equal(result.siteName, "Publisher Test");
}

async function testArticlePreviewPaywallMessage() {
  const fixture = createArticleFixture({
    url: "https://paywall.test/story",
    isProbablyReaderable: () => false,
    readabilityResult: null,
    articleText: [
      "Short preview paragraph for a paid article.",
      "Another teaser paragraph is visible, but the full story is not exposed."
    ],
    paywallText: "Subscribe to continue reading. Already a subscriber? Sign in."
  });
  const result = await runArticleExtractor(fixture);

  assert.equal(result.ok, false);
  assert.match(result.error, /Sign in or create the required access/);
  assert.match(result.error, /content available in your browser session/);
}

async function testArticleRegistrationWallMessage() {
  const fixture = createArticleFixture({
    url: "https://publisher.test/registration-wall",
    isProbablyReaderable: () => true,
    readabilityResult: {
      title: "Registration wall article",
      byline: "Fixture Author",
      siteName: "Publisher Test",
      excerpt: "Preview text",
      textContent: "Preview text about the story, plus a few additional details exposed before registration."
    },
    articleText: [
      "Registration wall article",
      "Preview text about the story, plus a few additional details exposed before registration."
    ],
    bodyText: "Two ways to read this article: Create an account Free Access this article Start reading Subscribe Unlimited access"
  });
  const result = await runArticleExtractor(fixture);

  assert.equal(result.ok, false);
  assert.match(result.error, /registration wall/);
  assert.match(result.error, /Sign in or create the required access/);
}


function createYouTubeFixture({
  panelVisible,
  panelMode = "segments",
  panelInnerText,
  panelTargetId,
  playerResponse,
  fetch,
  hiddenEmptyPanelBeforeTranscript = false
}) {
  const segments = [
    createSegment("0:01", "First line"),
    createSegment("0:04", "Second line")
  ];
  const modernSegments = [
    createModernSegment("0:00 First modern line"),
    createModernSegment("0:09 9 seconds Second modern line"),
    createModernSegment("1:05 1 minute, 5 seconds Third modern line")
  ];

  const panel = createElement({
    attrs: {
      "target-id": panelTargetId ?? "engagement-panel-searchable-transcript",
      visibility: panelVisible ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
    },
    innerText: panelInnerText || [
      "Transcript",
      "Search transcript",
      "0:01",
      "First visible line",
      "0:08 Second visible line"
    ].join("\n"),
    querySelectorAll(selector) {
      if (panelMode === "visibleText" || panelMode === "empty") {
        return [];
      }

      if (panelMode === "modernSegments" && selector.includes("transcript-segment-view-model")) {
        return modernSegments;
      }

      if (selector.includes("ytd-transcript-segment-renderer") && panel.attrs.visibility !== "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN") {
        return segments;
      }
      return [];
    },
    querySelector(selector) {
      if (selector === "#segments-container") {
        return createScrollContainer();
      }
      return null;
    },
    matches(selector) {
      return selector.includes("ytd-engagement-panel-section-list-renderer");
    }
  });

  const hiddenEmptyPanel = createElement({
    attrs: {
      "target-id": "PAmodern_transcript_view",
      visibility: "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
    },
    innerText: "Transcript",
    textContent: "Transcript",
    matches(selector) {
      return selector.includes("ytd-engagement-panel-section-list-renderer");
    }
  });

  const panelCandidates = hiddenEmptyPanelBeforeTranscript
    ? [hiddenEmptyPanel, panel]
    : [panel];

  const button = createElement({
    textContent: "Show transcript",
    click() {
      button.clicked = true;
      panel.attrs.visibility = "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED";
    }
  });
  button.clicked = false;

  const title = createElement({ textContent: "Fixture Video" });
  const channel = createElement({ textContent: "Fixture Channel" });
  const video = { duration: 125 };

  const document = {
    title: "Fixture Video - YouTube",
    scripts: [],
    querySelector(selector) {
      if (selector.includes("engagement-panel-searchable-transcript")) return panel;
      if (selector.includes("ytd-watch-metadata h1")) return title;
      if (selector.includes("ytd-watch-metadata ytd-channel-name")) return channel;
      if (selector === "video") return video;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes("ytd-engagement-panel-section-list-renderer") ||
        selector.includes("ytd-transcript-renderer") ||
        selector.includes("ytd-transcript-search-panel-renderer")) {
        return panelCandidates;
      }

      if (selector.includes("button") || selector.includes("transcript")) {
        return [button];
      }
      return [];
    }
  };

  return {
    button,
    document,
    fetch,
    playerResponse,
    getComputedStyle() {
      return {
        display: "block",
        visibility: "visible"
      };
    }
  };
}

function createArticleFixture({
  url,
  articleText,
  paywallText = "",
  bodyText = "",
  readabilityResult,
  isProbablyReaderable = () => true
}) {
  const paragraphNodes = articleText.map((text) => createArticleElement({
    tagName: text === articleText[0] ? "H1" : "P",
    textContent: text,
    innerText: text
  }));
  const articleRoot = createArticleElement({
    tagName: "ARTICLE",
    attrs: {
      "data-qa": "article-body"
    },
    className: "article-body",
    querySelectorAll(selector) {
      if (selector.includes("p") || selector.includes("h1")) {
        return paragraphNodes;
      }
      return [];
    }
  });
  const paywallNode = createArticleElement({
    tagName: "DIV",
    className: "paywall",
    textContent: paywallText,
    innerText: paywallText
  });
  const meta = {
    "og:site_name": "Publisher Test",
    author: "Fixture Author",
    "article:published_time": "2026-06-28T10:00:00Z"
  };
  const document = {
    title: "Publisher test headline",
    documentElement: {
      lang: "en"
    },
    body: createArticleElement({
      textContent: bodyText || paywallText || articleText.join("\n"),
      innerText: bodyText || paywallText || articleText.join("\n")
    }),
    cloneNode() {
      return {
        querySelectorAll() {
          return [];
        }
      };
    },
    querySelector(selector) {
      const metaMatch = selector.match(/^meta\[(?:property|name)="([^"]+)"\]$/);
      if (metaMatch && meta[metaMatch[1]]) {
        return createArticleElement({
          attrs: {
            content: meta[metaMatch[1]]
          }
        });
      }
      if (selector === "time[datetime]") {
        return createArticleElement({
          attrs: {
            datetime: "2026-06-28T10:00:00Z"
          }
        });
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector.includes("paywall")) {
        return paywallText ? [paywallNode] : [];
      }
      if (selector.includes("article") || selector.includes("article-body") || selector.includes("story-body")) {
        return [articleRoot];
      }
      return [];
    }
  };

  return {
    url,
    document,
    isProbablyReaderable,
    Readability: function Readability() {
      return {
        parse() {
          return readabilityResult;
        }
      };
    },
    getComputedStyle(node) {
      if (node.hidden) {
        return {
          display: "none",
          visibility: "hidden",
          opacity: "0"
        };
      }
      return {
        display: "block",
        visibility: "visible",
        opacity: "1"
      };
    }
  };
}

function createArticleElement(overrides = {}) {
  return createElement({
    tagName: "DIV",
    id: "",
    className: "",
    closest() {
      return null;
    },
    ...overrides
  });
}

function createSegment(timestamp, text) {
  const timestampNode = createElement({ textContent: timestamp });
  const textNode = createElement({ textContent: text });

  return createElement({
    querySelector(selector) {
      if (selector.includes("segment-text") || selector.includes("content-text")) {
        return textNode;
      }
      if (selector.includes("segment-timestamp") || selector.includes("timestamp")) {
        return timestampNode;
      }
      return null;
    }
  });
}

function createModernSegment(text) {
  return createElement({
    textContent: text,
    innerText: text
  });
}

function createScrollContainer() {
  return {
    clientHeight: 500,
    scrollHeight: 500,
    scrollTop: 0
  };
}

function createElement(overrides = {}) {
  const element = {
    attrs: {},
    textContent: "",
    innerText: "",
    click() {},
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    getBoundingClientRect() {
      return {
        width: 100,
        height: 24
      };
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    matches() {
      return false;
    },
    ...overrides
  };

  return element;
}
