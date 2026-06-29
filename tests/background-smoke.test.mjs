import assert from "node:assert/strict";

let messageListener = null;
const fetchCalls = [];
let deepSeekRequest = null;

globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      }
    }
  },
  storage: {
    local: {
      get(defaults, callback) {
        callback({
          ...defaults,
          apiKey: "test-api-key",
          preferredCaptionLanguage: "en"
        });
      }
    }
  }
};

globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  fetchCalls.push(requestUrl);

  if (requestUrl.includes("youtube.com/watch")) {
    return okResponse([
      "<script>",
      `var ytInitialPlayerResponse = ${JSON.stringify({
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
          title: "Fetched video title",
          author: "Fetched channel",
          lengthSeconds: "125"
        }
      })};`,
      "</script>"
    ].join(""));
  }

  if (requestUrl.includes("example.test/captions")) {
    return okResponse(JSON.stringify({
      events: [
        { tStartMs: 1000, segs: [{ utf8: "Background transcript line" }] }
      ]
    }));
  }

  if (requestUrl.includes("api.deepseek.com/chat/completions")) {
    deepSeekRequest = JSON.parse(options.body);
    return okResponse(JSON.stringify({
      choices: [
        {
          message: {
            content: "Summary from mocked DeepSeek"
          }
        }
      ],
      usage: {
        total_tokens: 123
      }
    }));
  }

  throw new Error(`Unexpected fetch: ${requestUrl}`);
};

await import(new URL(`../src/background.js?cache=${Date.now()}`, import.meta.url));

assert.equal(typeof messageListener, "function", "background listener should be registered");

const response = await sendMessage({
  type: "summarizeVideo",
  payload: {
    videoId: "abc12345678",
    title: "Title from active page"
  }
});

assert.equal(response.ok, true);
assert.equal(response.result.summary, "Summary from mocked DeepSeek");
assert.equal(response.result.contentMeta.captionLabel, "English (auto-generated)");
assert.equal(response.result.contentMeta.source, "youtube");
assert.match(fetchCalls.find((url) => url.includes("youtube.com/watch")) || "", /v=abc12345678/);
assert.match(fetchCalls.find((url) => url.includes("example.test/captions")) || "", /fmt=json3/);
assert.match(deepSeekRequest.messages[1].content, /Background transcript line/);

console.log("background smoke tests passed");

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    const keepAlive = messageListener(message, {}, resolve);
    if (keepAlive !== true) {
      reject(new Error("background listener did not keep the message channel open"));
    }
  });
}

function okResponse(text) {
  return {
    ok: true,
    status: 200,
    async text() {
      return text;
    }
  };
}
