import fs from "fs";

const FILE = "./data.json";

function defaultData() {
  return {
    lastGuids: {},
    beesmasEndISO: null,
    summaries: {},
    beesmasMessageId: null,
    quests: {} // 👈 ADD THIS LINE
  };
}

export function readData() {
  if (!fs.existsSync(FILE)) {
    return defaultData();
  }

  try {
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    // Ensure new fields exist even if data.json is old
    return { ...defaultData(), ...data };
  } catch {
    return defaultData();
  }
}

export function writeData(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}
