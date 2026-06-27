import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const popupSource = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const extractorSource = extractFunctionSource(popupSource, "extractYouTubeTranscriptFromPage");

await testVisibleTranscriptPanel();
await testShowTranscriptButtonOpensPanel();
await testVisibleTextTranscriptFallback();

console.log("extractor smoke tests passed");

function extractFunctionSource(source, functionName) {
  const marker = `async function ${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Could not find ${functionName}`);

  const braceStart = source.indexOf("{", start);
  let depth = 0;
  let inString = false;
  let stringQuote = "";
  let escaped = false;

  for (let index = braceStart; index < source.length; index += 1) {
    const char = source[index];

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

async function runExtractor(fixture) {
  const context = {
    console,
    document: fixture.document,
    getComputedStyle: fixture.getComputedStyle,
    setTimeout,
    clearTimeout
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${extractorSource}; globalThis.__extractor = extractYouTubeTranscriptFromPage;`, context);
  return await context.__extractor("en");
}

function createYouTubeFixture({ panelVisible, panelMode = "segments" }) {
  const segments = [
    createSegment("0:01", "First line"),
    createSegment("0:04", "Second line")
  ];

  const panel = createElement({
    attrs: {
      visibility: panelVisible ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
    },
    innerText: [
      "Transcript",
      "Search transcript",
      "0:01",
      "First visible line",
      "0:08 Second visible line"
    ].join("\n"),
    querySelectorAll(selector) {
      if (panelMode === "visibleText") {
        return [];
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
    }
  });

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
      if (selector.includes("button") || selector.includes("transcript")) {
        return [button];
      }
      return [];
    }
  };

  return {
    button,
    document,
    getComputedStyle() {
      return {
        display: "block",
        visibility: "visible"
      };
    }
  };
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
    ...overrides
  };

  return element;
}
