// src/services/summarize.js
import OpenAI from "openai";
import { readData, writeData } from "./storage.js";

function cleanKey(raw) {
  if (!raw) return "";
  // remove surrounding quotes + trim whitespace/newlines
  return raw.replace(/^["']|["']$/g, "").trim();
}

function keyLooksBad(k) {
  // if it contains whitespace/newlines anywhere, it's bad for headers
  return /[\s\r\n]/.test(k);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "bss-bot/1.0" } });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) return "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return "";
    const html = await res.text();
    const text = stripHtml(html);
    return text.slice(0, 12000);
  } catch {
    return "";
  }
}

export async function summarizePost(post) {
  const store = readData();
  store.summaries ??= {};

  const cacheKey = post.link || `${post.source}:${post.title}`;
  if (store.summaries[cacheKey]) return store.summaries[cacheKey];

  const rawKey = process.env.OPENAI_API_KEY || "";
  const apiKey = cleanKey(rawKey);

  // If key is missing/bad, don't crash — just return a basic fallback
  if (!apiKey || keyLooksBad(apiKey)) {
    const fallback =
      `WHATS_NEW:\n- New post detected: ${post.title}\n\n` +
      `MOST_IMPORTANT:\n- Open the link for details\n\n` +
      `NOTES:\n- (Summaries disabled: OPENAI_API_KEY is missing/invalid)`;
    store.summaries[cacheKey] = fallback;
    writeData(store);
    return fallback;
  }

  const openai = new OpenAI({ apiKey });

  const pageText = post.link ? await fetchPageText(post.link) : "";
  const content = pageText || post.text || "";

  const prompt = [
    `Source: ${post.source}`,
    `Title: ${post.title}`,
    `Link: ${post.link || "none"}`,
    "",
    "Summarize this update for a Discord server.",
    "Rules:",
    "- No long quotes.",
    "- Short, useful bullet points.",
    "- Output EXACTLY this format:",
    "",
    "WHATS_NEW:",
    "- ...",
    "- ...",
    "",
    "MOST_IMPORTANT:",
    "- ...",
    "",
    "NOTES:",
    "- ... (optional)",
    "",
    "Content:",
    content || "(no page text available)"
  ].join("\n");

  let summaryText =
    "WHATS_NEW:\n- (Couldn’t summarize)\n\nMOST_IMPORTANT:\n- (No summary available)\n\nNOTES:\n- Open the link";

  try {
    const r = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt
    });
    summaryText = (r.output_text || "").trim() || summaryText;
  } catch {
    // keep fallback
  }

  store.summaries[cacheKey] = summaryText;
  writeData(store);
  return summaryText;
}

