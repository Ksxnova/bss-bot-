import Parser from "rss-parser";
import { readData, writeData } from "./storage.js";

const parser = new Parser();

function tryExtractBeesmasEnd(text) {
  // Attempts to find a phrase like "Beesmas ends May 1 2026"
  const m = text.match(/beesmas\s+ends?\s+(on\s+)?(.{6,40})/i);
  if (!m) return null;

  const guess = m[2]
    .replace(/(\.|!|\)|\]|,).*$/, "") // cut after punctuation
    .trim();

  const parsed = Date.parse(guess);
  if (Number.isNaN(parsed)) return null;

  return new Date(parsed).toISOString();
}

export async function checkFeeds(feeds) {
  const data = readData();
  const postsToSend = [];

  for (const url of feeds) {
    let feed;
    try {
      feed = await parser.parseURL(url);
    } catch {
      continue;
    }

    const latest = feed.items?.[0];
    if (!latest) continue;

    const guid = latest.guid || latest.id || latest.link || latest.title;
    const lastGuid = data.lastGuids[url];

    if (guid && guid !== lastGuid) {
      const text = `${latest.title || ""} ${latest.contentSnippet || ""} ${latest.content || ""}`.trim();

      postsToSend.push({
        source: feed.title || "Feed",
        title: latest.title || "New update",
        link: latest.link || null,
        date: latest.isoDate || latest.pubDate || null,
        text
      });

      data.lastGuids[url] = guid;

      // auto-detect Beesmas end date
      const iso = tryExtractBeesmasEnd(text);
      if (iso) data.beesmasEndISO = iso;
    }
  }

  writeData(data);
  return postsToSend;
}
