const CHARS_PER_TOKEN = 4;

const DEFAULTS = {
  reservedForSystemPrompt: 1200,
  reservedForOutput: 3500,
  reservedForRollingContext: 2500
};

export function estimateTokens(text) {
  return Math.ceil(String(text || "").length / CHARS_PER_TOKEN);
}

export function chunkContent(content, options = {}) {
  const {
    contextWindow = 64000,
    reservedForSystemPrompt = DEFAULTS.reservedForSystemPrompt,
    reservedForOutput = DEFAULTS.reservedForOutput,
    reservedForRollingContext = DEFAULTS.reservedForRollingContext
  } = options;

  const normalized = String(content || "").trim();
  if (!normalized) {
    return [];
  }

  const availableTokens =
    contextWindow - reservedForSystemPrompt - reservedForOutput - reservedForRollingContext;
  const availableChars = Math.max(4000, availableTokens * CHARS_PER_TOKEN);

  if (estimateTokens(normalized) <= availableTokens) {
    return [normalized];
  }

  const paragraphs = normalized.split(/\n\n+/);
  const chunks = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 > availableChars && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }

    if (paragraph.length > availableChars) {
      if (currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }

      const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) || [paragraph];
      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > availableChars && currentChunk.length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
        currentChunk += sentence;
      }
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length ? chunks : [normalized];
}

export function preprocessYouTubeTranscript(transcript) {
  const lines = String(transcript || "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const deduped = [];
  let previousKey = "";

  for (const line of lines) {
    const withoutTimestamp = line.replace(/^\[(?:\d+:)?\d{1,2}:\d{2}\]\s*/, "").trim();
    const key = withoutTimestamp.toLowerCase();
    if (!key || key === previousKey) {
      continue;
    }
    deduped.push(line);
    previousKey = key;
  }

  return deduped.join("\n");
}

export function preprocessArticleContent(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
