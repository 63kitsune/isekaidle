const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "data.json");
const outPath = path.join(__dirname, "daily.json");

const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (!Array.isArray(raw) || raw.length === 0) {
  throw new Error("data.json has no entries");
}

const pick = raw[Math.floor(Math.random() * raw.length)];
fs.writeFileSync(outPath, JSON.stringify(pick.id));
console.log(`Daily id set to ${pick.id}`);
