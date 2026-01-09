export const CONFIG = {
  // fallback if you haven't set a stored date yet:
  beesmasEndISO: "2026-01-31T23:59:00Z",

  // Add feeds here (RSS is the cleanest way to auto-post)
 feeds: [
  "https://bee-swarm-simulator.fandom.com/wiki/Special:RecentChanges?feed=rss",
  "https://bee-swarm-simulator.fandom.com/wiki/Updates?action=history&feed=rss",
  "https://github.com/nosyliam/revolution-macro/releases.atom"
],

  pollMinutes: 5,

  // prefix command
  prefix: "!",

  // OpenAI model (change if you want)
  openaiModel: "gpt-4o-mini"
};
