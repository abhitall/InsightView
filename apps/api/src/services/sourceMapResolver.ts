import type { TenantContext } from "@insightview/core";
import { findSourceMap } from "@insightview/db";
import { SourceMapConsumer, type RawSourceMap } from "source-map";

/**
 * Source map resolver. Given an obfuscated stack trace like
 *
 *   at https://cdn.example.com/app.1a2b.js:1:4567
 *
 * looks up the matching stored source map for the frame's URL
 * and rewrites the frame with the original source name + line.
 * Falls back to returning the original stack if no map is found
 * or the lookup fails.
 */

interface Frame {
  raw: string;
  func?: string;
  url?: string;
  line?: number;
  col?: number;
}

export async function deobfuscateStack(
  ctx: TenantContext,
  release: string,
  stack: string,
): Promise<string> {
  const lines = stack.split("\n");
  const resolved: string[] = [];
  const consumerCache = new Map<string, SourceMapConsumer | null>();

  for (const line of lines) {
    const frame = parseFrame(line);
    if (!frame || !frame.url || frame.line === undefined || frame.col === undefined) {
      resolved.push(line);
      continue;
    }
    let consumer = consumerCache.get(frame.url);
    if (consumer === undefined) {
      const row = await findSourceMap(ctx, release, frame.url);
      if (row) {
        try {
          const parsed = JSON.parse(row.content) as RawSourceMap;
          consumer = await new SourceMapConsumer(parsed);
        } catch {
          consumer = null;
        }
      } else {
        consumer = null;
      }
      consumerCache.set(frame.url, consumer);
    }
    if (!consumer) {
      resolved.push(line);
      continue;
    }
    try {
      const pos = consumer.originalPositionFor({
        line: frame.line,
        column: frame.col,
      });
      if (pos && pos.source) {
        const funcName = pos.name ?? frame.func ?? "?";
        resolved.push(`    at ${funcName} (${pos.source}:${pos.line}:${pos.column})`);
      } else {
        resolved.push(line);
      }
    } catch {
      resolved.push(line);
    }
  }

  for (const consumer of consumerCache.values()) {
    try {
      consumer?.destroy();
    } catch {
      /* ignore */
    }
  }

  return resolved.join("\n");
}

function parseFrame(line: string): Frame | null {
  const trimmed = line.trim();
  const withFunc = /^at\s+(?<func>[^(]*)\s*\((?<url>.+?):(?<line>\d+):(?<col>\d+)\)$/.exec(
    trimmed,
  );
  if (withFunc?.groups) {
    return {
      raw: line,
      func: withFunc.groups.func.trim() || undefined,
      url: withFunc.groups.url,
      line: parseInt(withFunc.groups.line, 10),
      col: parseInt(withFunc.groups.col, 10),
    };
  }
  const urlOnly = /^at\s+(?<url>.+?):(?<line>\d+):(?<col>\d+)$/.exec(trimmed);
  if (urlOnly?.groups) {
    return {
      raw: line,
      url: urlOnly.groups.url,
      line: parseInt(urlOnly.groups.line, 10),
      col: parseInt(urlOnly.groups.col, 10),
    };
  }
  return null;
}
