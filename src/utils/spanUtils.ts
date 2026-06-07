import type { ColourSpan, Chunk, LineColor } from '../types';

/**
 * Apply a new span to existing spans, splitting/trimming overlaps.
 * Result is sorted by start, no overlaps.
 */
export function applySpan(spans: ColourSpan[], newSpan: ColourSpan): ColourSpan[] {
  const result: ColourSpan[] = [];

  for (const span of spans) {
    // No overlap: span is entirely before or after new span
    if (span.end <= newSpan.start || span.start >= newSpan.end) {
      result.push(span);
      continue;
    }

    // Partial overlap on the left
    if (span.start < newSpan.start) {
      result.push({ start: span.start, end: newSpan.start, color: span.color });
    }

    // Partial overlap on the right
    if (span.end > newSpan.end) {
      result.push({ start: newSpan.end, end: span.end, color: span.color });
    }
    // Middle part of existing span is consumed by newSpan (dropped)
  }

  result.push(newSpan);
  result.sort((a, b) => a.start - b.start);

  return result;
}

/**
 * Clamp spans to text length, remove invalid spans.
 */
export function clampSpans(spans: ColourSpan[], textLength: number): ColourSpan[] {
  return spans
    .map(span => ({
      ...span,
      start: Math.min(span.start, textLength),
      end: Math.min(span.end, textLength),
    }))
    .filter(span => span.start < span.end);
}

/**
 * Build an array of { text, color } chunks from the text and spans.
 * Gaps between spans get the defaultColor.
 */
export function buildChunks(
  text: string,
  spans: ColourSpan[],
  defaultColor: LineColor
): Chunk[] {
  if (!text) return [];

  const chunks: Chunk[] = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.start > cursor) {
      chunks.push({ text: text.slice(cursor, span.start), color: defaultColor });
    }
    chunks.push({ text: text.slice(span.start, span.end), color: span.color });
    cursor = span.end;
  }

  if (cursor < text.length) {
    chunks.push({ text: text.slice(cursor), color: defaultColor });
  }

  return chunks;
}

/**
 * Split chunks on newline characters into lines.
 * Each line is an array of colored chunks.
 */
export function chunksToLines(chunks: Chunk[]): Chunk[][] {
  const lines: Chunk[][] = [[]];

  for (const chunk of chunks) {
    const parts = chunk.text.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        lines.push([]);
      }
      if (parts[i].length > 0) {
        lines[lines.length - 1].push({ text: parts[i], color: chunk.color });
      }
    }
  }

  return lines;
}
