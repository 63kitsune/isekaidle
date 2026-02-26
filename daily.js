const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "data.json");
const configPath = path.join(__dirname, "config.json");
const outPath = path.join(__dirname, "daily.json");

const dataPayload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const configPayload = JSON.parse(fs.readFileSync(configPath, "utf8"));
const raw = Array.isArray(dataPayload)
  ? dataPayload
  : Array.isArray(dataPayload && dataPayload.entries)
    ? dataPayload.entries
    : [];
if (!Array.isArray(raw) || raw.length === 0) {
  throw new Error("data.json has no entries");
}

const DEFAULT_HIDE_UNRELEASED = true;
const DEFAULT_FINISHED_ONLY = true;
const DEFAULT_MIN_MEMBERS = 100000;
const DEFAULT_RELATED_MODE = Number.isFinite(Number(configPayload && configPayload.relatedMode))
  ? Number(configPayload.relatedMode)
  : 3;

const hasMembers = raw.some((entry) => Number.isFinite(Number(entry.members)));
const hasStatus = raw.some((entry) => entry && entry.status);
const minMembers = hasMembers ? DEFAULT_MIN_MEMBERS : 0;
const hideUnreleased = hasStatus ? DEFAULT_HIDE_UNRELEASED : false;
const finishedOnly = hasStatus ? DEFAULT_FINISHED_ONLY : false;

const normalizeStatus = (value) => (value ? String(value).toLowerCase() : "");

const filtered = raw.filter((entry) => {
  if ((entry.members || 0) < minMembers) return false;
  if (hideUnreleased || finishedOnly) {
    const status = normalizeStatus(entry.status);
    const isFinished = status.startsWith("finished");
    const isAiring = status.includes("airing");
    if (finishedOnly) return isFinished;
    return isFinished || isAiring;
  }
  return true;
});

if (!filtered.length) {
  throw new Error("No entries match default filters");
}

let previousId = null;
if (fs.existsSync(outPath)) {
  try {
    const rawPrevious = fs.readFileSync(outPath, "utf8");
    previousId = JSON.parse(rawPrevious);
  } catch (error) {
    previousId = null;
  }
}

let candidates = filtered;
if (DEFAULT_RELATED_MODE === 1) {
  const grouped = new Map();
  filtered.forEach((entry) => {
    const groupId = entry.related && entry.related.group_id ? entry.related.group_id : entry.id;
    if (!grouped.has(groupId)) grouped.set(groupId, entry);
  });
  candidates = Array.from(grouped.values());
}

if (previousId !== null && candidates.length > 1) {
  candidates = candidates.filter((entry) => entry.id !== previousId);
  if (!candidates.length) {
    candidates = DEFAULT_RELATED_MODE === 1
      ? Array.from(new Map(filtered.map((entry) => [
        entry.related && entry.related.group_id ? entry.related.group_id : entry.id,
        entry
      ])).values())
      : filtered;
  }
}

const pick = candidates[Math.floor(Math.random() * candidates.length)];
const dailyId = DEFAULT_RELATED_MODE === 1 && pick.related && pick.related.group_id
  ? pick.related.group_id
  : pick.id;
fs.writeFileSync(outPath, JSON.stringify(dailyId));
console.log(`Daily id set to ${dailyId}`);
