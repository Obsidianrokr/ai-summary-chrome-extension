import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const popupSource = fs.readFileSync(new URL("../popup.js", import.meta.url), "utf8");
const rendererSource = extractRendererSource(popupSource);

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(`${rendererSource}; globalThis.__render = renderRichMarkdown;`, context);

const html = context.__render([
  "**Summary**",
  "",
  "This is **important** and `safe`.",
  "",
  "**Key Points**",
  "- First point",
  "- Second **point**",
  "",
  "Site: example.com | Source: readability | Tokens: 1,234"
].join("\n"));

assert.match(html, /<h2>🧠 Summary<\/h2>/);
assert.match(html, /<strong>important<\/strong>/);
assert.match(html, /<code>safe<\/code>/);
assert.match(html, /<h2>✅ Key Points<\/h2>/);
assert.match(html, /<ul><li>First point<\/li><li>Second <strong>point<\/strong><\/li><\/ul>/);
assert.match(html, /<div class="summary-meta"><span>Site: example\.com<\/span><span>Source: readability<\/span><span>Tokens: 1,234<\/span><\/div>/);
assert.doesNotMatch(html, /\*\*Summary\*\*/);

console.log("renderer smoke tests passed");

function extractRendererSource(source) {
  const startMarker = "function renderRichMarkdown";
  const endMarker = "function buildMetaLine";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  assert.notEqual(start, -1, `Could not find ${startMarker}`);
  assert.notEqual(end, -1, `Could not find ${endMarker}`);
  assert.ok(end > start, "Renderer block end appears before start");

  return source.slice(start, end);
}
