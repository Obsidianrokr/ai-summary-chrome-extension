import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const captureSource = fs.readFileSync(new URL("../src/youtube-timedtext-capture.js", import.meta.url), "utf8");

await testCaptureFetchesInterceptedTimedtextUrl();

console.log("youtube timedtext capture smoke tests passed");

async function testCaptureFetchesInterceptedTimedtextUrl() {
  const runtimeListeners = new Set();
  const fetchCalls = [];
  const button = {
    clicks: 0,
    disabled: false,
    attrs: { "aria-disabled": "false" },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    click() {
      this.clicks += 1;
      if (this.clicks === 1) {
        setTimeout(() => {
          for (const listener of runtimeListeners) {
            listener({
              type: "youtubeTimedtextUrl",
              url: "https://www.youtube.com/api/timedtext?v=fixture12345&lang=en"
            });
          }
        }, 0);
      }
    }
  };
  const context = {
    console,
    document: {
      title: "Timedtext Fixture - YouTube",
      querySelector(selector) {
        if (selector === ".ytp-subtitles-button" || selector === "button.ytp-subtitles-button") {
          return button;
        }
        if (selector === "ytd-watch-metadata h1") {
          return { textContent: "Timedtext Fixture" };
        }
        if (selector === "ytd-watch-metadata ytd-channel-name a") {
          return { textContent: "Fixture Blogger" };
        }
        if (selector === "video") {
          return { duration: 42 };
        }
        return null;
      }
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            runtimeListeners.add(listener);
          },
          removeListener(listener) {
            runtimeListeners.delete(listener);
          }
        }
      }
    },
    async fetch(url) {
      fetchCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        async text() {
          return [
            '<?xml version="1.0" encoding="utf-8" ?>',
            '<transcript>',
            '<text start="0.0" dur="1.0">First intercepted line</text>',
            '<text start="4.2" dur="1.0">Second &amp; decoded line</text>',
            '</transcript>'
          ].join("");
        }
      };
    },
    setTimeout,
    clearTimeout,
    URL
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(`${captureSource}; globalThis.__capture = captureYouTubeTimedtextTranscript;`, context);

  const result = await context.__capture({ preferredLanguage: "en" });

  assert.equal(result.ok, true);
  assert.equal(button.clicks, 2);
  assert.deepEqual(fetchCalls, ["https://www.youtube.com/api/timedtext?v=fixture12345&lang=en"]);
  assert.equal(result.title, "Timedtext Fixture");
  assert.equal(result.channel, "Fixture Blogger");
  assert.equal(result.duration, "0:42");
  assert.equal(result.meta.source, "youtube-player-timedtext");
  assert.equal(result.meta.languageCode, "en");
  assert.match(result.transcript, /\[0:00\] First intercepted line/);
  assert.match(result.transcript, /\[0:04\] Second & decoded line/);
}
