import assert from "node:assert/strict";
import {
  chunkContent,
  preprocessArticleContent,
  preprocessYouTubeTranscript
} from "../src/lib/chunker.js";

const longParagraph = "Sentence one. ".repeat(4000);
const chunks = chunkContent(`${longParagraph}\n\n${longParagraph}`, {
  contextWindow: 8000
});

assert.ok(chunks.length > 1, "expected long content to split into multiple chunks");
assert.ok(chunks.every((chunk) => chunk.length > 0));

const deduped = preprocessYouTubeTranscript([
  "[0:01] Hello world",
  "[0:03] Hello world",
  "[0:05] Next point"
].join("\n"));
assert.match(deduped, /Hello world/);
assert.equal(deduped.split("Hello world").length - 1, 1);

const article = preprocessArticleContent("Line one.\n\n\n\nLine two.");
assert.equal(article, "Line one.\n\nLine two.");

console.log("chunker smoke tests passed");
