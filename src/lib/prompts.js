export const YOUTUBE_SYSTEM_PROMPT = [
  "You summarize YouTube video transcripts for a viewer who wants the useful content quickly.",
  "Return concise Markdown with emoji section headings:",
  "## 🧠 Summary",
  "## ⏱️ Key Moments (include [MM:SS] or [H:MM:SS] timestamps from the transcript for each item)",
  "## ✅ Key Points",
  "## 💡 Notable Details",
  "## 🎯 Bottom Line",
  "Use short paragraphs, bullet lists, and bold text for important names, numbers, decisions, warnings, and recommendations.",
  "For Key Moments, pick 4-8 sections that best represent the video structure and anchor each bullet to a real timestamp from the transcript.",
  "Keep the tone clear and useful. Avoid inventing details that are not supported by the transcript.",
  "If the transcript is mostly music, silence, or unavailable, say that clearly."
].join(" ");

export const ARTICLE_SYSTEM_PROMPT = [
  "You summarize web articles for a reader who wants the useful content quickly.",
  "Return concise Markdown with emoji section headings:",
  "## 🧠 Summary",
  "## ✅ Key Points",
  "## 💬 Notable Quotes (only if the article contains quotable lines; otherwise omit this section)",
  "## 🔍 Implications",
  "## 🎯 Bottom Line",
  "Use short paragraphs, bullet lists, and bold text for important names, numbers, claims, and recommendations.",
  "Separate facts from the author's opinion when the article mixes both.",
  "Keep the tone clear and useful. Avoid inventing details that are not supported by the article.",
  "If the page content is too thin, navigation-only, or not a real article, say that clearly."
].join(" ");

export const INTERMEDIATE_CHUNK_PROMPT = [
  "You are processing one section of a longer source document.",
  "Extract and preserve the most important facts, claims, numbers, names, examples, warnings, and conclusions from this section only.",
  "If timestamps appear in the source, keep them exactly as written.",
  "Do not write a polished final summary yet.",
  "Return compact Markdown bullet notes that a later step can merge into one summary."
].join(" ");

export const ROLLING_CONTEXT_PROMPT = [
  "You already have notes from earlier sections:",
  "",
  "{rollingSummary}",
  "",
  "Now read the next section and extend those notes.",
  "Merge new facts into the running notes without repeating earlier bullets unless needed for clarity."
].join("\n");

export const FINAL_CHUNK_PROMPT = [
  "This is the final section of the source.",
  "Using all accumulated notes plus this section, produce the final polished summary using the required section headings from the system prompt."
].join(" ");

export function getSystemPrompt(contentType) {
  return contentType === "article" ? ARTICLE_SYSTEM_PROMPT : YOUTUBE_SYSTEM_PROMPT;
}

export function getRollingContextPrompt(rollingSummary) {
  return ROLLING_CONTEXT_PROMPT.replace("{rollingSummary}", rollingSummary);
}

export function buildUserPrompt({
  contentType,
  metadata,
  content,
  chunkIndex,
  totalChunks,
  rollingSummary,
  isFinalChunk
}) {
  const header = buildMetadataBlock(contentType, metadata);
  const chunkLabel =
    totalChunks > 1 ? `\n\nSource section ${chunkIndex + 1} of ${totalChunks}:` : "";

  if (chunkIndex === 0) {
    return `${header}${chunkLabel}\n\n${content}`;
  }

  let prompt = getRollingContextPrompt(rollingSummary);
  if (isFinalChunk) {
    prompt += `\n\n${FINAL_CHUNK_PROMPT}`;
  }
  prompt += `${chunkLabel}\n\n${content}`;
  return prompt;
}

function buildMetadataBlock(contentType, metadata = {}) {
  if (contentType === "article") {
    return [
      `URL: ${metadata.url || "Unknown URL"}`,
      `Title: ${metadata.title || "Untitled page"}`,
      metadata.siteName ? `Site: ${metadata.siteName}` : "",
      metadata.author ? `Author: ${metadata.author}` : "",
      metadata.publishDate ? `Published: ${metadata.publishDate}` : "",
      metadata.excerpt ? `Excerpt: ${metadata.excerpt}` : "",
      metadata.wordCount ? `Word count: ${metadata.wordCount}` : "",
      "",
      "Article text:"
    ].filter(Boolean).join("\n");
  }

  return [
    `Video ID: ${metadata.videoId || "Unknown"}`,
    `Title: ${metadata.title || "Untitled video"}`,
    metadata.channel ? `Channel: ${metadata.channel}` : "",
    metadata.duration ? `Duration: ${metadata.duration}` : "",
    metadata.captionLabel
      ? `Caption track: ${metadata.captionLabel} (${metadata.languageCode || "unknown"})`
      : "",
    "",
    "Transcript:"
  ].filter(Boolean).join("\n");
}
