const state = {
  config: null,
  rawEntries: [],
  guessPool: [],
  answerPool: [],
  target: null,
  guesses: [],
  guessedIds: new Set(),
  suggestions: [],
  highlightIndex: 0,
  hintState: {},
  hintUi: new Map(),
  gameOver: false,
  resultOutcome: "",
  displayMode: "english",
  dailyId: null,
  guessSkips: 0,
  libraryMode: false,
  libraryWins: new Set(),
  streaks: { current: 0, daily: 0, lastDailyId: null },
  librarySort: { key: "title", dir: "default" },
  boardSort: { key: "title", dir: "default" },
  uiSettings: {
    animations: true,
    showHints: true,
    titleMode: "english",
    animSpeedMs: 450,
    minMembers: 50000,
    fontSize: 12,
    relatedMode: null,
    hideUnreleased: true,
    finishedOnly: true
  },
  entryById: new Map(),
};

const dom = {
  input: null,
  clearBtn: null,
  guessBtn: null,
  suggestions: null,
  boardHeader: null,
  boardBody: null,
  searchPanel: null,
  board: null,
  library: null,
  libraryHeader: null,
  libraryBody: null,
  librarySearch: null,
  libraryBtn: null,
  settingsDailyNote: null,
  guessCount: null,
  totalCount: null,
  status: null,
  hints: null,
  hintSkip: null,
  result: null,
  streakLabel: null,
  streakCount: null,
  settingAnimations: null,
  settingHints: null,
  settingHideUnreleased: null,
  settingFinishedOnly: null,
  settingTitle: null,
  settingRelatedMode: null,
  settingAnimSpeed: null,
  settingAnimSpeedValue: null,
  settingMinMembers: null,
  settingFontSize: null,
  settingFilterCount: null,
  settingsBtn: null,
  settingsModal: null,
  settingsClose: null,
  rulesBtn: null,
  rulesModal: null,
  rulesClose: null,
  rulesBody: null,
  dailyBtn: null,
  newRoundBtn: null,
  preview: null,
};

const SETTINGS_KEY = "isekai-guess-ui";
const DAILY_PROGRESS_KEY = "isekai-daily-progress";
const LIBRARY_WINS_KEY = "isekai-library-wins";
const STREAK_KEY = "isekai-streaks";

const seasonPattern = /(\bseason\s*1\b|\b1st\s*season\b|\bfirst\s*season\b|\bs1\b|\bseason\s*one\b|\bpart\s*1\b)/i;

const normalizeSearch = (value) => {
  if (!value) return "";
  return value
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
};

const looksLikeSeasonOne = (value) => seasonPattern.test(value || "");

const stripSeasonOne = (value) => {
  if (!value) return value;
  return value.replace(seasonPattern, "").replace(/[:\-\s]+$/g, "").trim();
};

const pickDisplayTitle = (entry, mode) => {
  if (!entry || !entry.titles) return "";
  const active = (mode || "english").toLowerCase();
  if (active === "japanese") {
    return entry.titles.japanese || entry.titles.main || entry.titles.english || "";
  }
  return entry.titles.english || entry.titles.main || entry.titles.japanese || "";
};

const pickGroupTitle = (canonical, allTitles, mode) => {
  let title = pickDisplayTitle(canonical, mode);
  if (looksLikeSeasonOne(title)) {
    const replacement = allTitles.find((candidate) => !looksLikeSeasonOne(candidate));
    if (replacement) {
      title = replacement;
    } else {
      title = stripSeasonOne(title);
    }
  }
  return title || canonical.titles.main || "";
};

const fuzzyScore = (query, candidate) => {
  if (!query || !candidate) return Infinity;
  if (query === candidate) return 0;
  if (candidate.startsWith(query)) return 1;
  const idx = candidate.indexOf(query);
  if (idx !== -1) return 2 + idx;

  let qi = 0;
  let penalty = 0;
  for (let i = 0; i < candidate.length; i += 1) {
    if (candidate[i] === query[qi]) {
      qi += 1;
      if (qi >= query.length) break;
    } else {
      penalty += 1;
    }
  }
  if (qi >= query.length) return 5 + penalty;
  return Infinity;
};

const uniqueList = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const cleaned = item ? item.toString().trim() : "";
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
};

const computeGridTemplate = () => {
  const titleWeight = Number(state.config && state.config.titleWeight) || 1.2;
  const weights = [
    titleWeight,
    ...state.config.categories.map((category) => Number(category.width) || 1)
  ];
  return weights.map((weight) => `minmax(0, ${weight}fr)`).join(" ");
};

const applyRowAnimationTiming = (row) => {
  if (!row) return;
  const totalCols = state.config.categories.length + 1;
  const totalMs = Math.max(0, Number(state.uiSettings.animSpeedMs || 0));
  if (totalMs === 0 || totalCols <= 1) {
    row.style.setProperty("--anim-duration", "0ms");
    row.style.setProperty("--anim-stagger", "0ms");
    return;
  }
  const base = totalMs / (1 + 0.5 * (totalCols - 1));
  const stagger = base * 0.5;
  row.style.setProperty("--anim-duration", `${base}ms`);
  row.style.setProperty("--anim-stagger", `${stagger}ms`);
};

const normalizeStatus = (value) => (value ? String(value).toLowerCase() : "");

const formatRangeValue = (value, isDecimal) => {
  if (!Number.isFinite(value)) return "";
  if (isDecimal) return value.toFixed(2);
  return Math.round(value).toLocaleString();
};

const buildRulesContent = () => {
  if (!dom.rulesBody || !state.config) return;
  dom.rulesBody.innerHTML = "";

  const basicSection = document.createElement("div");
  const basicTitle = document.createElement("div");
  basicTitle.className = "rules-section-title";
  basicTitle.textContent = "Basics";
  const basicList = document.createElement("div");
  basicList.className = "rules-list";
  [
    "Guess the isekai. Each guess compares against the hidden title.",
    "Match categories to find the exact show.",
    "Number categories hint higher/lower; text matches need exact hits."
  ].forEach((text) => {
    const item = document.createElement("div");
    item.textContent = text;
    basicList.appendChild(item);
  });
  basicSection.appendChild(basicTitle);
  basicSection.appendChild(basicList);

  const categoriesSection = document.createElement("div");
  const categoriesTitle = document.createElement("div");
  categoriesTitle.className = "rules-section-title";
  categoriesTitle.textContent = "Categories";
  categoriesSection.appendChild(categoriesTitle);

  const entries = state.rawEntries || [];
  const categories = (state.config && state.config.categories) || [];
  const previewCount = 6;
  categories.forEach((category) => {
    const values = [];
    entries.forEach((entry) => {
      if (!entry.categories) return;
      const raw = entry.categories[category.key];
      if (raw === null || raw === undefined) return;
      if (category.type === "list") {
        if (Array.isArray(raw)) {
          raw.forEach((item) => values.push(item));
        } else {
          values.push(raw);
        }
      } else {
        values.push(raw);
      }
    });

    const row = document.createElement("div");
    row.className = "rules-category";

    const header = document.createElement("button");
    header.type = "button";
    header.className = "rules-category-header";
    header.setAttribute("aria-expanded", "false");

    const label = document.createElement("div");
    label.className = "rules-label";
    label.textContent = category.label;

    const meta = document.createElement("div");
    meta.className = "rules-category-meta";

    const contentWrap = document.createElement("div");
    contentWrap.className = "rules-category-content";

    const content = document.createElement("div");
    content.className = "rules-values";
    let expandable = true;

    if (category.type === "number") {
      const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
      if (numbers.length) {
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        const isDecimal = numbers.some((value) => value % 1 !== 0);
        content.classList.add("range");
        const rangeText = `${formatRangeValue(min, isDecimal)} - ${formatRangeValue(max, isDecimal)}`;
        content.textContent = rangeText;
        meta.textContent = rangeText;
        expandable = false;
      } else {
        content.classList.add("rules-empty");
        content.textContent = "No data";
        meta.textContent = "Empty";
        expandable = false;
      }
    } else {
      const unique = uniqueList(values);
      if (!unique.length) {
        content.classList.add("rules-empty");
        content.textContent = "No data";
        meta.textContent = "Empty";
        expandable = false;
      } else {
        unique.sort((a, b) => a.localeCompare(b));
        const preview = unique.slice(0, previewCount).join(", ");
        meta.textContent = unique.length > previewCount ? `${preview}, ...` : preview;
        if (unique.length <= previewCount) {
          expandable = false;
        }
        unique.forEach((value) => {
          const chip = document.createElement("span");
          chip.className = "rules-chip";
          chip.textContent = value;
          content.appendChild(chip);
        });
      }
    }

    header.appendChild(label);
    header.appendChild(meta);
    contentWrap.appendChild(content);

    if (expandable) {
      header.addEventListener("click", () => {
        const isOpen = row.classList.toggle("open");
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
    } else {
      row.classList.add("not-expandable");
      header.setAttribute("aria-expanded", "true");
    }

    row.appendChild(header);
    row.appendChild(contentWrap);
    categoriesSection.appendChild(row);
  });

  dom.rulesBody.appendChild(basicSection);
  dom.rulesBody.appendChild(categoriesSection);
};

const getFilteredEntries = (forceFilters = false) => {
  if (!forceFilters && state.uiSettings.dailyMode) return state.rawEntries;
  const minMembers = Number(state.uiSettings.minMembers || 0);
  const hideUnreleased = !!state.uiSettings.hideUnreleased;
  const finishedOnly = !!state.uiSettings.finishedOnly;
  return state.rawEntries.filter((entry) => {
    if (Number.isFinite(minMembers) && minMembers > 0 && (entry.members || 0) < minMembers) {
      return false;
    }
    if (hideUnreleased || finishedOnly) {
      const status = normalizeStatus(entry.status);
      const isFinished = status.startsWith("finished");
      const isAiring = status.includes("airing");
      if (finishedOnly) return isFinished;
      return isFinished || isAiring;
    }
    return true;
  });
};

const updateAvailableCount = () => {
  if (!dom.settingFilterCount) return;
  const available = getFilteredEntries(true).length;
  dom.settingFilterCount.textContent = `(${available})`;
};

const buildPools = () => {
  const mode = getRelatedMode();
  const poolEntries = getFilteredEntries();
  const byGroup = new Map();

  for (const entry of poolEntries) {
    const groupId = entry.related && entry.related.group_id ? entry.related.group_id : entry.id;
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(entry);
  }

  if (mode === 1) {
    const groups = [];
    for (const [groupId, members] of byGroup.entries()) {
      const sorted = members.slice().sort((a, b) => {
        const yearA = a.categories.year || 9999;
        const yearB = b.categories.year || 9999;
        if (yearA !== yearB) return yearA - yearB;
        return Number(a.id) - Number(b.id);
      });
      const canonical = sorted[0];
      const allTitles = uniqueList(members.flatMap((member) => member.search_titles || []));
      const displayTitle = pickGroupTitle(canonical, allTitles, state.displayMode);

      groups.push({
        id: groupId,
        canonical,
        members,
        titles: canonical.titles,
        displayTitle,
        poster: canonical.poster,
        url: canonical.url,
        synopsis: canonical.synopsis,
        type: canonical.type,
        categories: canonical.categories,
        search_titles: allTitles,
        related: { group_id: groupId, all_ids: canonical.related ? canonical.related.all_ids : [] }
      });
    }
    state.guessPool = groups;
    state.answerPool = groups;
  } else {
    state.guessPool = poolEntries.map((entry) => ({
      ...entry,
      displayTitle: pickDisplayTitle(entry, state.displayMode),
      search_titles: uniqueList(entry.search_titles || [])
    }));
    state.answerPool = state.guessPool;
  }

  state.entryById = new Map(state.answerPool.map((entry) => [entry.id, entry]));
  updateAvailableCount();
};

const buildSearchIndex = () => {
  for (const entry of state.guessPool) {
    const titles = uniqueList([
      entry.displayTitle || "",
      ...(entry.search_titles || [])
    ]);
    entry._searchIndex = titles.map(normalizeSearch).filter(Boolean);
  }
};

const pickTarget = () => {
  const pool = state.answerPool;
  if (!pool.length) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
};

const getSortState = (mode) => (mode === "library" ? state.librarySort : state.boardSort);

const isSortableCategory = (category) => {
  if (!category) return false;
  if (category.type === "list") return false;
  return true;
};

const setSortState = (mode, next) => {
  if (mode === "library") {
    state.librarySort = next;
  } else {
    state.boardSort = next;
  }
};

const toggleSort = (mode, key) => {
  const current = getSortState(mode);
  let next = { ...current };
  if (mode === "game") {
    if (current.key !== key || current.dir === "default") {
      next = { key, dir: "desc" };
    } else {
      next = { key, dir: "default" };
    }
  } else {
    if (current.key !== key) {
      next = { key, dir: "desc" };
    } else if (current.dir === "desc") {
      next = { key, dir: "asc" };
    } else if (current.dir === "asc") {
      next = { key, dir: "default" };
    } else {
      next = { key, dir: "desc" };
    }
  }
  setSortState(mode, next);
  renderHeader(mode === "library" ? dom.libraryHeader : dom.boardHeader, mode);
  if (mode === "library") {
    renderLibraryList();
  } else {
    renderGuessBoard();
  }
};

const renderHeader = (target = dom.boardHeader, mode = "game") => {
  if (!target) return;
  target.innerHTML = "";
  const row = document.createElement("div");
  row.className = "board-row header";
  row.style.setProperty("--col-count", state.config.categories.length);
  row.style.setProperty("--total-cols", state.config.categories.length + 1);
  row.style.gridTemplateColumns = computeGridTemplate();
  applyRowAnimationTiming(row);

  const sortState = getSortState(mode);

  const makeHeaderCell = (label, key, sortable = true) => {
    const cell = document.createElement("div");
    cell.className = "cell header-cell" + (sortable ? " sortable" : "");
    cell.textContent = label;
    cell.dataset.key = key;
    if (sortable) {
      if (sortState.key === key) {
        cell.dataset.sort = sortState.dir;
      } else {
        cell.dataset.sort = "default";
      }
      cell.addEventListener("click", () => toggleSort(mode, key));
    }
    return cell;
  };

  row.appendChild(makeHeaderCell("Title", "title", true));

  for (const category of state.config.categories) {
    const sortable = isSortableCategory(category);
    row.appendChild(makeHeaderCell(category.label, category.key, sortable));
  }

  target.appendChild(row);
};

const formatValue = (value, type) => {
  if (value === null || value === undefined || value === "") return "-";
  if (type === "number") {
    if (!Number.isFinite(value)) return "-";
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(2);
  }
  if (Array.isArray(value)) {
    return value.length ? value : ["-"];
  }
  return value;
};

const buildSimilarityMap = () => {
  const similarity = {};
  const groups = state.config.similarityGroups || {};
  for (const [key, groupList] of Object.entries(groups)) {
    similarity[key] = groupList.map((group) =>
      group.map((item) => normalizeSearch(item))
    );
  }
  return similarity;
};

const similarityMap = () => state._similarityMap || (state._similarityMap = buildSimilarityMap());

const isSimilarText = (categoryKey, value, targetValue) => {
  if (!value || !targetValue) return false;
  const normalizedValue = normalizeSearch(value);
  const normalizedTarget = normalizeSearch(targetValue);
  if (!normalizedValue || !normalizedTarget) return false;

  const groups = similarityMap()[categoryKey] || [];
  for (const group of groups) {
    if (group.includes(normalizedValue) && group.includes(normalizedTarget)) return true;
  }
  return false;
};

const compareNumeric = (category, guessValue, targetValue) => {
  if (guessValue === null || guessValue === undefined || targetValue === null || targetValue === undefined) {
    return { status: "miss", arrow: null };
  }
  if (guessValue === targetValue) {
    return { status: "hit", arrow: null };
  }
  const tolerance = state.config.numericSimilarity && state.config.numericSimilarity[category.key];
  const near = tolerance !== undefined && Math.abs(guessValue - targetValue) <= tolerance;
  const arrow = state.config.showArrows ? (guessValue < targetValue ? "up" : "down") : null;
  return { status: near ? "near" : "miss", arrow };
};

const compareText = (category, guessValue, targetValue) => {
  if (!guessValue || !targetValue) return "miss";
  if (normalizeSearch(guessValue) === normalizeSearch(targetValue)) return "hit";
  return isSimilarText(category.key, guessValue, targetValue) ? "near" : "miss";
};

const compareListItem = (category, item, targetList) => {
  const normalizedItem = normalizeSearch(item);
  for (const target of targetList) {
    if (normalizeSearch(target) === normalizedItem) return "hit";
  }
  for (const target of targetList) {
    if (isSimilarText(category.key, item, target)) return "near";
  }
  return "miss";
};

const isCorrectGuess = (entry) => {
  const mode = getRelatedMode();
  if (!entry || !state.target) return false;
  if (mode === 1) return entry.id === state.target.id;
  if (mode === 2) {
    return entry.id === state.target.id ||
      (entry.related && state.target.related && entry.related.group_id === state.target.related.group_id);
  }
  return entry.id === state.target.id;
};

const renderGuessRow = (entry, insertMode = "prepend") => {
  const row = document.createElement("div");
  row.className = "board-row guess";
  row.style.setProperty("--col-count", state.config.categories.length);
  row.style.setProperty("--total-cols", state.config.categories.length + 1);
  row.style.gridTemplateColumns = computeGridTemplate();
  applyRowAnimationTiming(row);
  row.classList.add("animate");
  row.dataset.id = entry.id;
  row.title = "";

  if (entry.url) {
    row.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        window.open(entry.url, "_blank");
      }
    });
  }

  row.addEventListener("mouseenter", (event) => {
    showPreview(entry, event);
  });
  row.addEventListener("mousemove", (event) => {
    movePreview(event);
  });
  row.addEventListener("mouseleave", () => {
    hidePreview();
  });

  const titleCell = document.createElement("div");
  titleCell.className = "cell title-cell";
  titleCell.style.setProperty("--cell-index", 0);

  const poster = document.createElement("img");
  poster.className = "poster";
  poster.alt = entry.displayTitle || "Poster";
  poster.src = entry.poster || "";

  const titleBlock = document.createElement("div");
  titleBlock.className = "title-block";

  const title = document.createElement("div");
  title.className = "title-name";
  title.textContent = entry.displayTitle || entry.titles.main || "Unknown";

  titleBlock.appendChild(title);
  title.title = entry.titles && entry.titles.main ? entry.titles.main : title.textContent;

  titleCell.appendChild(poster);
  titleCell.appendChild(titleBlock);
  if (isCorrectGuess(entry)) {
    titleCell.classList.add("hit");
  }
  row.appendChild(titleCell);

  state.config.categories.forEach((category, index) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.setProperty("--cell-index", index + 1);
    const guessValue = entry.categories[category.key];
    const targetValue = state.target.categories[category.key];

    if (category.type === "list") {
      cell.classList.add("list-cell");
      const list = Array.isArray(guessValue) ? guessValue : [];
      if (!list.length) {
        cell.textContent = "-";
        cell.classList.add("miss");
      } else {
        const listWrap = document.createElement("div");
        listWrap.className = "pill-wrap";
        const targetList = Array.isArray(targetValue) ? targetValue : [];
        const normalizedTargetCount = targetList.length;
        let hitCount = 0;
        let nearCount = 0;
        for (const item of list) {
          const status = compareListItem(category, item, targetList);
          if (status === "hit") hitCount += 1;
          if (status === "near") nearCount += 1;
          const pill = document.createElement("span");
          pill.className = `pill ${status}`;
          pill.textContent = item;
          listWrap.appendChild(pill);
        }
        if (hitCount === list.length && hitCount === normalizedTargetCount) {
          cell.classList.add("hit");
        } else if (hitCount > 0 || nearCount > 0) {
          cell.classList.add("near");
        } else {
          cell.classList.add("miss");
        }
        cell.appendChild(listWrap);
      }
    } else if (category.type === "number") {
      const numericGuess = typeof guessValue === "number" ? guessValue : null;
      const numericTarget = typeof targetValue === "number" ? targetValue : null;
      const comparison = compareNumeric(category, numericGuess, numericTarget);
      cell.classList.add(comparison.status);
      if (comparison.arrow) cell.dataset.arrow = comparison.arrow;
      cell.textContent = formatValue(numericGuess, category.type);
    } else {
      const status = compareText(category, guessValue, targetValue);
      cell.classList.add(status);
      cell.textContent = formatValue(guessValue, category.type);
    }

    row.appendChild(cell);
  });

  if (insertMode === "append") {
    dom.boardBody.appendChild(row);
  } else {
    dom.boardBody.prepend(row);
  }
};

const getSortValue = (entry, key) => {
  if (!entry) return "";
  if (key === "title") return entry.displayTitle || entry.titles.main || "";
  const value = entry.categories ? entry.categories[key] : null;
  if (Array.isArray(value)) return value.join(", ");
  return value;
};

const sortEntries = (entries, sortState, defaultOrderFn) => {
  if (!sortState || sortState.dir === "default") {
    return entries.slice().sort(defaultOrderFn);
  }
  const multiplier = sortState.dir === "desc" ? -1 : 1;
  const key = sortState.key;
  return entries.slice().sort((a, b) => {
    const valA = getSortValue(a, key);
    const valB = getSortValue(b, key);
    const numA = Number(valA);
    const numB = Number(valB);
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      if (numA !== numB) return (numA - numB) * multiplier;
    } else {
      const strA = formatDetailValue(valA).toString().toLowerCase();
      const strB = formatDetailValue(valB).toString().toLowerCase();
      if (strA !== strB) return strA.localeCompare(strB) * multiplier;
    }
    return defaultOrderFn(a, b);
  });
};

const renderGuessBoard = () => {
  if (!dom.boardBody) return;
  if (!state.target) {
    dom.boardBody.innerHTML = "";
    return;
  }
  dom.boardBody.innerHTML = "";
  const entries = state.guesses.map((guess, idx) => ({ ...guess, _guessIndex: idx }));
  let sortState = state.boardSort;
  if (sortState.key !== "title") {
    const cat = (state.config.categories || []).find((c) => c.key === sortState.key);
    if (!isSortableCategory(cat)) {
      sortState = { key: "title", dir: "default" };
      state.boardSort = sortState;
    }
  }
  const sorted = sortEntries(
    entries,
    sortState,
    (a, b) => b._guessIndex - a._guessIndex
  );
  sorted.forEach((entry) => renderGuessRow(entry, "append"));
};

const renderLibraryRow = (entry) => {
  const row = document.createElement("div");
  row.className = "board-row library-row";
  row.style.setProperty("--col-count", state.config.categories.length);
  row.style.setProperty("--total-cols", state.config.categories.length + 1);
  row.style.gridTemplateColumns = computeGridTemplate();

  const titleCell = document.createElement("div");
  titleCell.className = "cell title-cell";
  titleCell.style.setProperty("--cell-index", 0);

  const poster = document.createElement("img");
  poster.className = "poster";
  poster.alt = entry.displayTitle || "Poster";
  poster.src = entry.poster || "";

  const titleBlock = document.createElement("div");
  titleBlock.className = "title-block";

  const title = document.createElement("div");
  title.className = "title-name";
  title.textContent = entry.displayTitle || entry.titles.main || "Unknown";

  titleBlock.appendChild(title);
  title.title = entry.titles && entry.titles.main ? entry.titles.main : title.textContent;

  titleCell.appendChild(poster);
  titleCell.appendChild(titleBlock);
  row.appendChild(titleCell);

  state.config.categories.forEach((category, index) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.style.setProperty("--cell-index", index + 1);
    const value = entry.categories ? entry.categories[category.key] : null;
    if (category.type === "list") {
      cell.classList.add("list-cell");
      const list = Array.isArray(value) ? value : [];
      if (!list.length) {
        cell.textContent = "-";
      } else {
        const listWrap = document.createElement("div");
        listWrap.className = "pill-wrap";
        list.forEach((item) => {
          const pill = document.createElement("span");
          pill.className = "pill";
          pill.textContent = item;
          listWrap.appendChild(pill);
        });
        cell.appendChild(listWrap);
      }
    } else {
      const formatted = formatValue(value, category.type);
      cell.textContent = formatDetailValue(formatted);
    }
    row.appendChild(cell);
  });

  dom.libraryBody.appendChild(row);
};

const updateCounts = () => {
  dom.guessCount.textContent = String(getGuessCount());
  const maxGuesses = getMaxGuesses();
  dom.totalCount.textContent = String(Number.isFinite(maxGuesses) ? maxGuesses : state.answerPool.length);
};

const setStatus = (message, tone = "") => {
  dom.status.textContent = message;
  dom.status.dataset.tone = tone;
  dom.status.hidden = !message;
};

const getGuessCount = () => state.guesses.length + (state.guessSkips || 0);

const getRelatedMode = () => {
  const stored = state.uiSettings.relatedMode;
  const base = Number.isFinite(stored) ? stored : Number(state.config && state.config.relatedMode);
  return Number.isFinite(base) && base > 0 ? base : 3;
};

const loadLibraryWins = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(LIBRARY_WINS_KEY));
    if (Array.isArray(stored)) {
      return new Set(stored.map((id) => String(id)));
    }
  } catch (_err) {
    // ignore
  }
  return new Set();
};

const saveLibraryWins = () => {
  try {
    const payload = Array.from(state.libraryWins || []);
    localStorage.setItem(LIBRARY_WINS_KEY, JSON.stringify(payload));
  } catch (_err) {
    // ignore
  }
};

const markWin = (entry) => {
  if (!entry) return;
  const ids = new Set();
  if (Array.isArray(entry.members)) {
    entry.members.forEach((member) => ids.add(String(member.id)));
  } else {
    ids.add(String(entry.id));
  }
  if (entry.related && Array.isArray(entry.related.all_ids)) {
    entry.related.all_ids.forEach((id) => ids.add(String(id)));
  }
  ids.forEach((id) => state.libraryWins.add(id));
  saveLibraryWins();
  if (state.libraryMode) {
    renderLibraryList();
  }
};

const loadStreaks = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(STREAK_KEY));
    if (stored && typeof stored === "object") {
      return {
        current: Number(stored.current) || 0,
        daily: Number(stored.daily) || 0,
        lastDailyId: stored.lastDailyId ? String(stored.lastDailyId) : null
      };
    }
  } catch (_err) {
    // ignore
  }
  return { current: 0, daily: 0, lastDailyId: null };
};

const saveStreaks = () => {
  try {
    localStorage.setItem(STREAK_KEY, JSON.stringify(state.streaks));
  } catch (_err) {
    // ignore
  }
};

const updateStreakDisplay = () => {
  if (!dom.streakLabel || !dom.streakCount) return;
  if (state.uiSettings.dailyMode) {
    dom.streakLabel.textContent = "Daily streak";
    dom.streakCount.textContent = String(state.streaks.daily || 0);
  } else {
    dom.streakLabel.textContent = "Current streak";
    dom.streakCount.textContent = String(state.streaks.current || 0);
  }
};

const registerWin = () => {
  if (state.uiSettings.dailyMode) {
    if (state.dailyId && state.streaks.lastDailyId !== String(state.dailyId)) {
      state.streaks.daily = (state.streaks.daily || 0) + 1;
      state.streaks.lastDailyId = String(state.dailyId);
    }
  } else {
    state.streaks.current = (state.streaks.current || 0) + 1;
  }
  saveStreaks();
  updateStreakDisplay();
};

const registerLoss = () => {
  if (state.uiSettings.dailyMode) {
    state.streaks.daily = 0;
    if (state.dailyId) state.streaks.lastDailyId = String(state.dailyId);
  } else {
    state.streaks.current = 0;
  }
  saveStreaks();
  updateStreakDisplay();
};

const loadDailyProgress = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(DAILY_PROGRESS_KEY));
    if (stored && typeof stored === "object" && stored.id) return stored;
  } catch (_err) {
    // ignore
  }
  return null;
};

const saveDailyProgress = () => {
  if (!state.uiSettings.dailyMode || !state.dailyId) return;
  try {
    const payload = {
      id: state.dailyId,
      guesses: state.guesses.map((guess) => guess.id),
      skipCount: state.guessSkips || 0,
      hintState: state.hintState,
      gameOver: state.gameOver,
      resultOutcome: state.resultOutcome || ""
    };
    localStorage.setItem(DAILY_PROGRESS_KEY, JSON.stringify(payload));
  } catch (_err) {
    // ignore
  }
};

const getEntryById = (id) => {
  if (!id) return null;
  const entry = state.entryById.get(id);
  if (entry) return entry;
  return state.rawEntries.find((item) => item.id === id) || null;
};

const loadUiSettings = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (stored && typeof stored === "object") {
      return {
        animations: stored.animations !== false,
        showHints: stored.showHints !== false,
        hideUnreleased: stored.hideUnreleased !== false,
        finishedOnly: stored.finishedOnly !== false,
        titleMode: stored.titleMode || "english",
        animSpeedMs: typeof stored.animSpeedMs === "number"
          ? stored.animSpeedMs
          : (typeof stored.animSpeed === "number" ? Math.round(stored.animSpeed * 1000) : 450),
        minMembers: typeof stored.minMembers === "number" ? stored.minMembers : 50000,
        fontSize: typeof stored.fontSize === "number" ? stored.fontSize : 12,
        relatedMode: typeof stored.relatedMode === "number" ? stored.relatedMode : null
      };
    }
  } catch (_err) {
    // ignore
  }
  return {
    animations: true,
    showHints: true,
    hideUnreleased: true,
    finishedOnly: true,
    titleMode: "english",
    animSpeedMs: 450,
    minMembers: 50000,
    fontSize: 12,
    dailyMode: false,
    relatedMode: null
  };
};

const saveUiSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.uiSettings));
  } catch (_err) {
    // ignore
  }
};

const applyUiSettings = () => {
  const animMs = Math.max(0, Number(state.uiSettings.animSpeedMs || 0));
  const animationsOn = !!state.uiSettings.animations && animMs > 0;
  document.body.classList.toggle("anim-on", animationsOn);
  document.body.style.setProperty("--cell-font-size", `${state.uiSettings.fontSize || 12}px`);
  if (dom.settingAnimations) dom.settingAnimations.checked = !!state.uiSettings.animations;
  if (dom.settingHints) dom.settingHints.checked = !!state.uiSettings.showHints;
  if (dom.settingHideUnreleased) dom.settingHideUnreleased.checked = !!state.uiSettings.hideUnreleased;
  if (dom.settingFinishedOnly) dom.settingFinishedOnly.checked = !!state.uiSettings.finishedOnly;
  if (dom.settingTitle) dom.settingTitle.value = state.uiSettings.titleMode || state.displayMode;
  if (dom.settingRelatedMode) dom.settingRelatedMode.value = String(getRelatedMode());
  if (dom.settingAnimSpeed) dom.settingAnimSpeed.value = String(animMs);
  if (dom.settingMinMembers) dom.settingMinMembers.value = String(state.uiSettings.minMembers || 0);
  if (dom.settingFontSize) dom.settingFontSize.value = String(state.uiSettings.fontSize || 12);
  document.querySelectorAll(".board-row").forEach((row) => applyRowAnimationTiming(row));
  updateAvailableCount();
  renderHints();
  if (dom.dailyBtn) dom.dailyBtn.classList.toggle("active", !!state.uiSettings.dailyMode);
  updateStreakDisplay();
  renderLibraryList();
};

const getMaxGuesses = () => {
  const max = Number(state.config && state.config.maxGuesses);
  return Number.isFinite(max) && max > 0 ? max : Infinity;
};

const lockInput = (locked) => {
  dom.input.disabled = locked;
  dom.guessBtn.disabled = locked;
  dom.input.placeholder = locked ? "Game over" : "Search for an anime...";
};

const formatHintValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  return String(value);
};

const getHintValue = (hintKey) => {
  if (!state.target) return "-";
  if (hintKey === "synopsis") return state.target.synopsis || "-";
  if (state.target.categories && hintKey in state.target.categories) {
    return formatHintValue(state.target.categories[hintKey]);
  }
  if (hintKey in state.target) return formatHintValue(state.target[hintKey]);
  return "-";
};

const setupHints = () => {
  dom.hints.innerHTML = "";
  const headerRow = document.createElement("div");
  headerRow.className = "hints-top";

  const header = document.createElement("div");
  header.className = "hints-header";
  header.textContent = "Hints";

  const skipButton = document.createElement("button");
  skipButton.type = "button";
  skipButton.className = "hint-skip";
  skipButton.textContent = "Skip to next hint";
  skipButton.addEventListener("click", () => {
    const hintList = Array.isArray(state.config.hints) ? state.config.hints : [];
    const currentCount = getGuessCount();
    const next = hintList.find((hint) => {
      const unlockAt = hint.unlockAt || 0;
      const hintState = state.hintState[hint.key] || {};
      return !hintState.seen;
    });
    if (!next) return;
    const unlockAt = next.unlockAt || 0;
    if (unlockAt > currentCount) {
      state.guessSkips += unlockAt - currentCount;
    }
    for (const hint of hintList) {
      const hintState = state.hintState[hint.key] || { seen: false, open: false };
      if (hint.key === next.key) {
        hintState.seen = true;
        hintState.open = true;
      } else {
        hintState.open = false;
      }
      state.hintState[hint.key] = hintState;
    }
    saveDailyProgress();
    updateCounts();
    renderHints();
    if (getGuessCount() >= getMaxGuesses() && !state.gameOver) {
      const targetTitle = state.target ? (state.target.displayTitle || state.target.titles.main) : "Unknown";
      setStatus(`Out of guesses. It was ${targetTitle}.`, "bad");
      state.gameOver = true;
      lockInput(true);
      state.resultOutcome = "lose";
      registerLoss();
      if (state.target) renderResult(state.target, "lose");
      saveDailyProgress();
    }
  });

  headerRow.appendChild(header);
  headerRow.appendChild(skipButton);

  const buttonsWrap = document.createElement("div");
  buttonsWrap.className = "hint-buttons";

  dom.hints.appendChild(headerRow);
  dom.hints.appendChild(buttonsWrap);
  dom.hintSkip = skipButton;

  state.hintUi.clear();
  const hintList = Array.isArray(state.config.hints) ? state.config.hints : [];
  dom.hints.style.display = "flex";

  for (const hint of hintList) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hint-button";
    button.textContent = hint.label || hint.key || "Hint";

    const content = document.createElement("div");
    content.className = "hint-content";
    content.dataset.key = hint.key;

    button.addEventListener("click", () => {
      const hintState = state.hintState[hint.key] || { seen: false, open: false };
      if (getGuessCount() < (hint.unlockAt || 0)) return;
      hintState.open = !hintState.open;
      if (hintState.open) hintState.seen = true;
      state.hintState[hint.key] = hintState;
      saveDailyProgress();
      renderHints();
    });

    dom.hints.appendChild(content);
    buttonsWrap.appendChild(button);
    state.hintUi.set(hint.key, { button, content, config: hint });
  }
};

const renderHints = () => {
  const hintList = Array.isArray(state.config.hints) ? state.config.hints : [];
  const guessCount = getGuessCount();
  const shouldShow = state.uiSettings.showHints && hintList.length;
  dom.hints.style.display = shouldShow ? "flex" : "none";
  if (!state.uiSettings.showHints) return;
  if (dom.hintSkip) {
    const hasNext = hintList.some((hint) => !(state.hintState[hint.key] || {}).seen);
    dom.hintSkip.disabled = !hasNext;
  }
  for (const hint of hintList) {
    const ui = state.hintUi.get(hint.key);
    if (!ui) continue;
    const unlockAt = hint.unlockAt || 0;
    const isUnlocked = guessCount >= unlockAt;
    const hintState = state.hintState[hint.key] || { seen: false, open: false };

    ui.button.disabled = !isUnlocked;
    ui.button.classList.toggle("seen", hintState.seen);
    ui.button.textContent = isUnlocked
      ? (hint.label || hint.key || "Hint")
      : `${hint.label || hint.key || "Hint"} (${unlockAt})`;

    ui.content.textContent = getHintValue(hint.key);
    ui.content.classList.toggle("open", hintState.open && isUnlocked);
  }
};

const renderLibraryList = () => {
  if (!dom.libraryBody) return;
  renderHeader(dom.libraryHeader, "library");
  dom.libraryBody.innerHTML = "";
  const query = (dom.librarySearch ? dom.librarySearch.value : "").toLowerCase().trim();
  let sortState = state.librarySort || { key: "title", dir: "default" };
  if (sortState.key !== "title") {
    const cat = (state.config.categories || []).find((c) => c.key === sortState.key);
    if (!isSortableCategory(cat)) {
      sortState = { key: "title", dir: "default" };
      state.librarySort = sortState;
    }
  }
  const items = getFilteredEntries(true)
    .map((entry, idx) => ({ ...entry, _libIndex: idx }))
    .filter((entry) => {
      if (!query) return true;
      const title = (entry.displayTitle || entry.titles.main || "").toLowerCase();
      const tags = JSON.stringify(entry.categories || {}).toLowerCase();
      return title.includes(query) || tags.includes(query);
    })
    .map((entry) => entry);

  const sorted = sortEntries(
    items,
    sortState,
    (a, b) => a._libIndex - b._libIndex
  );

  sorted.forEach((entry) => renderLibraryRow(entry));
};

const formatDetailValue = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "-";
  return String(value);
};

const buildDetailsText = (entry) => {
  if (!entry) return "";
  const lines = [];
  const mainTitle = entry.displayTitle || entry.titles.main || "Unknown";
  lines.push(mainTitle);
  if (entry.titles.main && entry.titles.main !== mainTitle) {
    lines.push(entry.titles.main);
  }
  if (entry.type) {
    lines.push(`Type: ${entry.type}`);
  }
  for (const category of state.config.categories || []) {
    const value = entry.categories ? entry.categories[category.key] : "";
    lines.push(`${category.label}: ${formatDetailValue(value)}`);
  }
  if (entry.synopsis) lines.push(`Synopsis: ${entry.synopsis}`);
  if (entry.url) lines.push(entry.url);
  return lines.join("\n");
};

const renderResult = (entry, outcome) => {
  if (!entry) return;
  dom.result.hidden = false;
  const existingNewRound = dom.newRoundBtn;
  dom.result.innerHTML = "";
  if (existingNewRound) {
    dom.result.appendChild(existingNewRound);
    existingNewRound.hidden = false;
  }

  const header = document.createElement("div");
  header.className = "result-header";

  const poster = document.createElement("img");
  poster.src = entry.poster || "";
  poster.alt = entry.displayTitle || entry.titles.main || "Poster";
  header.appendChild(poster);

  const titleBlock = document.createElement("div");
  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = entry.displayTitle || entry.titles.main || "Unknown";

  const meta = document.createElement("div");
  meta.className = "result-meta";
  const altTitles = [];
  if (entry.titles && entry.titles.english && entry.titles.english !== title.textContent) {
    altTitles.push(entry.titles.english);
  }
  if (entry.titles && entry.titles.japanese && entry.titles.japanese !== title.textContent) {
    altTitles.push(entry.titles.japanese);
  }
  const outcomeText = outcome === "win" ? "Correct answer" : "Answer revealed";
  meta.textContent = altTitles.length ? `${outcomeText} · ${altTitles.join(" · ")}` : outcomeText;

  titleBlock.appendChild(title);
  titleBlock.appendChild(meta);
  header.appendChild(titleBlock);

  dom.result.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "result-grid";
  if (entry.type) {
    const typeItem = document.createElement("div");
    typeItem.className = "result-item";
    const typeLabel = document.createElement("span");
    typeLabel.textContent = "Type";
    typeItem.appendChild(typeLabel);
    const typeValue = document.createElement("div");
    typeValue.textContent = entry.type;
    typeItem.appendChild(typeValue);
    grid.appendChild(typeItem);
  }
  for (const category of state.config.categories || []) {
    const item = document.createElement("div");
    item.className = "result-item";
    const label = document.createElement("span");
    label.textContent = category.label;
    item.appendChild(label);
    const value = document.createElement("div");
    value.textContent = formatDetailValue(entry.categories ? entry.categories[category.key] : "");
    item.appendChild(value);
    grid.appendChild(item);
  }
  dom.result.appendChild(grid);

  if (entry.synopsis) {
    const synopsis = document.createElement("div");
    synopsis.className = "result-synopsis";
    synopsis.textContent = entry.synopsis;
    dom.result.appendChild(synopsis);
  }

  if (entry.url) {
    const link = document.createElement("a");
    link.href = entry.url;
    link.textContent = "Open on MyAnimeList";
    link.target = "_blank";
    link.rel = "noopener";
    dom.result.appendChild(link);
  }
};

const showPreview = (entry, event) => {
  if (!dom.preview || !entry) return;
  dom.preview.hidden = false;
  dom.preview.innerHTML = "";

  const header = document.createElement("div");
  header.className = "preview-header";

  const img = document.createElement("img");
  img.src = entry.poster || "";
  img.alt = entry.displayTitle || entry.titles.main || "Poster";
  header.appendChild(img);

  const headerText = document.createElement("div");
  const title = document.createElement("div");
  title.className = "preview-title";
  title.textContent = entry.displayTitle || entry.titles.main || "Unknown";
  const sub = document.createElement("div");
  sub.className = "preview-sub";
  sub.textContent = entry.titles.main && entry.titles.main !== title.textContent ? entry.titles.main : "";
  headerText.appendChild(title);
  if (sub.textContent) headerText.appendChild(sub);
  header.appendChild(headerText);

  dom.preview.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "preview-grid";
  const previewCategories = (state.config.categories || []).slice(0, 6);
  for (const category of previewCategories) {
    const item = document.createElement("div");
    item.className = "preview-item";
    const label = document.createElement("span");
    label.textContent = category.label;
    item.appendChild(label);
    const value = document.createElement("div");
    value.textContent = formatDetailValue(entry.categories ? entry.categories[category.key] : "");
    item.appendChild(value);
    grid.appendChild(item);
  }
  dom.preview.appendChild(grid);

  if (entry.synopsis) {
    const synopsis = document.createElement("div");
    synopsis.className = "preview-synopsis";
    const clean = entry.synopsis.replace(/\s+/g, " ").trim();
    synopsis.textContent = clean.length > 180 ? `${clean.slice(0, 177)}...` : clean;
    dom.preview.appendChild(synopsis);
  }

  movePreview(event);
};

const movePreview = (event) => {
  if (!dom.preview || dom.preview.hidden) return;
  const padding = 16;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = dom.preview.getBoundingClientRect();
  let x = event.clientX + padding;
  let y = event.clientY + padding;
  if (x + rect.width > viewportWidth) x = viewportWidth - rect.width - padding;
  if (y + rect.height > viewportHeight) y = viewportHeight - rect.height - padding;
  dom.preview.style.left = `${Math.max(padding, x)}px`;
  dom.preview.style.top = `${Math.max(padding, y)}px`;
};

const hidePreview = () => {
  if (!dom.preview) return;
  dom.preview.hidden = true;
};

const refreshGuessRows = () => {
  const rows = dom.boardBody.querySelectorAll(".board-row.guess");
  rows.forEach((row) => {
    const id = row.dataset.id;
    const entry = state.guesses.find((guess) => guess.id === id);
    if (!entry) return;
    const title = row.querySelector(".title-name");
    const poster = row.querySelector(".poster");
    if (title) title.textContent = entry.displayTitle || entry.titles.main || "Unknown";
    if (poster) poster.src = entry.poster || "";
    row.title = "";
  });
};

const resetGame = () => {
  state.guesses = [];
  state.guessedIds = new Set();
  state.gameOver = false;
  state.resultOutcome = "";
  state.dailyId = null;
  state.guessSkips = 0;
  state.boardSort = { key: "title", dir: "default" };
  dom.boardBody.innerHTML = "";
  dom.result.hidden = true;
  dom.result.innerHTML = "";
  state.hintState = {};
  buildPools();
  buildSearchIndex();
  state.target = pickTarget();
  renderHeader(dom.boardHeader, "game");
  updateCounts();
  setupHints();
  renderHints();
  setStatus("", "");
  lockInput(false);
  if (dom.newRoundBtn) dom.newRoundBtn.hidden = true;
};

const setDailyMode = (enabled) => {
  state.uiSettings.dailyMode = !!enabled;
  if (dom.dailyBtn) dom.dailyBtn.classList.toggle("active", state.uiSettings.dailyMode);
  updateStreakDisplay();
  updateAvailableCount();
  updateHash();
};

const setLibraryMode = (enabled) => {
  state.libraryMode = !!enabled;
  if (dom.libraryBtn) {
    dom.libraryBtn.classList.toggle("library-active", state.libraryMode);
    dom.libraryBtn.setAttribute("aria-label", state.libraryMode ? "Back to game" : "Library");
  }
  if (state.libraryMode && dom.dailyBtn) {
    dom.dailyBtn.classList.remove("active");
  }
  if (dom.library) dom.library.hidden = !state.libraryMode;
  const hideGame = state.libraryMode;
  if (dom.searchPanel) dom.searchPanel.hidden = hideGame;
  if (dom.status) dom.status.hidden = hideGame || !dom.status.textContent;
  if (dom.result) dom.result.hidden = hideGame || !state.gameOver;
  if (dom.hints) dom.hints.hidden = hideGame;
  if (dom.board) dom.board.hidden = hideGame;
  if (state.libraryMode) {
    renderLibraryList();
  } else {
    renderHints();
  }
  updateHash();
};

const updateHash = () => {
  if (state.libraryMode) {
    if (window.location.hash !== "#libary") {
      window.location.hash = "libary";
    }
    return;
  }
  const hash = state.uiSettings.dailyMode ? "#daily" : "";
  if (window.location.hash !== hash) {
    if (hash) {
      window.location.hash = "daily";
    } else {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }
};

const startNewGame = (targetId) => {
  state.guesses = [];
  state.guessedIds = new Set();
  state.gameOver = false;
  state.resultOutcome = "";
  state.dailyId = targetId || null;
  state.guessSkips = 0;
  state.boardSort = { key: "title", dir: "default" };
  dom.boardBody.innerHTML = "";
  dom.result.hidden = true;
  dom.result.innerHTML = "";
  state.hintState = {};
  buildPools();
  buildSearchIndex();
  if (targetId) {
    state.target = state.answerPool.find((entry) => entry.id === targetId) || null;
  } else {
    state.target = pickTarget();
  }
  renderHeader(dom.boardHeader, "game");
  updateCounts();
  setupHints();
  renderHints();
  setStatus("", "");
  lockInput(false);
  if (dom.newRoundBtn) dom.newRoundBtn.hidden = true;
  if (!state.target) {
    setStatus("Daily id not available with current filters.", "warn");
  }
};

const restoreDailyProgress = (progress) => {
  if (!progress || !progress.id) return;
  state.dailyId = progress.id;
  state.guessSkips = typeof progress.skipCount === "number" ? progress.skipCount : 0;
  state.hintState = progress.hintState && typeof progress.hintState === "object" ? progress.hintState : {};
  state.guesses = [];
  state.guessedIds = new Set();
  dom.boardBody.innerHTML = "";

  const guessIds = Array.isArray(progress.guesses) ? progress.guesses : [];
  guessIds.forEach((id) => {
    const entry = getEntryById(id);
    if (!entry) return;
    state.guesses.push(entry);
    state.guessedIds.add(entry.id);
    removeFromGuessPool(entry);
  });
  renderGuessBoard();

  state.gameOver = !!progress.gameOver;
  state.resultOutcome = progress.resultOutcome || "";
  updateCounts();
  renderHints();

  if (state.gameOver && state.target) {
    const targetTitle = state.target.displayTitle || state.target.titles.main;
    if (state.resultOutcome === "win") {
      setStatus(`Correct! It was ${targetTitle}.`, "good");
      renderResult(state.target, "win");
    } else if (state.resultOutcome === "lose") {
      setStatus(`Out of guesses. It was ${targetTitle}.`, "bad");
      renderResult(state.target, "lose");
    }
    lockInput(true);
  } else {
    lockInput(false);
    setStatus("", "");
  }
};

const rebuildPoolsPreserve = () => {
  const targetId = state.target ? state.target.id : null;
  buildPools();
  state.guessPool = state.guessPool.filter((entry) => !state.guessedIds.has(entry.id));
  buildSearchIndex();
  if (targetId && !state.answerPool.find((entry) => entry.id === targetId)) {
    resetGame();
  } else if (targetId) {
    const updatedTarget = state.answerPool.find((entry) => entry.id === targetId);
    if (updatedTarget) state.target = updatedTarget;
    renderGuessBoard();
  }
  updateCounts();
};

const applyTitleMode = (mode) => {
  state.displayMode = mode || state.displayMode;
  state.rawEntries = state.rawEntries.map((entry) => ({
    ...entry,
    displayTitle: pickDisplayTitle(entry, state.displayMode)
  }));

  rebuildPoolsPreserve();
  state.guesses = state.guesses.map((guess) => state.answerPool.find((entry) => entry.id === guess.id) || guess);
  renderGuessBoard();
  renderHints();
  renderLibraryList();
  if (!dom.result.hidden && state.target) {
    renderResult(state.target, state.resultOutcome || "");
  }
};

const clearSuggestions = () => {
  state.suggestions = [];
  state.highlightIndex = 0;
  dom.suggestions.innerHTML = "";
  dom.suggestions.classList.remove("open");
};

const renderSuggestions = () => {
  dom.suggestions.innerHTML = "";
  if (!state.suggestions.length) {
    dom.suggestions.classList.remove("open");
    return;
  }

  const list = document.createElement("div");
  list.className = "suggestion-list";

  state.suggestions.forEach((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion" + (index === state.highlightIndex ? " highlighted" : "");
    button.dataset.index = String(index);

    const img = document.createElement("img");
    img.src = entry.poster || "";
    img.alt = "";
    button.appendChild(img);

    const text = document.createElement("div");
    text.className = "suggestion-text";
    text.textContent = entry.displayTitle || entry.titles.main || "Unknown";
    button.appendChild(text);

    button.addEventListener("mousemove", () => {
      state.highlightIndex = index;
      renderSuggestions();
    });

    button.addEventListener("click", () => {
      guessEntry(entry);
    });

    list.appendChild(button);
  });

  dom.suggestions.appendChild(list);
  dom.suggestions.classList.add("open");
};

const updateSuggestions = () => {
  updateAvailableCount();
  if (dom.input.disabled) {
    clearSuggestions();
    return;
  }
  const query = dom.input.value.trim();
  if (!query) {
    clearSuggestions();
    return;
  }
  const normalized = normalizeSearch(query);
  const matches = [];

  for (const entry of state.guessPool) {
    let best = Infinity;
    for (const candidate of entry._searchIndex || []) {
      const score = fuzzyScore(normalized, candidate);
      if (score < best) best = score;
      if (best === 0) break;
    }
    if (best !== Infinity) {
      matches.push({ entry, score: best });
    }
  }

  matches.sort((a, b) => a.score - b.score || (a.entry.displayTitle || "").localeCompare(b.entry.displayTitle || ""));
  state.suggestions = matches.slice(0, 12).map((match) => match.entry);
  state.highlightIndex = 0;
  renderSuggestions();
};

const removeFromGuessPool = (entry) => {
  const mode = getRelatedMode();
  if (mode === 1) {
    state.guessPool = state.guessPool.filter((item) => item.id !== entry.id);
  } else {
    state.guessPool = state.guessPool.filter((item) => item.id !== entry.id);
  }
  buildSearchIndex();
};

const guessEntry = (entry) => {
  if (!entry) return;
  if (state.gameOver) return;
  if (getGuessCount() >= getMaxGuesses()) {
    setStatus("No guesses left.", "bad");
    lockInput(true);
    return;
  }
  const mode = getRelatedMode();
  const guessId = mode === 1 ? entry.id : entry.id;

  if (state.guessedIds.has(guessId)) {
    setStatus("Already guessed that one.", "warn");
    clearSuggestions();
    dom.input.value = "";
    return;
  }

  state.guessedIds.add(guessId);
  state.guesses.push(entry);
  state.boardSort = { key: "title", dir: "default" };
  renderHeader(dom.boardHeader, "game");
  renderGuessBoard();
  updateCounts();
  renderHints();
  removeFromGuessPool(entry);

  let correct = false;
  if (mode === 1) {
    correct = entry.id === state.target.id;
  } else if (mode === 2) {
    correct = entry.id === state.target.id ||
      (entry.related && state.target.related && entry.related.group_id === state.target.related.group_id);
  } else {
    correct = entry.id === state.target.id;
  }

  if (correct) {
    const targetTitle = state.target.displayTitle || state.target.titles.main;
    setStatus(`Correct! It was ${targetTitle}.`, "good");
    state.gameOver = true;
    lockInput(true);
    state.resultOutcome = "win";
    markWin(state.target);
    registerWin();
    renderResult(state.target, "win");
  } else {
    if (getGuessCount() >= getMaxGuesses()) {
      const targetTitle = state.target.displayTitle || state.target.titles.main;
      setStatus(`Out of guesses. It was ${targetTitle}.`, "bad");
      state.gameOver = true;
      lockInput(true);
      state.resultOutcome = "lose";
      registerLoss();
      renderResult(state.target, "lose");
    } else {
      setStatus("Not quite. Try again.", "");
    }
  }

  saveDailyProgress();
  dom.input.value = "";
  clearSuggestions();
};

const handleKeydown = (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!state.suggestions.length) return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const count = state.suggestions.length;
    state.highlightIndex = (state.highlightIndex + direction + count) % count;
    renderSuggestions();
    return;
  }

  if (event.key === "Enter") {
    if (state.suggestions.length) {
      event.preventDefault();
      guessEntry(state.suggestions[state.highlightIndex]);
    }
    return;
  }
};

const handleGlobalTyping = (event) => {
  if (state.libraryMode) return;
  if (event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = event.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;
  if (event.key.length !== 1) return;

  dom.input.focus();
  dom.input.value += event.key;
  updateSuggestions();
};

const init = async () => {
  const [config, entries] = await Promise.all([
    fetch("./config.json").then((res) => res.json()),
    fetch("./data.json").then((res) => res.json())
  ]);

  state.config = config;
  state.gameOver = false;
  state.resultOutcome = "";
  state.streaks = loadStreaks();
  state.libraryWins = loadLibraryWins();
  const loadedSettings = loadUiSettings();
  state.uiSettings = {
    ...loadedSettings,
    titleMode: loadedSettings.titleMode || config.displayTitle || "english",
    hideUnreleased: !!loadedSettings.hideUnreleased,
    finishedOnly: !!loadedSettings.finishedOnly,
    dailyMode: false
  };
  state.displayMode = state.uiSettings.titleMode || config.displayTitle || "english";
  state.rawEntries = entries.map((entry) => ({
    ...entry,
    displayTitle: pickDisplayTitle(entry, state.displayMode)
  }));

  buildPools();
  buildSearchIndex();
  buildRulesContent();
  renderLibraryList();

  state.target = pickTarget();

  renderHeader(dom.boardHeader, "game");
  renderHeader(dom.libraryHeader, "library");
  updateCounts();
  setupHints();
  renderHints();
  lockInput(false);
  dom.result.hidden = true;
  dom.result.innerHTML = "";
  applyUiSettings();
  setStatus("", "");
};

window.addEventListener("DOMContentLoaded", () => {
  dom.input = document.querySelector("#search-input");
  dom.clearBtn = document.querySelector("#clear-btn");
  dom.guessBtn = document.querySelector("#guess-btn");
  dom.suggestions = document.querySelector("#suggestions");
  dom.boardHeader = document.querySelector("#board-header");
  dom.boardBody = document.querySelector("#board-body");
  dom.searchPanel = document.querySelector("#search-panel");
  dom.board = document.querySelector("#board");
  dom.library = document.querySelector("#library");
  dom.libraryHeader = document.querySelector("#library-header");
  dom.libraryBody = document.querySelector("#library-body");
  dom.librarySearch = document.querySelector("#library-search");
  dom.libraryBtn = document.querySelector("#library-btn");
  dom.settingsDailyNote = document.querySelector("#settings-daily-note");
  dom.guessCount = document.querySelector("#guess-count");
  dom.totalCount = document.querySelector("#total-count");
  dom.status = document.querySelector("#status");
  dom.hints = document.querySelector("#hints");
  dom.result = document.querySelector("#result");
  dom.streakLabel = document.querySelector("#streak-label");
  dom.streakCount = document.querySelector("#streak-count");
  dom.preview = document.querySelector("#preview");
  dom.settingsBtn = document.querySelector("#settings-btn");
  dom.dailyBtn = document.querySelector("#daily-btn");
  dom.settingsModal = document.querySelector("#settings-modal");
  dom.settingsClose = document.querySelector("#settings-close");
  dom.rulesBtn = document.querySelector("#rules-btn");
  dom.rulesModal = document.querySelector("#rules-modal");
  dom.rulesClose = document.querySelector("#rules-close");
  dom.rulesBody = document.querySelector("#rules-body");
  dom.settingAnimations = document.querySelector("#setting-animations");
  dom.settingHints = document.querySelector("#setting-hints");
  dom.settingHideUnreleased = document.querySelector("#setting-hide-unreleased");
  dom.settingFinishedOnly = document.querySelector("#setting-finished-only");
  dom.settingTitle = document.querySelector("#setting-title");
  dom.settingRelatedMode = document.querySelector("#setting-related-mode");
  dom.settingAnimSpeed = document.querySelector("#setting-anim-speed");
  dom.settingAnimSpeedValue = document.querySelector("#setting-anim-speed-value");
  dom.settingMinMembers = document.querySelector("#setting-min-members");
  dom.settingFontSize = document.querySelector("#setting-font-size");
  dom.settingFilterCount = document.querySelector("#setting-filter-count");
  dom.newRoundBtn = document.querySelector("#new-round-btn");

  dom.input.addEventListener("input", updateSuggestions);
  dom.input.addEventListener("keydown", handleKeydown);
  dom.clearBtn.addEventListener("click", () => {
    dom.input.value = "";
    clearSuggestions();
    dom.input.focus();
  });
  dom.guessBtn.addEventListener("click", () => {
    if (state.suggestions.length) {
      guessEntry(state.suggestions[state.highlightIndex]);
    }
  });

  const openSettings = () => {
    if (!dom.settingsModal) return;
    dom.settingsModal.hidden = false;
    renderHints();
    updateAvailableCount();
    if (dom.settingsDailyNote) dom.settingsDailyNote.hidden = !state.uiSettings.dailyMode;
  };

  const closeSettings = () => {
    if (!dom.settingsModal) return;
    dom.settingsModal.hidden = true;
    if (dom.settingsDailyNote) dom.settingsDailyNote.hidden = true;
  };

  const openRules = () => {
    if (!dom.rulesModal) return;
    dom.rulesModal.hidden = false;
  };

  const closeRules = () => {
    if (!dom.rulesModal) return;
    dom.rulesModal.hidden = true;
  };

  if (dom.settingsBtn) {
    dom.settingsBtn.addEventListener("click", openSettings);
  }
  if (dom.rulesBtn) {
    dom.rulesBtn.addEventListener("click", openRules);
  }
  if (dom.libraryBtn) {
    dom.libraryBtn.addEventListener("click", () => {
      if (state.libraryMode) {
        setLibraryMode(false);
      } else {
        setLibraryMode(true);
      }
    });
  }
  if (dom.dailyBtn) {
    dom.dailyBtn.addEventListener("click", async () => {
      try {
        if (state.libraryMode) {
          setLibraryMode(false);
        }
        if (state.uiSettings.dailyMode) {
          setDailyMode(false);
          saveUiSettings();
          resetGame();
          return;
        }
        const res = await fetch("./daily.json", { cache: "no-store" });
        if (!res.ok) throw new Error("daily.json missing");
        const data = await res.json();
        const dailyId = typeof data === "string" ? data : (data && data.id ? data.id : null);
        if (!dailyId) throw new Error("daily.json invalid");
        const storedDaily = loadDailyProgress();
        setDailyMode(true);
        saveUiSettings();
        startNewGame(String(dailyId));
        if (storedDaily && storedDaily.id === String(dailyId)) {
          restoreDailyProgress(storedDaily);
        } else {
          saveDailyProgress();
        }
      } catch (err) {
        console.error(err);
        setStatus("Daily id not found. Run daily.js to generate.", "warn");
      }
    });
  }
  if (dom.settingsClose) {
    dom.settingsClose.addEventListener("click", closeSettings);
  }
  if (dom.rulesClose) {
    dom.rulesClose.addEventListener("click", closeRules);
  }
  if (dom.settingsModal) {
    dom.settingsModal.addEventListener("click", (event) => {
      if (event.target && event.target.closest && event.target.closest("[data-close='true']")) {
        closeSettings();
      }
    });
  }
  if (dom.rulesModal) {
    dom.rulesModal.addEventListener("click", (event) => {
      if (event.target && event.target.closest && event.target.closest("[data-close='true']")) {
        closeRules();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dom.settingsModal && !dom.settingsModal.hidden) {
      closeSettings();
      return;
    }
    if (event.key === "Escape" && dom.rulesModal && !dom.rulesModal.hidden) {
      closeRules();
    }
  });

  if (dom.settingAnimations) {
    dom.settingAnimations.addEventListener("change", () => {
      state.uiSettings.animations = dom.settingAnimations.checked;
      saveUiSettings();
      applyUiSettings();
    });
  }

  if (dom.settingHints) {
    dom.settingHints.addEventListener("change", () => {
      state.uiSettings.showHints = dom.settingHints.checked;
      saveUiSettings();
      applyUiSettings();
    });
  }

  if (dom.settingHideUnreleased) {
    dom.settingHideUnreleased.addEventListener("change", () => {
      state.uiSettings.hideUnreleased = dom.settingHideUnreleased.checked;
      saveUiSettings();
      rebuildPoolsPreserve();
      applyUiSettings();
    });
  }

  if (dom.settingFinishedOnly) {
    dom.settingFinishedOnly.addEventListener("change", () => {
      state.uiSettings.finishedOnly = dom.settingFinishedOnly.checked;
      saveUiSettings();
      rebuildPoolsPreserve();
      applyUiSettings();
    });
  }

  if (dom.settingTitle) {
    dom.settingTitle.addEventListener("change", () => {
      state.uiSettings.titleMode = dom.settingTitle.value;
      saveUiSettings();
      applyTitleMode(dom.settingTitle.value);
      applyUiSettings();
    });
  }

  if (dom.settingRelatedMode) {
    dom.settingRelatedMode.addEventListener("change", () => {
      const nextMode = parseInt(dom.settingRelatedMode.value, 10);
      state.uiSettings.relatedMode = Number.isFinite(nextMode) ? nextMode : null;
      saveUiSettings();
      if (state.uiSettings.dailyMode) {
        startNewGame(state.dailyId);
      } else {
        resetGame();
      }
    });
  }

  if (dom.settingAnimSpeed) {
    dom.settingAnimSpeed.addEventListener("input", () => {
      state.uiSettings.animSpeedMs = parseInt(dom.settingAnimSpeed.value || "450", 10) || 450;
      saveUiSettings();
      applyUiSettings();
    });
  }

  if (dom.settingMinMembers) {
    dom.settingMinMembers.addEventListener("input", () => {
      state.uiSettings.minMembers = parseInt(dom.settingMinMembers.value || "0", 10) || 0;
      saveUiSettings();
      rebuildPoolsPreserve();
      applyUiSettings();
    });
  }

  if (dom.settingFontSize) {
    dom.settingFontSize.addEventListener("input", () => {
      state.uiSettings.fontSize = parseInt(dom.settingFontSize.value || "12", 10) || 12;
      saveUiSettings();
      applyUiSettings();
    });
  }

  if (dom.newRoundBtn) {
    dom.newRoundBtn.addEventListener("click", () => {
      if (state.uiSettings.dailyMode) {
        dom.dailyBtn.click();
      } else {
        resetGame();
      }
    });
  }

  const handleHashChange = async () => {
    const hash = window.location.hash;
    if (hash === "#libary") {
      if (!state.libraryMode) setLibraryMode(true);
      return;
    }
    if (state.libraryMode) setLibraryMode(false);
    if (hash !== "#daily") return;
    if (!dom.dailyBtn || state.uiSettings.dailyMode) return;
    await dom.dailyBtn.click();
  };

  document.addEventListener("keydown", handleGlobalTyping);
  document.addEventListener("click", (event) => {
    if (!dom.suggestions.contains(event.target) && event.target !== dom.input) {
      clearSuggestions();
    }
  });

  if (dom.librarySearch) {
    dom.librarySearch.addEventListener("input", renderLibraryList);
  }

  window.addEventListener("scroll", hidePreview, true);
  window.addEventListener("hashchange", handleHashChange);

  init().then(handleHashChange).catch((error) => {
    console.error(error);
    setStatus("Failed to load data.", "bad");
  });
});
