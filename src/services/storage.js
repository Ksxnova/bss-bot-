import fs from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data.json");

export function readData() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { lastGuids: {}, beesmasEndISO: null, summaries: {} };
  }
}

export function writeData(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
