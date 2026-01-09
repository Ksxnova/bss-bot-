import OpenAI from "openai";
import { readData, writeData } from "./storage.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// quick and cheap cache so it doesn’t re-summarize same link
function getCacheKey(post) {
  return post.link || `${post.source}:${post.title}`;
}

function stripHtml(html) {
  // very basic HTML -> text (good enough for “summary”)
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "bss-bot/1.0" }
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) return "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return "";
    const html = await res.text();
    const text = stripHtml(html);
    // limit to keep costs down
    return text.slice(0, 12000);
  } catch {
    return "";
  }
}

export async function summarizePost(post) {
  const store = readData();
  store.summaries ??= {};

  const key = getCacheKey(post);
  if (store.summaries[key]) return store.summaries[key];

  const pageText = post.link ? await fetchPageText(post.link) : "";
  const content = pageText || post.text || "";

  const prompt = [
    `Source: ${post.source}`,
    `Title: ${post.title}`,
    `Link: ${post.link || "none"}`,
    "",
    "Summarize this update for a Discord server.",
    "Rules:",
    "- DO NOT quote long text. No copy/paste release notes.",
    "- Keep it short and useful.",
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

  let summaryText = "WHATS_NEW:\n- (Couldn’t read the page text — open the link)\n\nMOST_IMPORTANT:\n- (No summary available)\n\nNOTES:\n- (Try again later)";

  try {
    const r = await openai.responses.create({
      model: "gpt-4o-mini",
      input: prompt
    });

    summaryText = (r.output_text || "").trim() || summaryText;
  } catch {
    // keep fallback text
  }

  store.summaries[key] = summaryText;
  writeData(store);
  return summaryText;
}
