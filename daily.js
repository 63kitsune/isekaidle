const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "data.json");
const outPath = path.join(__dirname, "daily.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (!Array.isArray(raw) || raw.length === 0) {
  throw new Error("data.json has no entries");
}

const DEFAULT_HIDE_UNRELEASED = true;
const DEFAULT_FINISHED_ONLY = true;
const DEFAULT_MIN_MEMBERS = 50000;

const normalizeStatus = (value) => (value ? String(value).toLowerCase() : "");

const filtered = raw.filter((entry) => {
  if ((entry.members || 0) < DEFAULT_MIN_MEMBERS) return false;
  if (DEFAULT_HIDE_UNRELEASED || DEFAULT_FINISHED_ONLY) {
    const status = normalizeStatus(entry.status);
    const isFinished = status.startsWith("finished");
    const isAiring = status.includes("airing");
    if (DEFAULT_FINISHED_ONLY) return isFinished;
    return isFinished || isAiring;
  }
  return true;
});

if (!filtered.length) {
  throw new Error("No entries match default filters");
}

const pick = filtered[Math.floor(Math.random() * filtered.length)];
fs.writeFileSync(outPath, JSON.stringify(pick.id));
console.log(`Daily id set to ${pick.id}`);
