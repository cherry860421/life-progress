const STORAGE_KEY = "life-progress-app-v4";
const V3_KEY = "life-progress-app-v3";
const V2_KEY = "life-progress-app-v2";
const V1_KEY = "life-progress-app-v1";

const LOCAL_UPDATED_KEY = "life-progress-app-v4-local-updated-at";
const LOCAL_DIRTY_KEY = "life-progress-app-v4-dirty";
const LAST_SYNC_KEY = "life-progress-app-v4-last-sync";

const cloudState = {
  client: null,
  user: null,
  saveTimer: null,
  syncing: false,
  offlineMode: false,
  initialized: false,
  pullTimer: null
};

const state = {
  plannerMode: "today",
  calendarMode: "week",
  calendarCursor: new Date(),
  selectedDate: new Date(),
  editingTrackerId: null,
  editingTodoId: null,
  activeGoalTab: "goals",
  activeQuoteBookId: null,
  reminderTimerIds: [],
};

function uid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date, amount) {
  const d = new Date(date);
  d.setDate(d.getDate() + amount);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekdayText(day) {
  return ["日", "一", "二", "三", "四", "五", "六"][day];
}

function prettyDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}（${weekdayText(date.getDay())}）`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function defaultData() {
  return {
    todos: [
      { id: uid(), title: "整理工作文件", done: false, createdAt: Date.now() },
    ],
    trackers: [
      {
        id: uid(), icon: "📚", title: "閱讀 20 分鐘",
        cycle: "day", weeklyTarget: 1, weekdays: [],
        monthDay: 1, intervalDays: 1, startDate: localDate(),
        timeMode: "evening", time: "", createdAt: Date.now()
      },
      {
        id: uid(), icon: "🧶", title: "鉤針",
        cycle: "week", weeklyTarget: 2, weekdays: [],
        monthDay: 1, intervalDays: 1, startDate: localDate(),
        timeMode: "evening", time: "", createdAt: Date.now()
      }
    ],
    plans: [],
    goals: [
      { id: uid(), title: "今年看完 12 本書", period: "year", unit: "本", target: 12, current: 0, createdAt: Date.now() }
    ],
    books: [],
    notificationSettings: {
      enabled: false,
      leadMinutes: 15
    },
    logs: {
      trackers: {},
      journal: {},
      moods: {}
    }
  };
}

function normalizeTracker(t) {
  return {
    id: t.id || uid(),
    icon: t.icon || "🌿",
    title: t.title || "未命名項目",
    cycle: ["day","week","month","custom"].includes(t.cycle) ? t.cycle : "day",
    weeklyTarget: Math.max(1, Number(t.weeklyTarget || 1)),
    weekdays: Array.isArray(t.weekdays) ? t.weekdays.map(Number) : [],
    monthDay: Math.min(31, Math.max(1, Number(t.monthDay || 1))),
    intervalDays: Math.max(1, Number(t.intervalDays || 1)),
    startDate: t.startDate || localDate(),
    timeMode: ["anytime","morning","afternoon","evening","specific"].includes(t.timeMode) ? t.timeMode : "anytime",
    time: t.time || "",
    createdAt: t.createdAt || Date.now()
  };
}

function normalizeBook(book) {
  const totalPages = Math.max(1, Number(book?.totalPages || 1));
  const currentPage = Math.min(totalPages, Math.max(0, Number(book?.currentPage || 0)));
  return {
    id: book?.id || uid(),
    title: book?.title || "未命名書籍",
    author: book?.author || "",
    totalPages,
    currentPage,
    createdAt: book?.createdAt || Date.now(),
    finishedAt: book?.finishedAt || null,
    history: Array.isArray(book?.history) ? book.history : [],
    quotes: Array.isArray(book?.quotes) ? book.quotes : []
  };
}


function normalizeGoal(goal) {
  return {
    id: goal?.id || uid(),
    title: goal?.title || "未命名目標",
    period: goal?.period === "year" ? "year" : "month",
    unit: goal?.unit || "",
    target: Math.max(1, Number(goal?.target || 1)),
    current: Math.max(0, Number(goal?.current || 0)),
    createdAt: goal?.createdAt || Date.now(),
    history: Array.isArray(goal?.history) ? goal.history : []
  };
}

function normalizeData(raw) {
  return {
    todos: Array.isArray(raw?.todos) ? raw.todos : [],
    trackers: Array.isArray(raw?.trackers) ? raw.trackers.map(normalizeTracker) : [],
    plans: Array.isArray(raw?.plans) ? raw.plans : [],
    goals: Array.isArray(raw?.goals) ? raw.goals.map(normalizeGoal) : [],
    books: Array.isArray(raw?.books) ? raw.books.map(normalizeBook) : [],
    notificationSettings: {
      enabled: Boolean(raw?.notificationSettings?.enabled),
      leadMinutes: Number(raw?.notificationSettings?.leadMinutes ?? 15)
    },
    logs: {
      trackers: raw?.logs?.trackers || {},
      journal: raw?.logs?.journal || {},
      moods: raw?.logs?.moods || {}
    }
  };
}

function migrateOld(raw) {
  const trackers = [];
  const trackerLogs = {};

  for (const h of raw?.habits || []) {
    trackers.push(normalizeTracker({
      id: h.id, icon: "🌿", title: h.title, cycle: "day",
      timeMode: "anytime", createdAt: h.createdAt
    }));
    trackerLogs[h.id] = {};
    const old = raw?.logs?.habits?.[h.id] || {};
    for (const [date, done] of Object.entries(old)) trackerLogs[h.id][date] = done ? 1 : 0;
  }

  for (const h of raw?.hobbies || []) {
    trackers.push(normalizeTracker({
      id: h.id, icon: "🧶", title: h.title, cycle: "week",
      weeklyTarget: h.weeklyTarget || 2, weekdays: [],
      timeMode: "anytime", createdAt: h.createdAt
    }));
    trackerLogs[h.id] = {};
    const old = raw?.logs?.hobbies?.[h.id] || {};
    for (const [date, count] of Object.entries(old)) trackerLogs[h.id][date] = Number(count || 0);
  }

  return normalizeData({
    todos: raw?.todos || [],
    trackers,
    plans: [],
    goals: [],
    books: [],
    logs: {
      trackers: trackerLogs,
      journal: raw?.logs?.journal || {},
      moods: raw?.logs?.moods || {}
    }
  });
}

function setLocalMeta({ updatedAt = Date.now(), dirty = true } = {}) {
  localStorage.setItem(LOCAL_UPDATED_KEY, String(updatedAt));
  localStorage.setItem(LOCAL_DIRTY_KEY, dirty ? "1" : "0");
}

function localIsDirty() {
  return localStorage.getItem(LOCAL_DIRTY_KEY) === "1";
}

function localUpdatedAt() {
  return Number(localStorage.getItem(LOCAL_UPDATED_KEY) || 0);
}

function saveData(options = {}) {
  const { markDirty = true, sync = true } = options;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

  if (markDirty) {
    setLocalMeta({ updatedAt: Date.now(), dirty: true });
    setCloudStatus("pending", navigator.onLine ? "有變更，等待同步" : "離線中，已存本機");
  }

  if (sync && markDirty) scheduleCloudSave();
}

function saveRemoteToLocal(remoteData, remoteUpdatedAt) {
  data = normalizeData(remoteData);
  if (!data.logs.moods) data.logs.moods = {};

  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  setLocalMeta({
    updatedAt: remoteUpdatedAt ? Date.parse(remoteUpdatedAt) || Date.now() : Date.now(),
    dirty: false
  });

  renderAll();
}

function loadData() {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) {
    try { return normalizeData(JSON.parse(current)); } catch (_) {}
  }

  // V3 / V3.1 / V3.2 已經是 trackers / plans / goals 結構，可直接升級。
  const v3 = localStorage.getItem(V3_KEY);
  if (v3) {
    try {
      const migrated = normalizeData(JSON.parse(v3));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      setLocalMeta({ updatedAt: 0, dirty: false });
      return migrated;
    } catch (_) {}
  }

  // V2 / V1 使用舊 habits / hobbies 結構。
  for (const oldKey of [V2_KEY, V1_KEY]) {
    const old = localStorage.getItem(oldKey);
    if (old) {
      try {
        const migrated = migrateOld(JSON.parse(old));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        setLocalMeta({ updatedAt: 0, dirty: false });
        return migrated;
      } catch (_) {}
    }
  }

  const initial = defaultData();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  setLocalMeta({ updatedAt: 0, dirty: false });
  return initial;
}

let data = loadData();
if (!data.logs.moods) data.logs.moods = {};

const $ = (id) => document.getElementById(id);
const els = {
  cloudBar: $("cloudBar"),
  cloudDot: $("cloudDot"),
  syncStatus: $("syncStatus"),
  accountEmail: $("accountEmail"),
  lastSyncText: $("lastSyncText"),
  syncNowBtn: $("syncNowBtn"),
  logoutBtn: $("logoutBtn"),
  authModal: $("authModal"),
  authEmail: $("authEmail"),
  authPassword: $("authPassword"),
  authMessage: $("authMessage"),
  signInBtn: $("signInBtn"),
  signUpBtn: $("signUpBtn"),
  offlineModeBtn: $("offlineModeBtn"),

  todayLabel: $("todayLabel"),
  todayProgressValue: $("todayProgressValue"),
  monthProgressValue: $("monthProgressValue"),
  bestStreakValue: $("bestStreakValue"),
  quickTodoInput: $("quickTodoInput"),
  quickTodoBtn: $("quickTodoBtn"),
  todayProgressText: $("todayProgressText"),
  todayProgressBar: $("todayProgressBar"),
  todayProgressPercent: $("todayProgressPercent"),
  todayReadingList: $("todayReadingList"),
  todayPlanList: $("todayPlanList"),
  todayTrackerList: $("todayTrackerList"),
  flexTrackerList: $("flexTrackerList"),
  todoList: $("todoList"),
  monthProgressLabel: $("monthProgressLabel"),
  monthProgressBar: $("monthProgressBar"),
  monthProgressMeta: $("monthProgressMeta"),
  streakCards: $("streakCards"),
  journalInput: $("journalInput"),
  moodPicker: $("moodPicker"),

  planTitle: $("planTitle"),
  planDate: $("planDate"),
  planTimeMode: $("planTimeMode"),
  planSpecificTimeField: $("planSpecificTimeField"),
  planSpecificTime: $("planSpecificTime"),
  addPlanBtn: $("addPlanBtn"),
  plannerDisplay: $("plannerDisplay"),
  notificationStatus: $("notificationStatus"),
  reminderLead: $("reminderLead"),
  enableNotificationsBtn: $("enableNotificationsBtn"),
  testNotificationBtn: $("testNotificationBtn"),
  toastHost: $("toastHost"),

  calendarTitle: $("calendarTitle"),
  calendarGrid: $("calendarGrid"),
  selectedDateTitle: $("selectedDateTitle"),
  selectedDateDetail: $("selectedDateDetail"),
  selectedDateJournal: $("selectedDateJournal"),
  selectedDateMood: $("selectedDateMood"),
  selectedDateJournalText: $("selectedDateJournalText"),
  selectedDateActivity: $("selectedDateActivity"),
  selectedDateActivityList: $("selectedDateActivityList"),
  moodMonthLabel: $("moodMonthLabel"),
  monthlyMoodSummary: $("monthlyMoodSummary"),
  calendarPrev: $("calendarPrev"),
  calendarToday: $("calendarToday"),
  calendarNext: $("calendarNext"),

  goalTitle: $("goalTitle"),
  goalPeriod: $("goalPeriod"),
  goalUnit: $("goalUnit"),
  goalTarget: $("goalTarget"),
  goalCurrent: $("goalCurrent"),
  addGoalBtn: $("addGoalBtn"),
  goalList: $("goalList"),
  goalsTabContent: $("goalsTabContent"),
  libraryTabContent: $("libraryTabContent"),
  bookTitle: $("bookTitle"),
  bookAuthor: $("bookAuthor"),
  bookTotalPages: $("bookTotalPages"),
  bookCurrentPage: $("bookCurrentPage"),
  addBookBtn: $("addBookBtn"),
  readingSummaryBadge: $("readingSummaryBadge"),
  bookList: $("bookList"),
  quoteModal: $("quoteModal"),
  quoteModalTitle: $("quoteModalTitle"),
  addQuoteModal: $("addQuoteModal"),
  addQuoteModalTitle: $("addQuoteModalTitle"),
  openAddQuoteBtn: $("openAddQuoteBtn"),
  quoteText: $("quoteText"),
  quotePage: $("quotePage"),
  quoteNote: $("quoteNote"),
  addQuoteBtn: $("addQuoteBtn"),
  quoteRecordCount: $("quoteRecordCount"),
  quoteList: $("quoteList"),

  trackerIcon: $("trackerIcon"),
  trackerTitle: $("trackerTitle"),
  trackerCycle: $("trackerCycle"),
  trackerTimeMode: $("trackerTimeMode"),
  trackerSpecificTimeField: $("trackerSpecificTimeField"),
  trackerSpecificTime: $("trackerSpecificTime"),
  weekCycleFields: $("weekCycleFields"),
  weeklyTarget: $("weeklyTarget"),
  weekdayPicker: $("weekdayPicker"),
  monthCycleFields: $("monthCycleFields"),
  monthDay: $("monthDay"),
  customCycleFields: $("customCycleFields"),
  customIntervalDays: $("customIntervalDays"),
  customStartDate: $("customStartDate"),
  addTrackerBtn: $("addTrackerBtn"),
  manageTrackerList: $("manageTrackerList"),
  manageTodoList: $("manageTodoList"),

  editTrackerModal: $("editTrackerModal"),
  editTrackerTitle: $("editTrackerTitle"),
  editTrackerIcon: $("editTrackerIcon"),
  saveTrackerEditBtn: $("saveTrackerEditBtn"),
  editTodoModal: $("editTodoModal"),
  editTodoTitle: $("editTodoTitle"),
  saveTodoEditBtn: $("saveTodoEditBtn"),
};

els.planDate.value = localDate();
els.customStartDate.value = localDate();

function ensureTrackerLog(id) {
  if (!data.logs.trackers[id]) data.logs.trackers[id] = {};
}

function getTrackerCount(id, dateStr) {
  ensureTrackerLog(id);
  return Number(data.logs.trackers[id][dateStr] || 0);
}

function setTrackerCount(id, dateStr, count) {
  ensureTrackerLog(id);
  data.logs.trackers[id][dateStr] = Math.max(0, Number(count) || 0);
  saveData();
  renderAll();
}

function isTrackerDueOn(tracker, date) {
  if (tracker.cycle === "day") return true;

  if (tracker.cycle === "week") {
    if (tracker.weekdays.length === 0) return false;
    return tracker.weekdays.includes(date.getDay());
  }

  if (tracker.cycle === "month") {
    return date.getDate() === tracker.monthDay;
  }

  if (tracker.cycle === "custom") {
    const start = parseDate(tracker.startDate);
    start.setHours(0,0,0,0);
    const target = new Date(date);
    target.setHours(0,0,0,0);
    const diff = Math.floor((target - start) / 86400000);
    return diff >= 0 && diff % tracker.intervalDays === 0;
  }

  return false;
}

function trackerCycleLabel(t) {
  if (t.cycle === "day") return "每天";
  if (t.cycle === "week") {
    if (t.weekdays.length) {
      const names = t.weekdays.map(d => weekdayText(d)).join("、");
      return `每週 ${names}`;
    }
    return `每週彈性 ${t.weeklyTarget} 次`;
  }
  if (t.cycle === "month") return `每月 ${t.monthDay} 號`;
  return `每 ${t.intervalDays} 天`;
}

function timeLabel(t) {
  if (t.timeMode === "morning") return "🌤️ 早上";
  if (t.timeMode === "afternoon") return "🫧 下午";
  if (t.timeMode === "evening") return "🌙 晚上";
  if (t.timeMode === "specific") return `🕰️ ${t.time || "指定時間"}`;
  return "☁️ 任意";
}

function timeSortValue(mode, time) {
  if (mode === "morning") return 800;
  if (mode === "afternoon") return 1400;
  if (mode === "evening") return 1900;
  if (mode === "specific" && time) {
    const [h,m] = time.split(":").map(Number);
    return h * 100 + m;
  }
  return 9999;
}

function getPlansForDate(dateStr) {
  return data.plans
    .filter(p => p.date === dateStr)
    .sort((a,b) => timeSortValue(a.timeMode,a.time) - timeSortValue(b.timeMode,b.time));
}

function getDueTrackersForDate(date) {
  return data.trackers
    .filter(t => isTrackerDueOn(t, date))
    .sort((a,b) => timeSortValue(a.timeMode,a.time) - timeSortValue(b.timeMode,b.time));
}

function getFlexibleWeekTrackers() {
  return data.trackers.filter(t => t.cycle === "week" && t.weekdays.length === 0);
}

function currentWeekCount(tracker, refDate = new Date()) {
  const start = startOfWeek(refDate);
  let total = 0;
  for (let i=0;i<7;i++) total += getTrackerCount(tracker.id, localDate(addDays(start,i)));
  return total;
}

function monthActual(tracker, ref = new Date()) {
  const prefix = `${ref.getFullYear()}-${String(ref.getMonth()+1).padStart(2,"0")}`;
  ensureTrackerLog(tracker.id);
  return Object.entries(data.logs.trackers[tracker.id])
    .filter(([date]) => date.startsWith(prefix))
    .reduce((sum,[,count]) => sum + Number(count || 0), 0);
}

function monthTargetToDate(tracker, ref = new Date()) {
  const y = ref.getFullYear(), m = ref.getMonth();
  const today = new Date(ref);
  const lastElapsedDay = today.getDate();

  if (tracker.cycle === "day") return lastElapsedDay;

  if (tracker.cycle === "week" && tracker.weekdays.length === 0) {
    return tracker.weeklyTarget * Math.ceil(lastElapsedDay / 7);
  }

  let due = 0;
  for (let day=1; day<=lastElapsedDay; day++) {
    if (isTrackerDueOn(tracker, new Date(y,m,day))) due += 1;
  }
  return due;
}

function monthProgress() {
  let actual = 0, target = 0;
  for (const t of data.trackers) {
    actual += monthActual(t);
    target += monthTargetToDate(t);
  }
  return {
    actual, target,
    percent: target === 0 ? 0 : Math.min(100, Math.round(actual/target*100))
  };
}

function currentStreak(tracker) {
  if (tracker.cycle !== "day") return 0;
  let streak = 0;
  let cursor = new Date();
  cursor.setHours(0,0,0,0);

  if (getTrackerCount(tracker.id, localDate(cursor)) === 0) {
    cursor = addDays(cursor,-1);
  }

  while (getTrackerCount(tracker.id, localDate(cursor)) > 0) {
    streak++;
    cursor = addDays(cursor,-1);
  }
  return streak;
}

function bestStreak(tracker) {
  if (tracker.cycle !== "day") return 0;
  ensureTrackerLog(tracker.id);

  const dates = Object.entries(data.logs.trackers[tracker.id])
    .filter(([,count]) => Number(count)>0)
    .map(([date]) => date)
    .sort();

  let best = 0, cur = 0, prev = null;
  for (const dateStr of dates) {
    const d = parseDate(dateStr);
    if (!prev) cur = 1;
    else {
      const diff = Math.round((d - prev)/86400000);
      cur = diff === 1 ? cur + 1 : 1;
    }
    best = Math.max(best,cur);
    prev = d;
  }
  return best;
}

function todayProgress() {
  const today = new Date();
  const dateStr = localDate(today);
  const due = getDueTrackersForDate(today);
  const plans = getPlansForDate(dateStr);
  const todos = data.todos;

  const trackerDone = due.filter(t => getTrackerCount(t.id,dateStr)>0).length;
  const planDone = plans.filter(p => p.done).length;
  const todoDone = todos.filter(t => t.done).length;

  const total = due.length + plans.length + todos.length;
  const done = trackerDone + planDone + todoDone;
  return { done, total, percent: total ? Math.round(done/total*100) : 0 };
}

function renderHeader() {
  const today = new Date();
  els.todayLabel.textContent = `${today.getFullYear()} 年 ${today.getMonth()+1} 月 ${today.getDate()} 日・星期${weekdayText(today.getDay())}`;

  const tp = todayProgress();
  const mp = monthProgress();
  const best = data.trackers.reduce((max,t) => Math.max(max,bestStreak(t)),0);

  els.todayProgressValue.textContent = `${tp.percent}%`;
  els.monthProgressValue.textContent = `${mp.percent}%`;
  els.bestStreakValue.textContent = `${best} 天`;

  els.todayProgressText.textContent = `${tp.done} / ${tp.total}`;
  els.todayProgressBar.style.width = `${tp.percent}%`;
  els.todayProgressPercent.textContent = `${tp.percent}%`;
  els.monthProgressLabel.textContent = `${mp.percent}%`;
  els.monthProgressBar.style.width = `${mp.percent}%`;
  els.monthProgressMeta.textContent = `${mp.actual} / ${mp.target}`;
}

function planCard(p) {
  return `
    <div class="item-card ${p.done ? "done" : ""}">
      <div class="item-main">
        <input type="checkbox" ${p.done ? "checked" : ""} data-action="toggle-plan" data-id="${p.id}">
        <span class="item-icon">🫧</span>
        <div>
          <div class="item-title">${escapeHtml(p.title)}</div>
          <div class="item-sub">${timeLabel(p)}</div>
        </div>
      </div>
      <div class="item-side">
        <button class="danger-btn" data-action="delete-plan" data-id="${p.id}">刪除</button>
      </div>
    </div>`;
}

function trackerCard(t, dateStr, flexible=false) {
  const count = getTrackerCount(t.id,dateStr);
  const sub = flexible
    ? `${trackerCycleLabel(t)}・本週 ${currentWeekCount(t)}/${t.weeklyTarget}`
    : `${trackerCycleLabel(t)}・${timeLabel(t)}`;

  return `
    <div class="item-card ${count>0 ? "done" : ""}">
      <div class="item-main">
        <button
          class="tracker-check ${count>0 ? "checked" : ""}"
          data-action="toggle-tracker-button"
          data-id="${t.id}"
          data-date="${dateStr}"
          aria-label="${count>0 ? "取消完成" : "標記完成"}"
          title="${count>0 ? "取消完成" : "標記完成"}"
        >${count>0 ? "✓" : ""}</button>
        <span class="item-icon">${t.icon}</span>
        <div>
          <div class="item-title">${escapeHtml(t.title)}</div>
          <div class="item-sub">${sub}</div>
        </div>
      </div>
      <div class="item-side">
        ${t.cycle==="day" ? `<span class="soft-badge">🔥 ${currentStreak(t)} 天</span>` : ""}
      </div>
    </div>`;
}

function renderToday() {
  const today = new Date();
  const dateStr = localDate(today);
  const plans = getPlansForDate(dateStr);
  const due = getDueTrackersForDate(today);
  const flex = getFlexibleWeekTrackers();

  els.todayPlanList.innerHTML = plans.length
    ? plans.map(planCard).join("")
    : `<div class="empty-state">今天還沒有生活規劃。可以安排看書、鉤針、追劇或休息 ☁️</div>`;

  els.todayTrackerList.innerHTML = due.length
    ? due.map(t => trackerCard(t,dateStr)).join("")
    : `<div class="empty-state">今天沒有固定打卡項目 ✨</div>`;

  els.flexTrackerList.innerHTML = flex.length
    ? flex.map(t => trackerCard(t,dateStr,true)).join("")
    : `<div class="empty-state">沒有每週彈性目標。</div>`;

  els.todoList.innerHTML = data.todos.length
    ? data.todos.map(t => `
      <div class="item-card ${t.done ? "done" : ""}">
        <div class="item-main">
          <button
            class="todo-check ${t.done ? "checked" : ""}"
            data-action="toggle-todo-button"
            data-id="${t.id}"
            type="button"
            aria-label="${t.done ? "取消完成" : "標記完成"}"
          >${t.done ? "✓" : ""}</button>
          <span class="item-icon">📌</span>
          <div class="item-title">${escapeHtml(t.title)}</div>
        </div>
        <div class="item-side">
          <button class="secondary-btn" data-action="edit-todo" data-id="${t.id}">編輯</button>
          <button class="danger-btn" data-action="delete-todo" data-id="${t.id}">刪除</button>
        </div>
      </div>`).join("")
    : `<div class="empty-state">目前沒有待辦，想到什麼就記下來吧。</div>`;

  els.journalInput.value = data.logs.journal[dateStr] || "";

  const mood = data.logs.moods?.[dateStr] || "";
  els.moodPicker.querySelectorAll("[data-mood]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mood === mood);
  });
}

function renderStreaks() {
  const daily = data.trackers.filter(t => t.cycle === "day");
  els.streakCards.innerHTML = daily.length
    ? daily.map(t => `
      <div class="streak-card">
        <div class="streak-top">
          <strong>${t.icon} ${escapeHtml(t.title)}</strong>
          <span class="streak-number">${currentStreak(t)} 天</span>
        </div>
        <div class="manage-meta">最佳紀錄：${bestStreak(t)} 天</div>
      </div>`).join("")
    : `<div class="empty-state">建立「每天」的追蹤項目後，這裡會顯示連續打卡。</div>`;
}

function renderPlanner() {
  document.querySelectorAll("[data-plan-view]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.planView === state.plannerMode);
  });

  if (state.plannerMode === "today") {
    const dateStr = localDate();
    const plans = getPlansForDate(dateStr);
    const trackers = getDueTrackersForDate(new Date());
    const combined = [
      ...plans.map(p => ({kind:"plan", sort:timeSortValue(p.timeMode,p.time), html:planCard(p)})),
      ...trackers.map(t => ({kind:"tracker", sort:timeSortValue(t.timeMode,t.time), html:trackerCard(t,dateStr)}))
    ].sort((a,b)=>a.sort-b.sort);

    els.plannerDisplay.innerHTML = combined.length
      ? `<div class="planner-day-list">${combined.map(x=>x.html).join("")}</div>`
      : `<div class="empty-state">今天目前沒有安排。</div>`;
    return;
  }

  const monday = startOfWeek(new Date());
  let html = `<div class="week-plan-grid">`;
  for (let i=0;i<7;i++) {
    const d = addDays(monday,i);
    const dateStr = localDate(d);
    const plans = getPlansForDate(dateStr);
    const due = getDueTrackersForDate(d);
    const itemCount = plans.length + due.length;

    const planItems = plans.map(p => `
      <div class="week-plan-item ${p.done ? "done" : ""}">
        <div class="week-plan-title">
          <span>🫧</span>
          <span>${escapeHtml(p.title)}</span>
        </div>
        <div class="week-plan-time">${timeLabel(p)}</div>
      </div>`).join("");

    const trackerItems = due.map(t => `
      <div class="week-plan-item ${getTrackerCount(t.id,dateStr)>0 ? "done" : ""}">
        <div class="week-plan-title">
          <span>${t.icon}</span>
          <span>${escapeHtml(t.title)}</span>
        </div>
        <div class="week-plan-time">${timeLabel(t)}</div>
      </div>`).join("");

    html += `<div class="week-day ${dateStr===localDate() ? "today" : ""}">
      <div class="week-day-header">
        <h3>${prettyDate(d)}</h3>
        <span class="week-day-count">${itemCount ? `${itemCount} 項` : ""}</span>
      </div>
      <div class="week-plan-list">
        ${planItems}
        ${trackerItems}
        ${itemCount===0 ? `<div class="week-empty">☁️ 今天留白，好好休息</div>` : ""}
      </div>
    </div>`;
  }
  html += `</div>`;
  els.plannerDisplay.innerHTML = html;
}

function calendarItemsForDate(date) {
  const dateStr = localDate(date);
  return [
    ...getPlansForDate(dateStr).map(p=>({icon:"🫧", title:p.title, done:p.done, type:"plan"})),
    ...getDueTrackersForDate(date).map(t=>({icon:t.icon, title:t.title, done:getTrackerCount(t.id,dateStr)>0, type:"tracker"}))
  ];
}


function moodMeta(key) {
  if (key === "happy") return { emoji: "😄", label: "開心" };
  if (key === "neutral") return { emoji: "😐", label: "普通" };
  if (key === "sad") return { emoji: "😢", label: "難過" };
  return { emoji: "☁️", label: "未記錄" };
}

function currentMonthMoodStats(ref = state.calendarCursor) {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const prefix = `${y}-${String(m+1).padStart(2,"0")}`;

  const counts = { happy: 0, neutral: 0, sad: 0 };
  for (const [date, mood] of Object.entries(data.logs.moods || {})) {
    if (date.startsWith(prefix) && counts[mood] !== undefined) counts[mood] += 1;
  }

  const total = counts.happy + counts.neutral + counts.sad;
  return { counts, total, y, m };
}

function renderMonthlyMoodSummary() {
  const { counts, total, y, m } = currentMonthMoodStats();
  els.moodMonthLabel.textContent = `${y} 年 ${m+1} 月`;

  const order = ["happy","neutral","sad"];
  els.monthlyMoodSummary.innerHTML = order.map(key => {
    const meta = moodMeta(key);
    const count = counts[key];
    const percent = total ? Math.round(count / total * 100) : 0;
    return `
      <div class="mood-summary-card">
        <div class="mood-summary-head">
          <strong>${meta.emoji} ${meta.label}</strong>
          <span class="soft-badge">${count} 天</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${percent}%"></div>
        </div>
        <div class="mood-summary-value">${percent}%</div>
      </div>`;
  }).join("");
}

function renderCalendar() {
  document.querySelectorAll("[data-calendar-mode]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.calendarMode === state.calendarMode);
  });

  const cursor = new Date(state.calendarCursor);
  const weekdays = ["一","二","三","四","五","六","日"];
  let html = weekdays.map(w=>`<div class="weekday">${w}</div>`).join("");

  if (state.calendarMode === "week") {
    const monday = startOfWeek(cursor);
    const sunday = addDays(monday,6);
    els.calendarTitle.textContent = `🗓️ ${monday.getMonth()+1}/${monday.getDate()}－${sunday.getMonth()+1}/${sunday.getDate()}`;

    for (let i=0;i<7;i++) {
      const d = addDays(monday,i);
      const items = calendarItemsForDate(d);
      html += calendarDayCell(d, items);
    }
  } else {
    const y = cursor.getFullYear(), m = cursor.getMonth();
    els.calendarTitle.textContent = `🗓️ ${y} 年 ${m+1} 月`;
    const first = new Date(y,m,1);
    const firstIndex = (first.getDay()+6)%7;
    for (let i=0;i<firstIndex;i++) html += `<div class="day-cell empty"></div>`;
    const lastDay = new Date(y,m+1,0).getDate();
    for (let day=1;day<=lastDay;day++) {
      const d = new Date(y,m,day);
      html += calendarDayCell(d, calendarItemsForDate(d));
    }
  }

  els.calendarGrid.innerHTML = html;
  renderSelectedDate();
  renderMonthlyMoodSummary();
}

function calendarDayCell(date, items) {
  const ds = localDate(date);
  const selected = ds === localDate(state.selectedDate);
  const today = ds === localDate();
  const allDone = items.length > 0 && items.every(item => item.done);
  const mood = data.logs.moods?.[ds] || "";
  const moodEmoji = mood ? moodMeta(mood).emoji : "";
  const historical = dateHistoryActivities(ds);
  const activityIcons = [...new Set(historical.map(item => item.icon))].slice(0, 2);

  return `<div class="day-cell ${today?"today":""} ${selected?"selected":""} ${(items.length || historical.length)?"has-items":""}" data-action="select-date" data-date="${ds}">
    <div class="day-number-row">
      <div class="day-number">${date.getDate()}</div>
      ${moodEmoji ? `<span class="day-mood" aria-label="當日心情">${moodEmoji}</span>` : ""}
    </div>
    ${activityIcons.length ? `<div class="day-activity-icons" aria-label="當日活動">${activityIcons.join(" ")}</div>` : `<div class="day-activity-icons"></div>`}
    ${allDone ? `<div class="day-complete" aria-label="當日已全部完成">✓</div>` : ""}
  </div>`;
}

function renderSelectedDate() {
  const d = new Date(state.selectedDate);
  const ds = localDate(d);
  const plans = getPlansForDate(ds);
  const trackers = getDueTrackersForDate(d);

  const journal = data.logs.journal?.[ds] || "";
  const mood = data.logs.moods?.[ds] || "";
  const meta = moodMeta(mood);
  const titleMood = mood ? `${meta.emoji} ` : "☁️ ";
  els.selectedDateTitle.textContent = `${titleMood}${d.getMonth()+1} 月 ${d.getDate()} 日（${weekdayText(d.getDay())}）`;

  if (journal || mood) {
    els.selectedDateJournal.classList.remove("hidden");
    els.selectedDateMood.textContent = meta.emoji;
    els.selectedDateJournalText.textContent = journal || `今天心情：${meta.label}`;
  } else {
    els.selectedDateJournal.classList.add("hidden");
    els.selectedDateMood.textContent = "";
    els.selectedDateJournalText.textContent = "";
  }

  const activities = dateHistoryActivities(ds);
  if (activities.length) {
    els.selectedDateActivity.classList.remove("hidden");
    els.selectedDateActivityList.innerHTML = activities.map(historyEventCard).join("");
  } else {
    els.selectedDateActivity.classList.add("hidden");
    els.selectedDateActivityList.innerHTML = "";
  }

  const detailHtml = [
    ...plans.map(planCard),
    ...trackers.map(t=>trackerCard(t,ds))
  ];
  els.selectedDateDetail.innerHTML = detailHtml.length ? detailHtml.join("") : `<div class="empty-state">這天沒有固定安排或打卡項目。</div>`;
}

function renderGoals() {
  if (!data.goals.length) {
    els.goalList.innerHTML = `<div class="empty-state">還沒有目標。可以先建立一個很想完成的小目標 🌟</div>`;
    return;
  }

  els.goalList.innerHTML = data.goals.map(g=>{
    const percent = g.target > 0 ? Math.min(100,Math.round(g.current/g.target*100)) : 0;
    return `<div class="goal-card">
      <div class="goal-head">
        <div>
          <h3>${g.period==="year" ? "🌟" : "🌙"} ${escapeHtml(g.title)}</h3>
          <div class="manage-meta">${g.period==="year" ? "年度目標" : "本月目標"}</div>
        </div>
        <span class="soft-badge">${percent}%</span>
      </div>
      <div class="goal-number">${g.current} / ${g.target} ${escapeHtml(g.unit || "")}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
      <div class="goal-actions">
        <button class="secondary-btn" data-action="goal-minus" data-id="${g.id}">－1</button>
        <button class="primary-btn" data-action="goal-plus" data-id="${g.id}">＋1</button>
        <button class="danger-btn" data-action="delete-goal" data-id="${g.id}">刪除</button>
      </div>
    </div>`;
  }).join("");
}


function bookProgressPercent(book) {
  return book.totalPages > 0
    ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
    : 0;
}

function bookLastReadLabel(book) {
  if (!book.history?.length) return "尚未開始記錄";
  const latest = [...book.history].sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
  if (!latest?.date) return "已更新閱讀進度";
  const d = parseDate(latest.date);
  return `上次閱讀：${d.getMonth()+1}/${d.getDate()}・第 ${latest.page} 頁`;
}


function formatRecordTime(timestamp) {
  if (!timestamp) return "";
  const d = new Date(Number(timestamp));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}

function bookHistoryForDate(dateStr) {
  const events = [];
  for (const book of data.books || []) {
    const rows = (book.history || []).filter(h => h.date === dateStr);
    for (const row of rows) {
      events.push({
        type: "book",
        icon: "📚",
        title: `閱讀《${book.title}》`,
        sub: `進度更新到第 ${row.page} / ${book.totalPages} 頁（${Math.min(100, Math.round((row.page / book.totalPages) * 100))}%）`,
        createdAt: row.createdAt || 0,
        done: true
      });
    }
  }
  return events.sort((a,b) => Number(b.createdAt) - Number(a.createdAt));
}

function goalHistoryForDate(dateStr) {
  const events = [];
  for (const goal of data.goals || []) {
    const rows = (goal.history || []).filter(h => h.date === dateStr && Number(h.delta || 0) > 0);
    for (const row of rows) {
      events.push({
        type: "goal",
        icon: "🎯",
        title: goal.title,
        sub: `完成 +${row.delta}${goal.unit ? ` ${goal.unit}` : ""}・目前 ${row.currentAfter ?? goal.current} / ${goal.target}${goal.unit ? ` ${goal.unit}` : ""}`,
        createdAt: row.createdAt || 0,
        done: true
      });
    }
  }
  return events.sort((a,b) => Number(b.createdAt) - Number(a.createdAt));
}

function dateHistoryActivities(dateStr) {
  return [...goalHistoryForDate(dateStr), ...bookHistoryForDate(dateStr)]
    .sort((a,b) => Number(b.createdAt) - Number(a.createdAt));
}

function renderTodayReading() {
  const books = (data.books || []).filter(book => book.currentPage < book.totalPages);
  if (!els.todayReadingList) return;

  if (!books.length) {
    els.todayReadingList.innerHTML = `<div class="empty-state">目前沒有閱讀中的書。到「目標 → 我的書房」加入一本吧 📚</div>`;
    return;
  }

  els.todayReadingList.innerHTML = books.map(book => {
    const percent = bookProgressPercent(book);
    const readToday = (book.history || []).some(h => h.date === localDate());
    return `
      <div class="today-book-card">
        <div class="today-book-top">
          <div>
            <div class="today-book-title">📖 ${escapeHtml(book.title)}</div>
            ${book.author ? `<div class="today-book-author">${escapeHtml(book.author)}</div>` : ""}
          </div>
          <span class="soft-badge">${readToday ? "今天讀過 ✓" : `${percent}%`}</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        <div class="today-book-update">
          <label class="field">
            <span>今天看到第幾頁？</span>
            <input data-today-book-page-input="${book.id}" type="number" min="0" max="${book.totalPages}" value="${book.currentPage}" />
          </label>
          <button class="primary-btn" data-action="update-today-book-page" data-id="${book.id}">更新閱讀</button>
        </div>
        <div class="today-book-meta">
          <span>${book.currentPage} / ${book.totalPages} 頁</span>
          <span>${bookLastReadLabel(book)}</span>
        </div>
      </div>`;
  }).join("");
}

function historyEventCard(event) {
  return `
    <div class="history-event-card">
      <span class="history-event-icon">${event.icon}</span>
      <div>
        <div class="history-event-title">${escapeHtml(event.title)}</div>
        <div class="history-event-sub">${escapeHtml(event.sub || "")}</div>
      </div>
    </div>`;
}

function renderGoalTabs() {
  document.querySelectorAll("[data-goal-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.goalTab === state.activeGoalTab);
  });
  els.goalsTabContent.classList.toggle("hidden", state.activeGoalTab !== "goals");
  els.libraryTabContent.classList.toggle("hidden", state.activeGoalTab !== "library");
}

function renderBooks() {
  const books = data.books || [];
  const reading = books.filter(b => b.currentPage < b.totalPages).length;
  const completed = books.filter(b => b.currentPage >= b.totalPages).length;
  els.readingSummaryBadge.textContent = `${reading} 本閱讀中・${completed} 本完成`;

  if (!books.length) {
    els.bookList.innerHTML = `<div class="empty-state">書房還是空的。先把最近想看的第一本書加進來吧 📖</div>`;
    return;
  }

  const sorted = [...books].sort((a,b) => {
    const aDone = a.currentPage >= a.totalPages ? 1 : 0;
    const bDone = b.currentPage >= b.totalPages ? 1 : 0;
    return aDone - bDone || Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  els.bookList.innerHTML = sorted.map(book => {
    const percent = bookProgressPercent(book);
    const done = percent >= 100;
    const quoteCount = book.quotes?.length || 0;
    return `
      <div class="book-card ${done ? "completed" : ""}">
        <div class="book-head">
          <div class="book-title-wrap">
            <h3 class="book-title">${done ? "✅" : "📖"} ${escapeHtml(book.title)}</h3>
            ${book.author ? `<div class="book-author">${escapeHtml(book.author)}</div>` : ""}
          </div>
          <span class="soft-badge">${percent}%</span>
        </div>

        <div class="book-progress-number">
          ${book.currentPage} / ${book.totalPages} <small>頁</small>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>

        <div class="book-update-row">
          <label class="field book-page-field">
            <span>今天看到第幾頁？</span>
            <input class="book-page-input" data-book-page-input="${book.id}" type="number" min="0" max="${book.totalPages}" value="${book.currentPage}" />
          </label>
          <button class="primary-btn" data-action="update-book-page" data-id="${book.id}">更新進度</button>
          <button class="secondary-btn" data-action="open-quotes" data-id="${book.id}">💬 佳句 ${quoteCount}</button>
        </div>

        <div class="book-meta-row">
          <span>${bookLastReadLabel(book)}</span>
          <span class="book-quote-count">${done ? "已讀完 ✨" : `還有 ${Math.max(0, book.totalPages-book.currentPage)} 頁`}</span>
        </div>
        <div class="goal-actions">
          <button class="danger-btn" data-action="delete-book" data-id="${book.id}">刪除這本書</button>
        </div>
      </div>`;
  }).join("");
}

function renderQuoteModal() {
  const book = data.books.find(b => b.id === state.activeQuoteBookId);
  if (!book) return;
  els.quoteModalTitle.textContent = `💬 ${book.title}・佳句收藏`;

  const quotes = [...(book.quotes || [])].sort((a,b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  if (els.quoteRecordCount) els.quoteRecordCount.textContent = `目前收藏 ${quotes.length} 句`;

  els.quoteList.innerHTML = quotes.length
    ? quotes.map(q => `
      <div class="quote-card">
        <div class="quote-main-row">
          <span class="quote-card-icon">💬</span>
          <p class="quote-text">「${escapeHtml(q.text)}」</p>
        </div>
        ${q.note ? `<div class="quote-note"><span>📝</span><span>${escapeHtml(q.note)}</span></div>` : ""}
        <div class="quote-detail-row">
          <span class="quote-detail-pill">📄 ${q.page ? `第 ${q.page} 頁` : "未記頁碼"}</span>
          <span class="quote-detail-pill">🕒 ${escapeHtml(formatRecordTime(q.createdAt) || "未記時間")}</span>
        </div>
        <div class="quote-meta">
          <span>📚 收藏於《${escapeHtml(book.title)}》</span>
          <button class="danger-btn" data-action="delete-quote" data-id="${q.id}" data-book-id="${book.id}">刪除</button>
        </div>
      </div>`).join("")
    : `<div class="empty-state">還沒有收藏佳句。讀到喜歡的句子就留在這裡 ✨</div>`;
}

function renderManage() {
  els.manageTrackerList.innerHTML = data.trackers.length
    ? data.trackers.map(t=>`
      <div class="manage-item">
        <div>
          <strong>${t.icon} ${escapeHtml(t.title)}</strong>
          <div class="manage-meta">${trackerCycleLabel(t)}・${timeLabel(t)}</div>
        </div>
        <div class="manage-actions">
          <button class="secondary-btn" data-action="edit-tracker" data-id="${t.id}">編輯</button>
          <button class="danger-btn" data-action="delete-tracker" data-id="${t.id}">刪除</button>
        </div>
      </div>`).join("")
    : `<div class="empty-state">還沒有追蹤項目。</div>`;

  els.manageTodoList.innerHTML = data.todos.length
    ? data.todos.map(t=>`
      <div class="manage-item">
        <div>
          <strong>📌 ${escapeHtml(t.title)}</strong>
          <div class="manage-meta">${t.done ? "已完成" : "待完成"}</div>
        </div>
        <div class="manage-actions">
          <button class="secondary-btn" data-action="edit-todo" data-id="${t.id}">編輯</button>
          <button class="danger-btn" data-action="delete-todo" data-id="${t.id}">刪除</button>
        </div>
      </div>`).join("")
    : `<div class="empty-state">目前沒有待辦。</div>`;
}



/* =========================
   Supabase V4 雲端同步
   ========================= */

function hasSupabaseConfig() {
  const cfg = window.APP_CONFIG || {};
  return Boolean(
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_PUBLISHABLE_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR_") &&
    !cfg.SUPABASE_PUBLISHABLE_KEY.includes("YOUR_")
  );
}

function setCloudStatus(kind, text, detail = "") {
  if (!els.syncStatus || !els.cloudDot) return;

  els.cloudDot.className = `cloud-dot ${kind || ""}`.trim();
  els.syncStatus.textContent = text;

  if (detail) {
    els.lastSyncText.textContent = detail;
  } else if (kind === "synced") {
    const last = localStorage.getItem(LAST_SYNC_KEY);
    els.lastSyncText.textContent = last
      ? `上次同步 ${new Date(last).toLocaleString("zh-TW", { hour12: false })}`
      : "";
  }
}

function showAuthMessage(message, isError = false) {
  if (!els.authMessage) return;
  els.authMessage.textContent = message;
  els.authMessage.classList.remove("hidden", "error");
  if (isError) els.authMessage.classList.add("error");
}

function hideAuthMessage() {
  if (!els.authMessage) return;
  els.authMessage.classList.add("hidden");
  els.authMessage.classList.remove("error");
}

function showAuthModal() {
  if (!els.authModal) return;
  cloudState.offlineMode = false;
  els.authModal.classList.remove("hidden");
}

function hideAuthModal() {
  if (!els.authModal) return;
  els.authModal.classList.add("hidden");
}

function updateAccountUI() {
  if (!els.accountEmail || !els.logoutBtn) return;

  if (cloudState.user) {
    els.accountEmail.textContent = cloudState.user.email || "已登入";
    els.logoutBtn.classList.remove("hidden");
  } else if (cloudState.offlineMode) {
    els.accountEmail.textContent = "本機模式";
    els.logoutBtn.classList.add("hidden");
  } else {
    els.accountEmail.textContent = "尚未登入";
    els.logoutBtn.classList.add("hidden");
  }
}

function scheduleCloudSave() {
  if (!cloudState.client || !cloudState.user || cloudState.offlineMode) return;

  clearTimeout(cloudState.saveTimer);
  cloudState.saveTimer = setTimeout(() => {
    pushCloudState().catch((error) => {
      console.error("Cloud save failed:", error);
    });
  }, 900);
}

async function pushCloudState({ silent = false } = {}) {
  if (!cloudState.client || !cloudState.user) return false;
  if (!navigator.onLine) {
    setCloudStatus("pending", "離線中，已存本機");
    return false;
  }

  if (cloudState.syncing) return false;
  cloudState.syncing = true;
  if (!silent) setCloudStatus("syncing", "正在同步到雲端…");

  const payload = {
    user_id: cloudState.user.id,
    data,
    updated_at: new Date().toISOString()
  };

  try {
    const { data: row, error } = await cloudState.client
      .from("user_state")
      .upsert(payload, { onConflict: "user_id" })
      .select("updated_at")
      .single();

    if (error) throw error;

    const syncedAt = row?.updated_at || new Date().toISOString();
    localStorage.setItem(LAST_SYNC_KEY, syncedAt);
    setLocalMeta({ updatedAt: Date.parse(syncedAt) || Date.now(), dirty: false });
    setCloudStatus("synced", "雲端已同步 ✓");
    return true;
  } catch (error) {
    console.error(error);
    setCloudStatus("error", "同步失敗", error?.message || "請稍後再試");
    return false;
  } finally {
    cloudState.syncing = false;
  }
}

async function fetchRemoteRow() {
  const { data: row, error } = await cloudState.client
    .from("user_state")
    .select("data, updated_at")
    .eq("user_id", cloudState.user.id)
    .maybeSingle();

  if (error) throw error;
  return row;
}

async function pullCloudState({ forceRemote = false } = {}) {
  if (!cloudState.client || !cloudState.user || !navigator.onLine) return false;
  if (cloudState.syncing) return false;

  cloudState.syncing = true;
  setCloudStatus("syncing", "正在取得最新資料…");

  try {
    const row = await fetchRemoteRow();

    // 雲端第一次還沒有資料：直接把目前本機資料建立到雲端。
    if (!row) {
      cloudState.syncing = false;
      return await pushCloudState();
    }

    const remoteTime = Date.parse(row.updated_at || "") || 0;
    const localTime = localUpdatedAt();
    const dirty = localIsDirty();

    // 本機有尚未同步的修改，而且確實比雲端新，優先上傳本機。
    if (!forceRemote && dirty && localTime > remoteTime) {
      cloudState.syncing = false;
      return await pushCloudState();
    }

    // 其他情況以雲端為準，適合新手機 / 新平板第一次登入。
    saveRemoteToLocal(row.data, row.updated_at);
    localStorage.setItem(LAST_SYNC_KEY, row.updated_at || new Date().toISOString());
    setCloudStatus("synced", "已取得雲端最新資料 ✓");
    return true;
  } catch (error) {
    console.error(error);
    setCloudStatus("error", "無法讀取雲端", error?.message || "請檢查 Supabase 設定");
    return false;
  } finally {
    cloudState.syncing = false;
  }
}

async function syncNow() {
  if (!cloudState.user) {
    if (hasSupabaseConfig()) showAuthModal();
    else setCloudStatus("error", "尚未設定 Supabase", "請先填寫 config.js");
    return;
  }

  if (!navigator.onLine) {
    setCloudStatus("pending", "目前離線", "資料仍會保存在這台裝置");
    return;
  }

  if (localIsDirty()) {
    await pushCloudState();
  } else {
    await pullCloudState();
  }
}

async function handleSignedIn(user) {
  cloudState.user = user;
  cloudState.offlineMode = false;
  updateAccountUI();
  hideAuthModal();
  await pullCloudState();

  if (cloudState.pullTimer) clearInterval(cloudState.pullTimer);
  cloudState.pullTimer = setInterval(() => {
    if (document.visibilityState === "visible" && !localIsDirty()) {
      pullCloudState().catch(console.error);
    }
  }, 45000);
}

async function initCloudSync() {
  if (!hasSupabaseConfig()) {
    setCloudStatus("error", "尚未連接 Supabase", "打開 config.js 貼上 URL 與 Publishable key");
    updateAccountUI();
    showToast("生活體驗計劃雲端同步尚未設定", "請先填寫 config.js；目前仍可使用本機資料。");
    return;
  }

  if (!window.supabase?.createClient) {
    setCloudStatus("error", "Supabase SDK 載入失敗", "請確認網路連線");
    return;
  }

  const cfg = window.APP_CONFIG;
  cloudState.client = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  cloudState.initialized = true;

  const { data: sessionData, error } = await cloudState.client.auth.getSession();

  if (error) {
    setCloudStatus("error", "登入狀態讀取失敗", error.message);
    showAuthModal();
    return;
  }

  if (sessionData?.session?.user) {
    await handleSignedIn(sessionData.session.user);
  } else {
    setCloudStatus("pending", "請登入以啟用跨裝置同步");
    updateAccountUI();
    showAuthModal();
  }

  cloudState.client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      cloudState.user = null;
      updateAccountUI();
      setCloudStatus("pending", "已登出，現在使用本機資料");
      return;
    }

    if (session?.user && (!cloudState.user || cloudState.user.id !== session.user.id)) {
      handleSignedIn(session.user).catch(console.error);
    }
  });
}

async function signIn() {
  if (!cloudState.client) return;
  hideAuthMessage();

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  if (!email || !password) {
    showAuthMessage("請輸入 Email 和密碼。", true);
    return;
  }

  els.signInBtn.disabled = true;
  els.signInBtn.textContent = "登入中…";

  try {
    const { data: result, error } = await cloudState.client.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (result?.user) await handleSignedIn(result.user);
  } catch (error) {
    showAuthMessage(error?.message || "登入失敗，請檢查 Email 或密碼。", true);
  } finally {
    els.signInBtn.disabled = false;
    els.signInBtn.textContent = "登入";
  }
}

async function signUp() {
  if (!cloudState.client) return;
  hideAuthMessage();

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;

  if (!email || !password) {
    showAuthMessage("請輸入要使用的 Email 和密碼。", true);
    return;
  }

  if (password.length < 6) {
    showAuthMessage("密碼請至少輸入 6 碼。", true);
    return;
  }

  els.signUpBtn.disabled = true;
  els.signUpBtn.textContent = "建立中…";

  try {
    const { data: result, error } = await cloudState.client.auth.signUp({
      email,
      password
    });

    if (error) throw error;

    if (result?.session?.user) {
      showAuthMessage("帳號建立成功，已登入！");
      await handleSignedIn(result.session.user);
    } else {
      showAuthMessage("帳號已建立。請先到 Email 收信完成驗證，再回來登入。");
    }
  } catch (error) {
    showAuthMessage(error?.message || "建立帳號失敗。", true);
  } finally {
    els.signUpBtn.disabled = false;
    els.signUpBtn.textContent = "第一次使用：建立帳號";
  }
}

async function signOut() {
  if (!cloudState.client) return;

  // 登出前盡量先把最後修改送上雲端。
  if (localIsDirty()) await pushCloudState({ silent: true });

  await cloudState.client.auth.signOut();
  cloudState.user = null;
  cloudState.offlineMode = true;
  updateAccountUI();
  setCloudStatus("pending", "已登出，使用本機模式");
}


function reminderMinuteValue(mode, time) {
  if (mode === "morning") return 8 * 60;
  if (mode === "afternoon") return 15 * 60;
  if (mode === "evening") return 19 * 60;
  if (mode === "specific" && time) {
    const [h,m] = time.split(":").map(Number);
    return h * 60 + m;
  }
  return null;
}

function showToast(title, body) {
  if (!els.toastHost) return;
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(body)}</small>`;
  els.toastHost.appendChild(node);
  setTimeout(() => node.remove(), 6000);
}

function showReminder(title, body) {
  showToast(title, body);

  if (
    data.notificationSettings.enabled &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    try {
      new Notification(title, { body });
    } catch (_) {}
  }
}

function updateNotificationUI() {
  if (!els.notificationStatus) return;

  els.reminderLead.value = String(data.notificationSettings.leadMinutes ?? 15);

  if (!("Notification" in window)) {
    els.notificationStatus.textContent = "瀏覽器不支援";
    els.enableNotificationsBtn.disabled = true;
    return;
  }

  if (!window.isSecureContext) {
    els.notificationStatus.textContent = "App 內提醒可用";
    els.enableNotificationsBtn.textContent = "系統通知需 HTTPS";
    return;
  }

  if (Notification.permission === "granted" && data.notificationSettings.enabled) {
    els.notificationStatus.textContent = "已開啟";
    els.enableNotificationsBtn.textContent = "通知已開啟";
  } else if (Notification.permission === "denied") {
    els.notificationStatus.textContent = "已被瀏覽器封鎖";
    els.enableNotificationsBtn.textContent = "通知被封鎖";
  } else {
    els.notificationStatus.textContent = "尚未開啟";
    els.enableNotificationsBtn.textContent = "開啟通知";
  }
}

function clearReminderTimers() {
  for (const id of state.reminderTimerIds) clearTimeout(id);
  state.reminderTimerIds = [];
}

function scheduleTodayReminders() {
  clearReminderTimers();

  const now = new Date();
  const todayStr = localDate(now);
  const lead = Number(data.notificationSettings.leadMinutes || 0);

  const jobs = [];

  for (const plan of getPlansForDate(todayStr)) {
    if (plan.done) continue;
    const minute = reminderMinuteValue(plan.timeMode, plan.time);
    if (minute == null) continue;
    jobs.push({
      title: `🫧 ${plan.title}`,
      body: `${timeLabel(plan)} 的生活規劃快到了`,
      minute
    });
  }

  for (const tracker of getDueTrackersForDate(now)) {
    if (getTrackerCount(tracker.id, todayStr) > 0) continue;
    const minute = reminderMinuteValue(tracker.timeMode, tracker.time);
    if (minute == null) continue;
    jobs.push({
      title: `${tracker.icon} ${tracker.title}`,
      body: `${timeLabel(tracker)} 的打卡時間快到了`,
      minute
    });
  }

  for (const job of jobs) {
    const target = new Date(now);
    target.setHours(Math.floor(job.minute / 60), job.minute % 60, 0, 0);
    target.setMinutes(target.getMinutes() - lead);

    const delay = target.getTime() - now.getTime();
    if (delay <= 0 || delay > 24 * 60 * 60 * 1000) continue;

    const timerId = setTimeout(() => {
      showReminder("生活體驗計劃提醒", `${job.title}｜${job.body}`);
    }, delay);

    state.reminderTimerIds.push(timerId);
  }
}

function renderAll() {
  renderHeader();
  renderToday();
  renderTodayReading();
  renderStreaks();
  renderPlanner();
  renderCalendar();
  renderGoals();
  renderGoalTabs();
  renderBooks();
  renderManage();
  updateNotificationUI();
  scheduleTodayReminders();
}

function showView(viewId) {
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.view===viewId));
  document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id===viewId));
}

function updateTrackerCycleFields() {
  const cycle = els.trackerCycle.value;
  els.weekCycleFields.classList.toggle("hidden", cycle!=="week");
  els.monthCycleFields.classList.toggle("hidden", cycle!=="month");
  els.customCycleFields.classList.toggle("hidden", cycle!=="custom");
}

function updateTrackerTimeField() {
  els.trackerSpecificTimeField.classList.toggle("hidden", els.trackerTimeMode.value!=="specific");
}

function updatePlanTimeField() {
  els.planSpecificTimeField.classList.toggle("hidden", els.planTimeMode.value!=="specific");
}

function addTodo(title) {
  const clean = title.trim();
  if (!clean) return false;
  data.todos.unshift({id:uid(),title:clean,done:false,createdAt:Date.now()});
  saveData();
  renderAll();
  return true;
}

document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click",()=>showView(btn.dataset.view));
});

document.body.addEventListener("click",(e)=>{
  const rawTarget = e.target;
  const t = rawTarget.closest?.("[data-action], [data-go-view], [data-close-modal], [data-mood]") || rawTarget;
  const moodButton = t.closest?.("[data-mood]");
  const openModalButton = t.closest?.("[data-open-modal]");

  if (openModalButton) {
    const modalId = openModalButton.dataset.openModal;
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove("hidden");
    return;
  }

  if (moodButton) {
    const mood = moodButton.dataset.mood;
    const dateStr = localDate();
    if (!data.logs.moods) data.logs.moods = {};
    data.logs.moods[dateStr] = data.logs.moods[dateStr] === mood ? "" : mood;
    saveData();
    renderAll();
    return;
  }

  if (t.dataset.goView) {
    showView(t.dataset.goView);
    return;
  }

  if (t.dataset.closeModal) {
    $(t.dataset.closeModal).classList.add("hidden");
    return;
  }

  const action = t.dataset.action;
  const id = t.dataset.id;
  if (!action) return;

  if (action==="open-library-tab") {
    state.activeGoalTab = "library";
    showView("goalsView");
    renderGoalTabs();
    return;
  }

  if (action==="update-today-book-page") {
    const book = data.books.find(b => b.id === id);
    const input = document.querySelector(`[data-today-book-page-input="${id}"]`);
    if (book && input) {
      const page = Math.min(book.totalPages, Math.max(0, Number(input.value) || 0));
      book.currentPage = page;
      const today = localDate();
      const existing = book.history.find(h => h.date === today);
      if (existing) {
        existing.page = page;
        existing.createdAt = Date.now();
      } else {
        book.history.push({ date: today, page, createdAt: Date.now() });
      }
      book.finishedAt = page >= book.totalPages ? (book.finishedAt || Date.now()) : null;
      saveData();
      renderAll();
      showToast("今日閱讀已更新 📚", `${book.title}：第 ${page} / ${book.totalPages} 頁`);
    }
    return;
  }

  if (action==="toggle-tracker-button") {
    const dateStr = t.dataset.date;
    const next = getTrackerCount(id, dateStr) > 0 ? 0 : 1;
    ensureTrackerLog(id);
    data.logs.trackers[id][dateStr] = next;
    saveData();
    renderAll();
    return;
  }

  if (action==="toggle-todo-button") {
    const todo = data.todos.find(x => x.id === id);
    if (todo) {
      todo.done = !todo.done;
      saveData();
      renderAll();
    }
    return;
  }

  if (action==="update-book-page") {
    const book = data.books.find(b => b.id === id);
    const input = document.querySelector(`[data-book-page-input="${id}"]`);
    if (book && input) {
      const page = Math.min(book.totalPages, Math.max(0, Number(input.value) || 0));
      book.currentPage = page;
      const today = localDate();
      const existing = book.history.find(h => h.date === today);
      if (existing) {
        existing.page = page;
        existing.createdAt = Date.now();
      } else {
        book.history.push({ date: today, page, createdAt: Date.now() });
      }
      book.finishedAt = page >= book.totalPages ? (book.finishedAt || Date.now()) : null;
      saveData();
      renderAll();
      showToast("閱讀進度已更新 📖", `${book.title}：第 ${page} / ${book.totalPages} 頁`);
    }
    return;
  }

  if (action==="open-quotes") {
    state.activeQuoteBookId = id;
    els.quoteText.value = "";
    els.quotePage.value = "";
    els.quoteNote.value = "";
    renderQuoteModal();
    const book = data.books.find(x => x.id === id);
    if (book && els.addQuoteModalTitle) els.addQuoteModalTitle.textContent = `✍️ ${book.title}・新增佳句`;
    els.quoteModal.classList.remove("hidden");
    return;
  }

  if (action==="delete-book") {
    const book = data.books.find(b => b.id === id);
    if (book && confirm(`確定要刪除「${book.title}」和裡面的佳句嗎？`)) {
      data.books = data.books.filter(b => b.id !== id);
      saveData();
      renderAll();
    }
    return;
  }

  if (action==="delete-quote") {
    const book = data.books.find(b => b.id === t.dataset.bookId);
    if (book) {
      book.quotes = (book.quotes || []).filter(q => q.id !== id);
      saveData();
      renderQuoteModal();
      renderBooks();
    }
    return;
  }

  if (action==="delete-plan") {
    data.plans = data.plans.filter(p=>p.id!==id);
  }

  if (action==="delete-todo") {
    data.todos = data.todos.filter(x=>x.id!==id);
  }

  if (action==="delete-tracker") {
    data.trackers = data.trackers.filter(x=>x.id!==id);
    delete data.logs.trackers[id];
  }

  if (action==="goal-plus" || action==="goal-minus") {
    const g = data.goals.find(x=>x.id===id);
    if (g) {
      const delta = action === "goal-plus" ? 1 : -1;
      const before = g.current;
      g.current = Math.max(0, g.current + delta);
      if (!Array.isArray(g.history)) g.history = [];
      if (delta > 0 && g.current > before) {
        g.history.push({
          id: uid(), date: localDate(), delta: 1,
          currentAfter: g.current, createdAt: Date.now()
        });
      }
    }
  }

  if (action==="delete-goal") {
    data.goals = data.goals.filter(x=>x.id!==id);
  }

  if (action==="select-date") {
    state.selectedDate = parseDate(t.dataset.date);
    renderCalendar();
    return;
  }

  if (action==="edit-tracker") {
    const tr = data.trackers.find(x=>x.id===id);
    if (tr) {
      state.editingTrackerId = id;
      els.editTrackerTitle.value = tr.title;
      els.editTrackerIcon.value = tr.icon;
      els.editTrackerModal.classList.remove("hidden");
    }
    return;
  }

  if (action==="edit-todo") {
    const todo = data.todos.find(x=>x.id===id);
    if (todo) {
      state.editingTodoId = id;
      els.editTodoTitle.value = todo.title;
      els.editTodoModal.classList.remove("hidden");
    }
    return;
  }

  saveData();
  renderAll();
});

document.body.addEventListener("change",(e)=>{
  const t = e.target;
  const action = t.dataset.action;
  const id = t.dataset.id;

  if (action==="toggle-plan") {
    const p = data.plans.find(x=>x.id===id);
    if (p) p.done = t.checked;
  }

  if (action==="toggle-todo") {
    const todo = data.todos.find(x=>x.id===id);
    if (todo) todo.done = t.checked;
  }

  if (action==="toggle-tracker") {
    ensureTrackerLog(id);
    data.logs.trackers[id][t.dataset.date] = t.checked ? 1 : 0;
    saveData();
    renderAll();
    return;
  }

  saveData();
  renderAll();
});

els.quickTodoBtn.addEventListener("click",()=>{
  if (addTodo(els.quickTodoInput.value)) {
    els.quickTodoInput.value = "";
    els.quickTodoInput.focus();
  }
});

els.quickTodoInput.addEventListener("keydown",(e)=>{
  if (e.key==="Enter") {
    e.preventDefault();
    els.quickTodoBtn.click();
  }
});

els.journalInput.addEventListener("input",()=>{
  data.logs.journal[localDate()] = els.journalInput.value;
  saveData();
});

els.planTimeMode.addEventListener("change",updatePlanTimeField);
els.trackerCycle.addEventListener("change",updateTrackerCycleFields);
els.trackerTimeMode.addEventListener("change",updateTrackerTimeField);

els.addPlanBtn.addEventListener("click",()=>{
  const title = els.planTitle.value.trim();
  if (!title) return alert("請先輸入想安排的事情喔！");
  data.plans.push({
    id:uid(),
    title,
    date:els.planDate.value || localDate(),
    timeMode:els.planTimeMode.value,
    time:els.planTimeMode.value==="specific" ? els.planSpecificTime.value : "",
    done:false,
    createdAt:Date.now()
  });
  els.planTitle.value="";
  document.getElementById("addPlanModal")?.classList.add("hidden");
  saveData();
  renderAll();
});

document.querySelectorAll("[data-plan-view]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    state.plannerMode = btn.dataset.planView;
    renderPlanner();
  });
});

document.querySelectorAll("[data-goal-tab]").forEach(btn => {
  btn.addEventListener("click", () => {
    state.activeGoalTab = btn.dataset.goalTab;
    renderGoalTabs();
  });
});

document.querySelectorAll("[data-calendar-mode]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    state.calendarMode = btn.dataset.calendarMode;
    renderCalendar();
  });
});

els.calendarPrev.addEventListener("click",()=>{
  state.calendarCursor = state.calendarMode==="week"
    ? addDays(state.calendarCursor,-7)
    : new Date(state.calendarCursor.getFullYear(),state.calendarCursor.getMonth()-1,1);
  renderCalendar();
});

els.calendarNext.addEventListener("click",()=>{
  state.calendarCursor = state.calendarMode==="week"
    ? addDays(state.calendarCursor,7)
    : new Date(state.calendarCursor.getFullYear(),state.calendarCursor.getMonth()+1,1);
  renderCalendar();
});

els.calendarToday.addEventListener("click",()=>{
  state.calendarCursor = new Date();
  state.selectedDate = new Date();
  renderCalendar();
});

els.addGoalBtn.addEventListener("click",()=>{
  const title = els.goalTitle.value.trim();
  const target = Math.max(1,Number(els.goalTarget.value)||1);
  if (!title) return alert("請先輸入目標名稱喔！");
  data.goals.unshift(normalizeGoal({
    id:uid(),
    title,
    period:els.goalPeriod.value,
    unit:els.goalUnit.value.trim(),
    target,
    current:Math.max(0,Number(els.goalCurrent.value)||0),
    createdAt:Date.now(),
    history: []
  }));
  els.goalTitle.value="";
  els.goalUnit.value="";
  els.goalCurrent.value=0;
  document.getElementById("addGoalModal")?.classList.add("hidden");
  saveData();
  renderAll();
});

els.addBookBtn.addEventListener("click", () => {
  const title = els.bookTitle.value.trim();
  const author = els.bookAuthor.value.trim();
  const totalPages = Math.max(1, Number(els.bookTotalPages.value) || 0);
  const currentPage = Math.min(totalPages, Math.max(0, Number(els.bookCurrentPage.value) || 0));

  if (!title) return alert("請先輸入書名喔！");
  if (!Number(els.bookTotalPages.value) || Number(els.bookTotalPages.value) < 1) {
    return alert("請輸入這本書的總頁數喔！");
  }

  const book = normalizeBook({
    id: uid(), title, author, totalPages, currentPage,
    createdAt: Date.now(),
    history: currentPage > 0 ? [{ date: localDate(), page: currentPage, createdAt: Date.now() }] : [],
    quotes: []
  });
  if (currentPage >= totalPages) book.finishedAt = Date.now();
  data.books.unshift(book);

  els.bookTitle.value = "";
  els.bookAuthor.value = "";
  els.bookTotalPages.value = "";
  els.bookCurrentPage.value = 0;
  document.getElementById("addBookModal")?.classList.add("hidden");
  saveData();
  renderAll();
});

els.openAddQuoteBtn.addEventListener("click",()=>{
  const book = data.books.find(x=>x.id===state.activeQuoteBookId);
  if (!book) return;
  els.quoteText.value = "";
  els.quotePage.value = "";
  els.quoteNote.value = "";
  if (els.addQuoteModalTitle) els.addQuoteModalTitle.textContent = `✍️ ${book.title}・新增佳句`;
  els.addQuoteModal.classList.remove("hidden");
  setTimeout(()=>els.quoteText.focus(), 50);
});

els.addQuoteBtn.addEventListener("click", () => {
  const book = data.books.find(b => b.id === state.activeQuoteBookId);
  if (!book) return;
  const text = els.quoteText.value.trim();
  if (!text) return alert("先輸入想收藏的佳句喔！");

  const page = Math.max(0, Number(els.quotePage.value) || 0);
  const note = els.quoteNote.value.trim();
  if (!Array.isArray(book.quotes)) book.quotes = [];
  book.quotes.unshift({
    id: uid(), text, page: page || null, note,
    createdAt: Date.now()
  });
  els.quoteText.value = "";
  els.quotePage.value = "";
  els.quoteNote.value = "";
  els.addQuoteModal.classList.add("hidden");
  saveData();
  renderQuoteModal();
  renderBooks();
});

els.addTrackerBtn.addEventListener("click",()=>{
  const title = els.trackerTitle.value.trim();
  if (!title) return alert("請先輸入追蹤項目名稱喔！");

  const weekdays = [...els.weekdayPicker.querySelectorAll("input:checked")].map(x=>Number(x.value));
  const tracker = normalizeTracker({
    id:uid(),
    icon:els.trackerIcon.value,
    title,
    cycle:els.trackerCycle.value,
    weeklyTarget:Number(els.weeklyTarget.value)||1,
    weekdays,
    monthDay:Number(els.monthDay.value)||1,
    intervalDays:Number(els.customIntervalDays.value)||1,
    startDate:els.customStartDate.value || localDate(),
    timeMode:els.trackerTimeMode.value,
    time:els.trackerTimeMode.value==="specific" ? els.trackerSpecificTime.value : "",
    createdAt:Date.now()
  });

  data.trackers.unshift(tracker);
  els.trackerTitle.value="";
  els.weekdayPicker.querySelectorAll("input").forEach(x=>x.checked=false);
  document.getElementById("addTrackerModal")?.classList.add("hidden");
  saveData();
  renderAll();
});

els.saveTrackerEditBtn.addEventListener("click",()=>{
  const tr = data.trackers.find(x=>x.id===state.editingTrackerId);
  if (!tr) return;
  const title = els.editTrackerTitle.value.trim();
  if (!title) return alert("名稱不能空白喔！");
  tr.title = title;
  tr.icon = els.editTrackerIcon.value;
  els.editTrackerModal.classList.add("hidden");
  saveData();
  renderAll();
});


els.reminderLead.addEventListener("change", () => {
  data.notificationSettings.leadMinutes = Number(els.reminderLead.value || 0);
  saveData();
  scheduleTodayReminders();
});

els.enableNotificationsBtn.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    showToast("通知功能", "這個瀏覽器目前不支援系統通知。");
    return;
  }

  if (!window.isSecureContext) {
    data.notificationSettings.enabled = true;
    saveData();
    updateNotificationUI();
    showToast("App 內提醒已啟用", "目前是本機檔案模式；上線 HTTPS 後即可開啟系統通知。");
    scheduleTodayReminders();
    return;
  }

  try {
    const permission = await Notification.requestPermission();
    data.notificationSettings.enabled = permission === "granted";
    saveData();
    updateNotificationUI();
    scheduleTodayReminders();

    if (permission === "granted") {
      showReminder("通知已開啟 ✓", "之後有設定時段的項目，會依提前時間提醒妳。");
    } else {
      showToast("通知未開啟", "可以到瀏覽器網站權限重新允許通知。");
    }
  } catch (_) {
    showToast("通知開啟失敗", "瀏覽器目前無法取得通知權限。");
  }
});

els.testNotificationBtn.addEventListener("click", () => {
  showReminder("生活體驗計劃測試提醒", "如果看到這則訊息，App 內提醒正常運作 ✨");
});

els.saveTodoEditBtn.addEventListener("click",()=>{
  const todo = data.todos.find(x=>x.id===state.editingTodoId);
  if (!todo) return;
  const title = els.editTodoTitle.value.trim();
  if (!title) return alert("待辦內容不能空白喔！");
  todo.title = title;
  els.editTodoModal.classList.add("hidden");
  saveData();
  renderAll();
});


/* V4 雲端帳號 / 同步 */
els.syncNowBtn.addEventListener("click", () => {
  syncNow().catch(console.error);
});

els.logoutBtn.addEventListener("click", () => {
  signOut().catch(console.error);
});

els.signInBtn.addEventListener("click", () => {
  signIn().catch(console.error);
});

els.signUpBtn.addEventListener("click", () => {
  signUp().catch(console.error);
});

els.offlineModeBtn.addEventListener("click", () => {
  cloudState.offlineMode = true;
  hideAuthModal();
  updateAccountUI();
  setCloudStatus("pending", "目前使用本機模式", "之後仍可登入啟用同步");
});

els.authPassword.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    signIn().catch(console.error);
  }
});

window.addEventListener("online", () => {
  if (cloudState.user) {
    setCloudStatus("syncing", "網路已恢復，正在同步…");
    syncNow().catch(console.error);
  }
});

window.addEventListener("offline", () => {
  setCloudStatus("pending", "目前離線，資料已保存在本機");
});

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    cloudState.user &&
    navigator.onLine
  ) {
    syncNow().catch(console.error);
  }
});

document.querySelectorAll(".modal-backdrop").forEach(modal=>{
  modal.addEventListener("click",(e)=>{
    if (e.target===modal) modal.classList.add("hidden");
  });
});

updateTrackerCycleFields();
updateTrackerTimeField();
updatePlanTimeField();
renderAll();
initCloudSync().catch((error) => {
  console.error(error);
  setCloudStatus("error", "雲端初始化失敗", error?.message || "");
});

/* PWA：上線到 HTTPS 後可加到手機 / 平板主畫面 */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
