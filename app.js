/* ──────────────────────────────────────────────────────────────
   JMNG TERMINAL · app.js
   Vanilla rendering for the post-flow monitor
   ────────────────────────────────────────────────────────────── */

const fmt = new Intl.NumberFormat("ko-KR");
const fmtCompact = new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 });

const TYPE_COLORS = {
  "정치 메시지":     "var(--amber)",
  "민생·경제":       "var(--green)",
  "역사·민주주의":   "var(--violet)",
  "외교·안보":       "var(--cyan)",
  "지역":            "var(--yellow)",
  "검증 요청":       "var(--red)",
  "사법·권력기관":   "var(--magenta)",
  "사회안전·법질서": "var(--red)",
  "국정운영·행정":   "var(--amber)",
  "기념·문화소통":   "var(--yellow)",
  "언론·여론대응":   "var(--magenta)",
};

const TYPE_CODE = {
  "정치 메시지":     "POL",
  "민생·경제":       "ECO",
  "역사·민주주의":   "HST",
  "외교·안보":       "DPL",
  "지역":            "REG",
  "검증 요청":       "VRF",
  "사법·권력기관":   "JUD",
  "사회안전·법질서": "LAW",
  "국정운영·행정":   "ADM",
  "기념·문화소통":   "CUL",
  "언론·여론대응":   "MED",
};

const state = {
  rawData: null,      // original briefing.json (never mutated)
  data: null,         // scoped derived view
  q: "",
  types: new Set(),   // multi-select type filter
  sort: "recent",
  view: "list",       // "list" | "grid"
  visibleCount: 50,
  selectedId: null,
  dateRange: null,    // [startMs, endMs] | null
};

function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.has("q"))     state.q = p.get("q");
  if (p.has("types")) state.types = new Set(p.get("types").split(",").filter(Boolean));
  if (p.has("type") && !state.types.size) state.types.add(p.get("type")); // legacy
  if (p.has("sort"))  state.sort = p.get("sort");
  if (p.has("view"))  state.view = p.get("view");
  if (p.has("dr")) {
    const parts = p.get("dr").split(",").map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) state.dateRange = parts;
  }
  return p.get("id");
}
function syncURL() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.types.size) p.set("types", [...state.types].join(","));
  if (state.sort && state.sort !== "recent") p.set("sort", state.sort);
  if (state.view && state.view !== "list") p.set("view", state.view);
  if (state.dateRange) p.set("dr", state.dateRange.join(","));
  if (state.selectedId) p.set("id", state.selectedId);
  const qs = p.toString();
  history.replaceState(null, "", qs ? "?" + qs : location.pathname);
}

/* Recompute aggregates under current dateRange */
function scopeData() {
  const raw = state.rawData;
  let tweets = raw.tweets;
  if (state.dateRange) {
    const [s, e] = state.dateRange;
    tweets = tweets.filter(t => {
      const ts = new Date(t.created_at).getTime();
      return ts >= s && ts <= e;
    });
  }
  const byType = {}, byMonth = {}, kwCount = {};
  tweets.forEach(t => {
    byType[t.type] = (byType[t.type] || 0) + 1;
    byMonth[t.date.slice(0, 7)] = (byMonth[t.date.slice(0, 7)] || 0) + 1;
    (t.keywords || []).forEach(k => (kwCount[k] = (kwCount[k] || 0) + 1));
  });
  const topKeywords = Object.entries(kwCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([term, count]) => ({ term, count }));
  state.data = {
    ...raw,
    tweets,
    count: tweets.length,
    byType,
    byMonth,
    topKeywords,
    oldest: tweets.length ? tweets[tweets.length - 1].created_at : raw.oldest,
    newest: tweets.length ? tweets[0].created_at : raw.newest,
  };
}

function rerenderScoped() {
  scopeData();
  const stats = buildStats(state.data);
  renderKPIs(state.data, stats);
  renderDayHourHeat(state.data);
  renderLead();
  renderActivity(stats);
  renderKeywords();
  renderRank();
  renderTopics();
  renderFeed();
  renderGraphPanel();
  if (typeof renderCohort === "function") renderCohort();
  if (typeof renderTransition === "function") renderTransition();
  updateScopeBadge();
  syncURL();
}

function updateScopeBadge() {
  const el = $("scope-badge");
  if (!el) return;
  if (!state.dateRange) {
    el.textContent = "SCOPE · ALL";
    el.classList.remove("active");
  } else {
    const [s, e] = state.dateRange;
    const f = ms => new Date(ms).toISOString().slice(0, 10);
    el.textContent = `SCOPE · ${f(s)} → ${f(e)} · ${fmt.format(state.data.count)} posts`;
    el.classList.add("active");
  }
}

const $ = id => document.getElementById(id);
const el = (tag, props = {}, children = []) => {
  const n = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") n.className = v;
    else if (k === "style") Object.assign(n.style, v);
    else if (k === "data") Object.entries(v).forEach(([dk, dv]) => (n.dataset[dk] = dv));
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return n;
};

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

const stripUrls = s => String(s || "").replace(/https?:\/\/\S+/g, "").trim();

function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return safe.replace(new RegExp(escaped, "gi"), m => `<mark>${m}</mark>`);
}

function metricScore(t) {
  const m = t.metrics || {};
  return (m.like_count || 0) + (m.retweet_count || 0) * 2 + (m.reply_count || 0) * 3;
}

function kstDate(iso) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(iso));
}
function kstHour(iso) {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hour12: false }).format(new Date(iso));
  return parseInt(h, 10) % 24;
}

/* ─── DATA ENRICHMENT ───────────────────────────────────────── */

function buildStats(data) {
  const dayCounts = new Map();
  const hourCounts = new Array(24).fill(0);
  let eng = 0, imp = 0, mediaCount = 0;
  data.tweets.forEach(t => {
    const d = kstDate(t.created_at);
    dayCounts.set(d, (dayCounts.get(d) || 0) + 1);
    hourCounts[kstHour(t.created_at)] += 1;
    const m = t.metrics || {};
    eng += (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
    imp += (m.impression_count || 0);
    if (t.media && t.media.length) mediaCount += 1;
  });
  const days = [...dayCounts.keys()].sort();
  let longest = 0, run = 0, prev = null;
  days.forEach(d => {
    if (prev) {
      const nx = new Date(prev + "T00:00:00Z");
      nx.setUTCDate(nx.getUTCDate() + 1);
      const nxKey = nx.toISOString().slice(0, 10);
      run = nxKey === d ? run + 1 : 1;
    } else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  });

  // Weekly series for sparklines
  const weekMs = 7 * 86400000;
  const startMs = new Date(data.oldest).getTime();
  const endMs = new Date(data.newest).getTime();
  const weekCount = Math.max(1, Math.ceil((endMs - startMs) / weekMs));
  const weekly = Array.from({ length: weekCount }, () => ({
    posts: 0, engagement: 0, impressions: 0, media: 0, days: new Set(),
  }));
  data.tweets.forEach(t => {
    const idx = Math.min(weekCount - 1, Math.max(0, Math.floor((new Date(t.created_at).getTime() - startMs) / weekMs)));
    const w = weekly[idx];
    w.posts += 1;
    w.days.add(t.date);
    const m = t.metrics || {};
    w.engagement += (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
    w.impressions += m.impression_count || 0;
    if (t.media && t.media.length) w.media += 1;
  });
  const series = {
    posts:       weekly.map(w => w.posts),
    activeDays:  weekly.map(w => w.days.size),
    avgEng:      weekly.map(w => (w.posts ? Math.round(w.engagement / w.posts) : 0)),
    impressions: weekly.map(w => w.impressions),
    mediaPct:    weekly.map(w => (w.posts ? Math.round(w.media / w.posts * 100) : 0)),
  };

  // Monthly by type — for stacked area
  const monthlyByType = new Map();
  data.tweets.forEach(t => {
    const m = t.date.slice(0, 7);
    if (!monthlyByType.has(m)) monthlyByType.set(m, {});
    monthlyByType.get(m)[t.type] = (monthlyByType.get(m)[t.type] || 0) + 1;
  });
  const monthly = [...monthlyByType.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Per-type engagement baselines for breakout detection
  const byType = new Map();
  data.tweets.forEach(t => {
    if (!byType.has(t.type)) byType.set(t.type, []);
    byType.get(t.type).push(metricScore(t));
  });
  const baselines = new Map();
  byType.forEach((arr, type) => {
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    baselines.set(type, { mean: m, std: Math.sqrt(v), n: arr.length });
  });
  data.tweets.forEach(t => {
    const b = baselines.get(t.type);
    t._score = metricScore(t);
    t._z = b && b.std ? (t._score - b.mean) / b.std : 0;
    t._breakout = t._z >= 2;
  });

  return {
    dayCounts, hourCounts, eng, imp, mediaCount,
    activeDays: dayCounts.size, longest,
    totalDays: Math.max(1, Math.round((new Date(data.newest) - new Date(data.oldest)) / 86400000)),
    series, monthly, baselines,
  };
}

/* ─── STATUS RAIL ───────────────────────────────────────────── */

function renderRail(data, stats) {
  const newest = new Date(data.newest);
  const newestStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(newest).replace(",", "");
  $("rail-last").innerHTML = `<span class="amber mono">LAST</span> ${newestStr} KST`;
  $("rail-count").innerHTML = `<span class="dim">N=</span><b class="mono">${fmt.format(data.count)}</b>`;
  $("rail-range").innerHTML = `<span class="dim">RUN</span> <b class="mono">${data.oldest.slice(0,10)} → ${data.newest.slice(0,10)}</b>`;
  $("rail-eng").innerHTML = `<span class="dim">ENG Σ</span> <b class="mono">${fmtCompact.format(stats.eng)}</b>`;
  $("rail-imp").innerHTML = `<span class="dim">IMP Σ</span> <b class="mono">${fmtCompact.format(stats.imp)}</b>`;
  $("rail-source").innerHTML = `<span class="dim">SRC</span> <b class="mono">${data.source}</b>`;
}

/* ─── HEADLINE ──────────────────────────────────────────────── */

function renderHeadline(data, stats) {
  $("h-count").textContent = fmt.format(data.count);
  $("h-range-start").textContent = data.oldest.slice(0, 10);
  $("h-range-end").textContent = data.newest.slice(0, 10);
  $("h-days").textContent = `${stats.totalDays}일`;
  $("h-generated").textContent = new Date(data.generated_at).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short", hour12: false
  });
}

/* ─── KPI ROW ───────────────────────────────────────────────── */

function renderKPIs(data, stats) {
  const monthEntries = Object.entries(data.byMonth || {}).sort((a,b)=>a[0].localeCompare(b[0]));
  const latestMonth = monthEntries.at(-1);
  const prevMonth = monthEntries.at(-2);
  let monthDelta = "—";
  if (latestMonth && prevMonth) {
    const d = latestMonth[1] - prevMonth[1];
    const pct = prevMonth[1] ? Math.round(d / prevMonth[1] * 100) : 0;
    monthDelta = `<span class="${d>=0?'up':'dn'}">${d>=0?'▲':'▼'} ${Math.abs(pct)}%</span> vs ${prevMonth[0].slice(5)}월`;
  }

  const avgEng = Math.round(stats.eng / Math.max(1, data.count));
  const mediaRatio = Math.round(stats.mediaCount / Math.max(1, data.count) * 100);
  const postsPerDay = (data.count / Math.max(1, stats.totalDays)).toFixed(2);
  const topHour = stats.hourCounts.indexOf(Math.max(...stats.hourCounts));
  const breakoutCount = data.tweets.filter(t => t._breakout).length;

  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#ffa028";

  const kpis = [
    { lbl: "POSTS",          val: fmt.format(data.count),                hint: `${postsPerDay} / DAY`,        series: stats.series.posts },
    { lbl: "ACTIVE DAYS",    val: fmt.format(stats.activeDays),          hint: `OF ${stats.totalDays}일 (${Math.round(stats.activeDays/stats.totalDays*100)}%)`, series: stats.series.activeDays },
    { lbl: "STREAK MAX",     val: `${stats.longest}<small>일</small>`,   hint: `LATEST ${monthDelta}`,        series: null, badge: `★ ${breakoutCount} BREAKOUT` },
    { lbl: "AVG ENGAGEMENT", val: fmtCompact.format(avgEng),             hint: `${fmtCompact.format(stats.eng)} TOTAL`, series: stats.series.avgEng },
    { lbl: "IMPRESSIONS",    val: fmtCompact.format(stats.imp),          hint: `AVG ${fmtCompact.format(Math.round(stats.imp/Math.max(1,data.count)))} / POST`, series: stats.series.impressions },
    { lbl: "MEDIA POSTS",    val: `${mediaRatio}<small>%</small>`,       hint: `${stats.mediaCount} OF ${data.count} · PEAK ${String(topHour).padStart(2,"0")}시`, series: stats.series.mediaPct },
  ];

  $("kpis").innerHTML = kpis.map((k, i) => `
    <div class="kpi" data-i="${i}">
      <div class="lbl">${k.lbl}</div>
      <div class="val">${k.val}</div>
      <div class="hint">${k.hint}</div>
      <div class="spark"></div>
      ${k.badge ? `<div class="kpi-badge">${k.badge}</div>` : ""}
    </div>
  `).join("");

  kpis.forEach((k, i) => {
    if (!k.series) return;
    const host = document.querySelector(`.kpi[data-i="${i}"] .spark`);
    if (host && window.JMNGCharts) {
      host.appendChild(JMNGCharts.sparkline(k.series, { w: 160, h: 24, color: accent }));
    }
  });
}

/* ─── TOPIC DIST (left panel) ───────────────────────────────── */

function renderTopics() {
  const data = state.data;
  const rows = Object.entries(data.byType || {}).sort((a, b) => b[1] - a[1]);
  const total = data.count || 1;
  $("topic-list").innerHTML = rows.map(([k, v]) => `
    <div class="topic-row ${state.types.has(k) ? "active" : ""}" data-type="${escapeHtml(k)}">
      <span class="swatch" style="--c:${TYPE_COLORS[k] || "var(--accent)"}"></span>
      <span class="topic-name">${escapeHtml(k)}<small>${TYPE_CODE[k] || "—"} · ${Math.round(v/total*100)}%</small></span>
      <span class="topic-val tabular"><b>${v}</b><br><small>n</small></span>
    </div>
  `).join("");
  $("topic-list").querySelectorAll(".topic-row").forEach(r => {
    r.addEventListener("click", () => {
      const t = r.dataset.type;
      if (state.types.has(t)) state.types.delete(t); else state.types.add(t);
      state.visibleCount = 50;
      renderTopics();
      renderFeed();
      updateTypePopover();
      syncURL();
    });
  });
}

/* ─── DAY × HOUR HEATMAP ────────────────────────────────────── */

function renderDayHourHeat(data) {
  const dowH = document.getElementById("dh-heat");
  if (!dowH) return;

  // KST: get day of week (0=Sun..6=Sat) and hour
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const dowFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" });
  const dowIdx = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  data.tweets.forEach(t => {
    const d = new Date(t.created_at);
    const dow = dowIdx[dowFmt.format(d)] ?? 0;
    grid[dow][kstHour(t.created_at)] += 1;
  });

  // Reorder Mon→Sun (KR convention)
  const order = [1, 2, 3, 4, 5, 6, 0];
  const labels = ["월", "화", "수", "목", "금", "토", "일"];

  const max = Math.max(...grid.flat(), 1);
  const rowTotals = order.map(i => grid[i].reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: 24 }, (_, h) =>
    order.reduce((s, i) => s + grid[i][h], 0)
  );

  let cells = "";
  for (let r = 0; r < 7; r++) {
    const di = order[r];
    cells += `<div class="dh-rowlabel mono">${labels[r]}</div>`;
    for (let h = 0; h < 24; h++) {
      const v = grid[di][h];
      const intensity = v === 0 ? 0 : Math.min(1, v / max);
      const isWeekend = di === 0 || di === 6;
      cells += `<div class="dh-cell" style="opacity:${0.05 + intensity * 0.95};background:${isWeekend ? "var(--cyan)" : "var(--accent)"}" title="${labels[r]} ${String(h).padStart(2,'0')}시 · ${v}건"></div>`;
    }
    cells += `<div class="dh-rowtotal mono">${rowTotals[r]}</div>`;
  }
  let axis = `<div></div>`;
  for (let h = 0; h < 24; h++) {
    axis += `<div class="dh-collabel mono">${h % 3 === 0 ? String(h).padStart(2,"0") : ""}</div>`;
  }
  axis += `<div></div>`;

  dowH.innerHTML = `
    <div class="dh-grid">${cells}</div>
    <div class="dh-axis-row">${axis}</div>
  `;

  const peakRowIdx = rowTotals.indexOf(Math.max(...rowTotals));
  const peakDowLabel = labels[peakRowIdx];
  const peakHour = colTotals.indexOf(Math.max(...colTotals));
  const weekendShare = Math.round((grid[0].reduce((a,b)=>a+b,0) + grid[6].reduce((a,b)=>a+b,0)) / data.count * 100);
  $("dh-peak").textContent = `PEAK ${peakDowLabel} · ${String(peakHour).padStart(2,"0")}시 · 주말 ${weekendShare}%`;
}

/* ─── LEAD POST ─────────────────────────────────────────────── */

function renderLead() {
  const data = state.data;
  const lead = [...data.tweets].sort((a, b) => metricScore(b) - metricScore(a))[0];
  const m = lead.metrics || {};
  const text = stripUrls(lead.text);
  $("lead").innerHTML = `
    <div class="lead-body">
      <div class="lead-tag">MOST-REACTED · POST ${lead.date}</div>
      <p class="lead-text">${escapeHtml(text)}</p>
      <div class="lead-meta">
        <span class="mono">${escapeHtml(lead.created_kst)} KST</span>
        <span class="mono">TYPE · <b>${escapeHtml(lead.type)}</b></span>
        ${lead._breakout ? `<span class="breakout-badge">★ BREAKOUT · ${lead._z.toFixed(1)}σ</span>` : ""}
        ${lead.media && lead.media.length ? `<span class="mono cyan">+ MEDIA ×${lead.media.length}</span>` : ""}
        <a class="mono" href="${lead.url}" target="_blank" rel="noreferrer">VIEW SOURCE ↗</a>
      </div>
    </div>
    <div class="lead-stats">
      <div class="lead-stat"><span class="lbl">LIKES</span><span class="val">${fmt.format(m.like_count || 0)}</span></div>
      <div class="lead-stat"><span class="lbl">REPOSTS</span><span class="val">${fmt.format(m.retweet_count || 0)}</span></div>
      <div class="lead-stat"><span class="lbl">REPLIES</span><span class="val">${fmt.format(m.reply_count || 0)}</span></div>
      <div class="lead-stat"><span class="lbl">IMPRESSIONS</span><span class="val">${fmtCompact.format(m.impression_count || 0)}</span></div>
    </div>
  `;
  $("lead").addEventListener("click", e => {
    if (e.target.tagName === "A") return;
    openDrawer(lead.id);
  });
}

/* ─── MONTHLY TIMELINE ──────────────────────────────────────── */

const TIMELINE_EVENTS = [
  { date: "2025-06-04", label: "취임", color: "#41d186" },
  { date: "2025-08-15", label: "광복절", color: "#f5d442" },
  { date: "2025-10-03", label: "개천절", color: "#f5d442" },
  { date: "2026-01-01", label: "신년", color: "#4ec9ff" },
  { date: "2026-03-01", label: "3·1절", color: "#f5d442" },
];

function renderTimeline(stats) {
  const monthly = stats.monthly;
  if (!monthly || !monthly.length || !window.JMNGCharts) return;
  const host = $("tl-host");
  host.innerHTML = "";
  const w = host.clientWidth || 880;
  const svg = JMNGCharts.stackedArea(monthly, {
    width: w,
    height: 220,
    events: TIMELINE_EVENTS,
    onMonthClick: (m) => {
      state.q = m;
      $("q").value = m;
      state.visibleCount = 50;
      renderFeed();
      syncURL();
    },
  });
  host.appendChild(svg);

  // Legend strip
  const legend = $("tl-legend");
  const totalsPerType = {};
  monthly.forEach(([, row]) => {
    JMNGCharts.TYPE_ORDER.forEach(t => (totalsPerType[t] = (totalsPerType[t] || 0) + (row[t] || 0)));
  });
  legend.innerHTML = JMNGCharts.TYPE_ORDER.map(t => `
    <span class="tl-leg-item">
      <span class="dot" style="background:${JMNGCharts.TYPE_COLOR[t]}"></span>
      ${t}<span class="dim mono" style="margin-left:6px">${totalsPerType[t] || 0}</span>
    </span>
  `).join("");

  const peak = monthly.slice().sort((a, b) => {
    const ta = Object.values(a[1]).reduce((s, v) => s + v, 0);
    const tb = Object.values(b[1]).reduce((s, v) => s + v, 0);
    return tb - ta;
  })[0];
  if (peak) {
    const total = Object.values(peak[1]).reduce((s, v) => s + v, 0);
    $("tl-peak").textContent = `PEAK ${peak[0]} · ${total} POSTS`;
  }
}

/* ─── FEED ──────────────────────────────────────────────────── */

function filtered() {
  const data = state.data;
  const q = state.q.trim().toLowerCase();
  let rows = data.tweets.filter(t => {
    const hay = `${t.text} ${t.type} ${(t.keywords||[]).join(" ")} ${(t.issues||[]).join(" ")} ${t.date}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (state.types.size && !state.types.has(t.type)) return false;
    return true;
  });
  if (state.sort === "likes")   rows.sort((a,b)=>(b.metrics.like_count||0)-(a.metrics.like_count||0));
  if (state.sort === "replies") rows.sort((a,b)=>(b.metrics.reply_count||0)-(a.metrics.reply_count||0));
  if (state.sort === "engage")  rows.sort((a,b)=>metricScore(b)-metricScore(a));
  if (state.sort === "impressions") rows.sort((a,b)=>(b.metrics.impression_count||0)-(a.metrics.impression_count||0));
  if (state.sort === "breakout") rows.sort((a,b)=>(b._z||0)-(a._z||0));
  if (state.sort === "recent")  rows.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
  if (state.sort === "oldest")  rows.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
  return rows;
}

function feedRow(t, i) {
  const m = t.metrics || {};
  const q = state.q.trim();
  const text = stripUrls(t.text);
  const dParts = t.created_kst.split(" ");
  const time = dParts[dParts.length - 1] || "";
  const date = t.date; // already YYYY-MM-DD
  const kws = (t.keywords || []).slice(0, 4).map(k => `<span>${escapeHtml(k)}</span>`).join("");

  return `
    <div class="feed-row ${state.selectedId === t.id ? "active" : ""}" data-id="${t.id}">
      <div class="ts">
        <b>${date}</b>
        ${time}
      </div>
      <div class="body">
        <span class="type-tag" style="--c:${TYPE_COLORS[t.type] || "var(--accent)"}">${TYPE_CODE[t.type] || ""} · ${escapeHtml(t.type)}</span>
        ${t._breakout ? `<span class="breakout-badge" title="유형 평균 대비 z=${t._z.toFixed(1)}σ">★ BREAKOUT · ${t._z.toFixed(1)}σ</span>` : ""}
        ${t.media && t.media.length ? `<span class="has-media">▣ IMG×${t.media.length}</span>` : ""}
        <div class="text">${highlight(text, q)}</div>
        ${kws ? `<div class="keywords">${kws}</div>` : ""}
      </div>
      <div class="metrics tabular">
        <div><span>LIK</span><b>${fmtCompact.format(m.like_count||0)}</b></div>
        <div><span>RT</span><b>${fmtCompact.format(m.retweet_count||0)}</b></div>
        <div><span>RPL</span><b>${fmtCompact.format(m.reply_count||0)}</b></div>
        <div><span>IMP</span><b>${fmtCompact.format(m.impression_count||0)}</b></div>
      </div>
    </div>
  `;
}

function gridCard(t) {
  const m = t.metrics || {};
  const url = t.media && t.media[0] && t.media[0].url;
  if (!url) return "";
  return `
    <div class="grid-card ${state.selectedId === t.id ? "active" : ""}" data-id="${t.id}">
      <img src="${url}" referrerpolicy="no-referrer" alt="" loading="lazy">
      <div class="grid-overlay">
        <div class="mono" style="font-size:10px; color:var(--dim);">${t.date}</div>
        <div class="grid-metrics mono">
          <span>♥ ${fmtCompact.format(m.like_count||0)}</span>
          <span>↻ ${fmtCompact.format(m.retweet_count||0)}</span>
          ${t._breakout ? `<span class="breakout-badge" style="margin:0;">★ ${t._z.toFixed(1)}σ</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

function renderFeed() {
  let rows = filtered();
  if (state.view === "grid") rows = rows.filter(t => t.media && t.media.length);

  $("feed-count").textContent = fmt.format(rows.length);
  $("feed-shown").textContent = fmt.format(Math.min(rows.length, state.visibleCount));
  $("sort-tag").textContent = ({
    recent:"최신순", oldest:"오래된순", likes:"좋아요순", replies:"답글순",
    engage:"종합 반응순", impressions:"노출순", breakout:"이탈도(σ)순"
  })[state.sort];

  const feed = $("feed");
  feed.classList.toggle("grid-mode", state.view === "grid");

  if (!rows.length) {
    feed.innerHTML = `<div class="feed-empty">${state.view==='grid' ? '미디어 게시글이 없습니다' : '조건에 맞는 트윗이 없습니다'} · NO MATCH</div>`;
    return;
  }
  const slice = rows.slice(0, state.visibleCount);
  const moreHTML = rows.length > state.visibleCount
    ? `<div class="feed-more" id="feed-more">+${rows.length - state.visibleCount} more · LOAD NEXT ${state.view === 'grid' ? 60 : 50} ▼</div>`
    : "";

  if (state.view === "grid") {
    feed.innerHTML = `<div class="grid-wrap">${slice.map(gridCard).join("")}</div>${moreHTML}`;
    feed.querySelectorAll(".grid-card").forEach(c => {
      c.addEventListener("click", () => openDrawer(c.dataset.id));
    });
  } else {
    feed.innerHTML = moreHTML + slice.map(feedRow).join("") + (rows.length > state.visibleCount ? moreHTML : "");
    feed.querySelectorAll(".feed-row").forEach(r => {
      r.addEventListener("click", () => openDrawer(r.dataset.id));
    });
  }
  document.querySelectorAll("#feed-more").forEach(b => b.addEventListener("click", () => {
    state.visibleCount += state.view === "grid" ? 60 : 50;
    renderFeed();
  }));
  renderTopics();
}

/* ─── ACTIVITY HEATMAP ──────────────────────────────────────── */

function renderActivity(stats) {
  const data = state.data;
  const start = new Date(data.oldest);
  start.setUTCHours(0, 0, 0, 0);
  while (start.getUTCDay() !== 0) start.setUTCDate(start.getUTCDate() - 1); // align to Sunday
  const end = new Date(data.newest);
  end.setUTCHours(0, 0, 0, 0);

  const cells = [];
  const monthLabels = [];
  let lastMonth = -1;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const v = stats.dayCounts.get(key) || 0;
    cells.push({ key, v, date: new Date(d) });
    if (d.getUTCDay() === 0) {
      const m = d.getUTCMonth();
      if (m !== lastMonth) {
        monthLabels.push({ idx: Math.floor(cells.length / 7), label: String(m + 1).padStart(2, "0") });
        lastMonth = m;
      }
    }
  }

  const max = Math.max(...cells.map(c => c.v));
  const grid = cells.map(c => {
    const lvl = c.v === 0 ? "" : c.v >= max * .75 ? "l4" : c.v >= max * .5 ? "l3" : c.v >= max * .25 ? "l2" : "l1";
    return `<span class="act-cell ${lvl}" title="${c.key} · ${c.v}건"></span>`;
  }).join("");

  const monthRow = monthLabels.filter((_, i) => i % 2 === 0).map(m => `<span>${m.label}월</span>`).join("");

  $("activity").innerHTML = `
    <div class="act-months">${monthRow}</div>
    <div class="act-grid">${grid}</div>
    <div class="act-legend">
      <span>활동 강도</span>
      <span style="margin-left:auto">LOW</span>
      <div class="squares"><span></span><span class="l1"></span><span class="l2"></span><span class="l3"></span><span class="l4"></span></div>
      <span>HIGH</span>
    </div>
  `;
}

/* ─── KEYWORDS ──────────────────────────────────────────────── */

function renderKeywords() {
  const data = state.data;
  const list = data.topKeywords.slice(0, 28);
  $("keywords").innerHTML = list.map((k, i) => `
    <button class="kw ${i < 6 ? "hot" : ""}" data-k="${escapeHtml(k.term)}">${escapeHtml(k.term)}<span class="n">${k.count}</span></button>
  `).join("");
  $("keywords").querySelectorAll(".kw").forEach(b => {
    b.addEventListener("click", () => {
      state.q = b.dataset.k;
      $("q").value = state.q;
      state.visibleCount = 50;
      renderFeed();
      syncURL();
    });
  });
}

/* ─── TOP REACTIONS ─────────────────────────────────────────── */

function renderRank() {
  const data = state.data;
  const top = [...data.tweets].sort((a, b) => (b.metrics.like_count || 0) - (a.metrics.like_count || 0)).slice(0, 10);
  $("rank-list").innerHTML = top.map((t, i) => `
    <div class="rank-row" data-id="${t.id}">
      <span class="rk">${String(i + 1).padStart(2, "0")}</span>
      <div class="rk-text">${escapeHtml(stripUrls(t.text)).slice(0, 100)}${t.text.length > 100 ? "…" : ""}
        <small>${t.date} · ${escapeHtml(t.type)}</small>
      </div>
      <div class="rk-val">${fmtCompact.format(t.metrics.like_count || 0)}<small>likes</small></div>
    </div>
  `).join("");
  $("rank-list").querySelectorAll(".rank-row").forEach(r => {
    r.addEventListener("click", () => openDrawer(r.dataset.id));
  });
}

/* ─── DEEP-READ DRAWER ──────────────────────────────────────── */

function openDrawer(id) {
  const t = state.data.tweets.find(x => x.id === id);
  if (!t) return;
  state.selectedId = id;
  syncURL();
  const m = t.metrics || {};
  const text = stripUrls(t.text);
  const media = (t.media || []).map(im => `<img src="${im.url}" referrerpolicy="no-referrer" alt="" class="drawer-img" data-url="${im.url}">`).join("");
  const kws = (t.keywords || []).map(k => `<button class="kw" onclick="window.__kwSearch('${escapeHtml(k).replace(/'/g, "\\'")}')">${escapeHtml(k)}</button>`).join("");
  const issues = (t.issues || []).map(i => `<li>${escapeHtml(i)}</li>`).join("");

  $("drawer-body").innerHTML = `
    <div style="display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
      <span class="lead-tag" style="--accent:${TYPE_COLORS[t.type] || "var(--accent)"}; color:${TYPE_COLORS[t.type] || "var(--accent)"}">
        ${TYPE_CODE[t.type] || ""} · ${escapeHtml(t.type)}
      </span>
      <span class="mono dim">${escapeHtml(t.created_kst)} KST</span>
      ${t._breakout ? `<span class="breakout-badge">★ BREAKOUT · ${t._z.toFixed(1)}σ</span>` : `<span class="mono dim">z = ${t._z.toFixed(2)}σ vs ${escapeHtml(t.type)} avg</span>`}
      <a class="mono cyan" href="${t.url}" target="_blank" rel="noreferrer" style="margin-left:auto">x.com / view ↗</a>
    </div>

    <div class="drawer-meta">
      <div><span class="lbl">LIKES</span>      <span class="val">${fmt.format(m.like_count || 0)}</span></div>
      <div><span class="lbl">REPOSTS</span>    <span class="val">${fmt.format(m.retweet_count || 0)}</span></div>
      <div><span class="lbl">REPLIES</span>    <span class="val">${fmt.format(m.reply_count || 0)}</span></div>
      <div><span class="lbl">IMPRESSIONS</span><span class="val">${fmtCompact.format(m.impression_count || 0)}</span></div>
    </div>

    <p class="drawer-text">${escapeHtml(text)}</p>

    ${media ? `<div class="drawer-section"><h4>첨부 · MEDIA</h4>${media}</div>` : ""}

    ${issues ? `<div class="drawer-section"><h4>핵심 쟁점 · ISSUES</h4><ul>${issues}</ul></div>` : ""}

    ${kws ? `<div class="drawer-section"><h4>키워드 · KEYWORDS</h4><div class="drawer-kw">${kws}</div></div>` : ""}

    <div class="drawer-section">
      <h4>메타데이터 · META</h4>
      <ul>
        <li><span class="mono dim">ID</span> <span class="mono">${t.id}</span></li>
        <li><span class="mono dim">UTC</span> <span class="mono">${t.created_at}</span></li>
        <li><span class="mono dim">QUOTE</span> <span class="mono">${fmt.format(m.quote_count || 0)}</span> · <span class="mono dim">BOOKMARK</span> <span class="mono">${fmt.format(m.bookmark_count || 0)}</span></li>
      </ul>
    </div>
  `;
  $("drawer").classList.add("open");
  $("drawer-veil").classList.add("open");
  // Wire lightbox
  $("drawer-body").querySelectorAll(".drawer-img").forEach(img => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => openLightbox(img.dataset.url));
  });
  renderFeed(); // refresh active state
}

function closeDrawer() {
  state.selectedId = null;
  $("drawer").classList.remove("open");
  $("drawer-veil").classList.remove("open");
  renderFeed();
  syncURL();
}

window.__kwSearch = (k) => {
  state.q = k;
  $("q").value = k;
  state.visibleCount = 50;
  closeDrawer();
  renderFeed();
  syncURL();
  document.querySelector(".feed").scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ─── DATE-RANGE BRUSH ──────────────────────────────────────── */

function renderBrush() {
  const host = $("tl-brush");
  if (!host) return;
  const raw = state.rawData;
  const fullStart = new Date(raw.oldest).getTime();
  const fullEnd = new Date(raw.newest).getTime();
  const W = host.clientWidth || 880;
  const H = 38;
  const NS = "http://www.w3.org/2000/svg";
  host.innerHTML = "";

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", H);
  svg.style.display = "block";
  svg.style.userSelect = "none";

  // Density strip — daily counts as background
  const monthEntries = Object.entries(raw.byMonth).sort((a,b)=>a[0].localeCompare(b[0]));
  const monthMax = Math.max(...monthEntries.map(([,v])=>v), 1);
  monthEntries.forEach(([mLabel, v], i) => {
    const x = (i / monthEntries.length) * W;
    const w = (1 / monthEntries.length) * W;
    const opacity = 0.2 + (v / monthMax) * 0.6;
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", 6);
    r.setAttribute("width", w - 1); r.setAttribute("height", 18);
    r.setAttribute("fill", "var(--accent)");
    r.setAttribute("fill-opacity", opacity);
    svg.appendChild(r);
  });

  // Track outline
  const track = document.createElementNS(NS, "rect");
  track.setAttribute("x", 0); track.setAttribute("y", 6);
  track.setAttribute("width", W); track.setAttribute("height", 18);
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "#1f262c");
  svg.appendChild(track);

  const range = state.dateRange || [fullStart, fullEnd];
  const span = fullEnd - fullStart;
  const xFor = ms => ((ms - fullStart) / span) * W;
  const msFor = x => Math.max(fullStart, Math.min(fullEnd, fullStart + (x / W) * span));

  // Outside mask (dim left + right)
  const maskL = document.createElementNS(NS, "rect");
  maskL.setAttribute("x", 0); maskL.setAttribute("y", 6);
  maskL.setAttribute("height", 18); maskL.setAttribute("fill", "rgba(0,0,0,.6)");
  svg.appendChild(maskL);
  const maskR = document.createElementNS(NS, "rect");
  maskR.setAttribute("y", 6); maskR.setAttribute("height", 18);
  maskR.setAttribute("fill", "rgba(0,0,0,.6)");
  svg.appendChild(maskR);

  // Selection rect (interactive)
  const selRect = document.createElementNS(NS, "rect");
  selRect.setAttribute("y", 6);
  selRect.setAttribute("height", 18);
  selRect.setAttribute("fill", "transparent");
  selRect.style.cursor = "grab";
  svg.appendChild(selRect);

  // Handles
  const makeHandle = () => {
    const g = document.createElementNS(NS, "g");
    g.style.cursor = "ew-resize";
    const ln = document.createElementNS(NS, "line");
    ln.setAttribute("y1", 2); ln.setAttribute("y2", 28);
    ln.setAttribute("stroke", "var(--accent)");
    ln.setAttribute("stroke-width", "2");
    g.appendChild(ln);
    const grip = document.createElementNS(NS, "rect");
    grip.setAttribute("y", 8); grip.setAttribute("width", 6); grip.setAttribute("height", 14);
    grip.setAttribute("fill", "var(--accent)");
    g.appendChild(grip);
    return { g, ln, grip };
  };
  const hL = makeHandle();
  const hR = makeHandle();
  svg.appendChild(hL.g); svg.appendChild(hR.g);

  // Labels
  const labL = document.createElementNS(NS, "text");
  labL.setAttribute("y", 36); labL.setAttribute("text-anchor", "start");
  labL.setAttribute("fill", "var(--accent)");
  labL.setAttribute("font-family", "'IBM Plex Mono', monospace");
  labL.setAttribute("font-size", "9");
  svg.appendChild(labL);
  const labR = document.createElementNS(NS, "text");
  labR.setAttribute("y", 36); labR.setAttribute("text-anchor", "end");
  labR.setAttribute("fill", "var(--accent)");
  labR.setAttribute("font-family", "'IBM Plex Mono', monospace");
  labR.setAttribute("font-size", "9");
  svg.appendChild(labR);

  function paint() {
    const x1 = xFor(range[0]);
    const x2 = xFor(range[1]);
    selRect.setAttribute("x", Math.min(x1, x2));
    selRect.setAttribute("width", Math.abs(x2 - x1));
    maskL.setAttribute("width", Math.max(0, Math.min(x1, x2)));
    maskR.setAttribute("x", Math.max(x1, x2));
    maskR.setAttribute("width", Math.max(0, W - Math.max(x1, x2)));
    hL.g.setAttribute("transform", `translate(${x1 - 3}, 0)`);
    hR.g.setAttribute("transform", `translate(${x2 - 3}, 0)`);
    labL.setAttribute("x", Math.max(2, Math.min(W - 80, x1 - 2)));
    labR.setAttribute("x", Math.max(80, Math.min(W - 2, x2 + 2)));
    labL.textContent = new Date(range[0]).toISOString().slice(0, 10);
    labR.textContent = new Date(range[1]).toISOString().slice(0, 10);
  }
  paint();

  // Drag handlers
  let drag = null;
  function clientX(e) { const r = svg.getBoundingClientRect(); return (((e.clientX || (e.touches && e.touches[0].clientX)) - r.left) / r.width) * W; }
  function startDrag(kind, e) {
    e.preventDefault();
    const x = clientX(e);
    drag = { kind, x0: x, r0: [...range] };
  }
  hL.g.addEventListener("mousedown", e => startDrag("L", e));
  hR.g.addEventListener("mousedown", e => startDrag("R", e));
  selRect.addEventListener("mousedown", e => startDrag("MOVE", e));
  svg.addEventListener("mousedown", e => {
    if (e.target === svg || e.target === track) {
      const x = clientX(e);
      const newCenter = msFor(x);
      const half = (range[1] - range[0]) / 2;
      range[0] = Math.max(fullStart, newCenter - half);
      range[1] = Math.min(fullEnd, newCenter + half);
      paint();
      apply();
    }
  });
  window.addEventListener("mousemove", e => {
    if (!drag) return;
    const dx = clientX(e) - drag.x0;
    const dxMs = (dx / W) * span;
    if (drag.kind === "L") {
      range[0] = Math.max(fullStart, Math.min(range[1] - 86400000, drag.r0[0] + dxMs));
    } else if (drag.kind === "R") {
      range[1] = Math.min(fullEnd, Math.max(range[0] + 86400000, drag.r0[1] + dxMs));
    } else if (drag.kind === "MOVE") {
      const dur = drag.r0[1] - drag.r0[0];
      let s = drag.r0[0] + dxMs;
      if (s < fullStart) s = fullStart;
      if (s + dur > fullEnd) s = fullEnd - dur;
      range[0] = s; range[1] = s + dur;
    }
    paint();
  });
  window.addEventListener("mouseup", () => {
    if (!drag) return;
    drag = null;
    apply();
  });

  function apply() {
    const isFull = Math.abs(range[0] - fullStart) < 86400000 && Math.abs(range[1] - fullEnd) < 86400000;
    state.dateRange = isFull ? null : [range[0], range[1]];
    rerenderScoped();
  }

  host.appendChild(svg);
}

/* ─── COHORT COMPARE ────────────────────────────────────────── */

function renderCohort() {
  const host = $("cohort");
  if (!host) return;
  const tweets = state.data.tweets;
  if (tweets.length < 2) {
    host.innerHTML = `<div class="cohort-empty">데이터가 부족합니다</div>`;
    return;
  }
  // Sort ascending by time
  const sorted = [...tweets].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const mid = Math.floor(sorted.length / 2);
  const cohortA = sorted.slice(0, mid);
  const cohortB = sorted.slice(mid);

  function digest(arr, name) {
    const byType = {}, kwCount = {};
    let eng = 0, imp = 0;
    arr.forEach(t => {
      byType[t.type] = (byType[t.type] || 0) + 1;
      (t.keywords || []).forEach(k => kwCount[k] = (kwCount[k] || 0) + 1);
      const m = t.metrics || {};
      eng += (m.like_count||0) + (m.retweet_count||0) + (m.reply_count||0) + (m.quote_count||0);
      imp += m.impression_count || 0;
    });
    return {
      name,
      count: arr.length,
      start: arr[0].date,
      end: arr.at(-1).date,
      byType,
      avgEng: arr.length ? Math.round(eng / arr.length) : 0,
      avgImp: arr.length ? Math.round(imp / arr.length) : 0,
      kwCount,
    };
  }
  const A = digest(cohortA, "A · 이전");
  const B = digest(cohortB, "B · 이후");

  // Keyword diffs
  const allTerms = new Set([...Object.keys(A.kwCount), ...Object.keys(B.kwCount)]);
  const diffs = [...allTerms].map(k => ({
    k,
    a: A.kwCount[k] || 0,
    b: B.kwCount[k] || 0,
    delta: (B.kwCount[k] || 0) - (A.kwCount[k] || 0),
  }));
  const gained = diffs.filter(x => x.a === 0 && x.b >= 2).sort((a,b)=>b.b-a.b).slice(0, 5);
  const lost   = diffs.filter(x => x.b === 0 && x.a >= 2).sort((a,b)=>b.a-a.a).slice(0, 5);
  const rising = diffs.filter(x => x.a > 0 && x.b > 0 && x.delta > 0).sort((a,b)=>b.delta-a.delta).slice(0, 5);
  const falling = diffs.filter(x => x.a > 0 && x.b > 0 && x.delta < 0).sort((a,b)=>a.delta-b.delta).slice(0, 5);

  // Topic mix bar
  const allTypes = [...new Set([...Object.keys(A.byType), ...Object.keys(B.byType)])];
  const totalA = A.count || 1, totalB = B.count || 1;

  const bar = (counts, total) => allTypes.map(t => {
    const pct = ((counts[t] || 0) / total) * 100;
    if (pct < .5) return "";
    return `<span style="background:${TYPE_COLORS[t]}; width:${pct.toFixed(1)}%" title="${escapeHtml(t)} ${pct.toFixed(0)}%"></span>`;
  }).join("");

  const engDelta = A.avgEng ? Math.round((B.avgEng - A.avgEng) / A.avgEng * 100) : 0;
  const engClass = engDelta >= 0 ? "up" : "dn";
  const engArrow = engDelta >= 0 ? "▲" : "▼";

  host.innerHTML = `
    <div class="cohort-grid">
      <div class="cohort-col">
        <div class="cohort-head">
          <span class="cohort-tag" style="background:var(--cyan); color:#000">A</span>
          <span class="cohort-label">이전</span>
          <span class="cohort-range mono">${A.start} → ${A.end}</span>
        </div>
        <div class="cohort-stats">
          <div><span class="lbl">POSTS</span><span class="val">${fmt.format(A.count)}</span></div>
          <div><span class="lbl">평균 인게이지먼트</span><span class="val">${fmtCompact.format(A.avgEng)}</span></div>
          <div><span class="lbl">평균 노출</span><span class="val">${fmtCompact.format(A.avgImp)}</span></div>
        </div>
        <div class="cohort-mix" aria-label="주제 비중">${bar(A.byType, totalA)}</div>
      </div>
      <div class="cohort-divider">
        <div class="cohort-delta">
          <div class="dlt-line">
            <span class="dim mono">ENG Δ</span>
            <span class="${engClass} mono">${engArrow} ${Math.abs(engDelta)}%</span>
          </div>
          <div class="dlt-line">
            <span class="dim mono">POSTS Δ</span>
            <span class="mono">${B.count - A.count >= 0 ? "+" : ""}${B.count - A.count}</span>
          </div>
        </div>
      </div>
      <div class="cohort-col">
        <div class="cohort-head">
          <span class="cohort-tag" style="background:var(--accent); color:#000">B</span>
          <span class="cohort-label">이후</span>
          <span class="cohort-range mono">${B.start} → ${B.end}</span>
        </div>
        <div class="cohort-stats">
          <div><span class="lbl">POSTS</span><span class="val">${fmt.format(B.count)}</span></div>
          <div><span class="lbl">평균 인게이지먼트</span><span class="val">${fmtCompact.format(B.avgEng)}</span></div>
          <div><span class="lbl">평균 노출</span><span class="val">${fmtCompact.format(B.avgImp)}</span></div>
        </div>
        <div class="cohort-mix" aria-label="주제 비중">${bar(B.byType, totalB)}</div>
      </div>
    </div>
    <div class="cohort-kw">
      <div class="kw-col">
        <h5 class="green">신규 등장 ↑</h5>
        ${gained.length ? gained.map(x => `<button class="kw" data-kw="${escapeHtml(x.k)}">${escapeHtml(x.k)}<span class="n green">+${x.b}</span></button>`).join("") : `<span class="dim mono small">—</span>`}
      </div>
      <div class="kw-col">
        <h5 class="amber">상승</h5>
        ${rising.length ? rising.map(x => `<button class="kw" data-kw="${escapeHtml(x.k)}">${escapeHtml(x.k)}<span class="n amber">+${x.delta}</span></button>`).join("") : `<span class="dim mono small">—</span>`}
      </div>
      <div class="kw-col">
        <h5 class="cyan">하락</h5>
        ${falling.length ? falling.map(x => `<button class="kw" data-kw="${escapeHtml(x.k)}">${escapeHtml(x.k)}<span class="n cyan">${x.delta}</span></button>`).join("") : `<span class="dim mono small">—</span>`}
      </div>
      <div class="kw-col">
        <h5 class="red">소멸 ↓</h5>
        ${lost.length ? lost.map(x => `<button class="kw" data-kw="${escapeHtml(x.k)}">${escapeHtml(x.k)}<span class="n red">−${x.a}</span></button>`).join("") : `<span class="dim mono small">—</span>`}
      </div>
    </div>
  `;
  host.querySelectorAll(".kw[data-kw]").forEach(b => {
    b.addEventListener("click", () => {
      state.q = b.dataset.kw;
      $("q").value = state.q;
      state.visibleCount = 50;
      renderFeed();
      syncURL();
    });
  });

  $("cohort-split-info").textContent = `MID-SPLIT · ${A.end} / ${B.start} · N=${A.count}+${B.count}`;
}

/* ─── TOPIC TRANSITION MATRIX ───────────────────────────────── */

function renderTransition() {
  const host = $("transition");
  if (!host) return;
  const tweets = state.data.tweets;
  const sorted = [...tweets].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const types = Object.keys(state.rawData.byType).sort((a, b) => state.rawData.byType[b] - state.rawData.byType[a]);
  const idx = Object.fromEntries(types.map((t, i) => [t, i]));
  const M = types.map(() => types.map(() => 0));
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = idx[sorted[i].type], b = idx[sorted[i + 1].type];
    if (a !== undefined && b !== undefined) M[a][b] += 1;
  }
  const rowSums = M.map(row => row.reduce((s, v) => s + v, 0) || 1);
  const max = Math.max(...M.flat(), 1);
  const code = t => TYPE_CODE[t] || "—";

  let rows = "";
  rows += `<div class="trans-cell corner"></div>`;
  types.forEach(t => {
    rows += `<div class="trans-h mono" title="${escapeHtml(t)}" style="color:${TYPE_COLORS[t]}">${code(t)}</div>`;
  });
  types.forEach((from, i) => {
    rows += `<div class="trans-h mono" title="${escapeHtml(from)}" style="color:${TYPE_COLORS[from]}">${code(from)}</div>`;
    types.forEach((to, j) => {
      const v = M[i][j];
      const p = (v / rowSums[i]) * 100;
      const intensity = v / max;
      rows += `<div class="trans-cell" style="background:rgba(255,160,40,${(0.05 + intensity * 0.85).toFixed(2)})" title="${escapeHtml(from)} → ${escapeHtml(to)} · n=${v} · ${p.toFixed(0)}%">
        <span>${v}</span>
      </div>`;
    });
  });

  host.innerHTML = `
    <div class="trans-grid" style="grid-template-columns: 30px repeat(${types.length}, 1fr)">
      ${rows}
    </div>
    <div class="trans-foot mono dim">FROM ↓ → TO →  ·  셀=다음 게시의 분포 (n=${fmt.format(sorted.length - 1)})</div>
  `;
}

/* ─── IMAGE LIGHTBOX ────────────────────────────────────────── */

function openLightbox(url) {
  const veil = document.createElement("div");
  veil.className = "lightbox";
  veil.innerHTML = `
    <button class="lightbox-close" aria-label="close">✕</button>
    <img src="${url}" referrerpolicy="no-referrer" alt="">
  `;
  veil.addEventListener("click", (e) => {
    if (e.target.tagName === "IMG") return;
    veil.remove();
  });
  document.body.appendChild(veil);
}

function wireInputs() {
  $("q").addEventListener("input", (e) => {
    state.q = e.target.value;
    state.visibleCount = 50;
    renderFeed();
    syncURL();
  });
  $("sort").addEventListener("change", e => { state.sort = e.target.value; renderFeed(); syncURL(); });

  // Type filter popover
  $("type-filter-btn").addEventListener("click", e => {
    e.stopPropagation();
    const pop = $("type-filter-pop");
    pop.classList.toggle("open");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#type-filter-pop") && !e.target.closest("#type-filter-btn")) {
      $("type-filter-pop")?.classList.remove("open");
    }
  });

  $("reset").addEventListener("click", () => {
    state.q = ""; state.types.clear(); state.sort = "recent"; state.view = "list"; state.visibleCount = 50;
    state.dateRange = null;
    $("q").value = ""; $("sort").value = "recent";
    rerenderScoped();
    updateTypePopover();
    setViewButton();
  });
  $("view-toggle").addEventListener("click", () => {
    state.view = state.view === "list" ? "grid" : "list";
    state.visibleCount = state.view === "grid" ? 60 : 50;
    setViewButton();
    renderFeed();
    syncURL();
  });
  $("drawer-veil").addEventListener("click", closeDrawer);
  $("drawer-close").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeDrawer();
    if (e.key === "/" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("q").focus();
    }
  });
}

function updateTypePopover() {
  const allTypes = Object.keys(state.rawData.byType).sort();
  const pop = $("type-filter-pop");
  if (!pop) return;
  pop.innerHTML = `
    <div class="pop-head mono">TYPE FILTER · 다중선택</div>
    <div class="pop-list">
      ${allTypes.map(t => `
        <label class="pop-item">
          <input type="checkbox" data-t="${escapeHtml(t)}" ${state.types.has(t) ? "checked" : ""}>
          <span class="swatch" style="background:${TYPE_COLORS[t]}"></span>
          <span>${escapeHtml(t)}</span>
          <span class="dim mono pop-n">${state.rawData.byType[t]}</span>
        </label>
      `).join("")}
    </div>
    <div class="pop-foot">
      <button class="pop-btn" id="pop-clear">CLEAR</button>
      <button class="pop-btn" id="pop-close">DONE</button>
    </div>
  `;
  pop.querySelectorAll("input[data-t]").forEach(cb => {
    cb.addEventListener("change", () => {
      const t = cb.dataset.t;
      if (cb.checked) state.types.add(t); else state.types.delete(t);
      state.visibleCount = 50;
      renderFeed();
      renderTopics();
      $("type-filter-btn").textContent = state.types.size
        ? `TYPES · ${state.types.size} SELECTED`
        : "TYPES · ALL";
      syncURL();
    });
  });
  $("pop-clear").onclick = () => {
    state.types.clear();
    renderFeed();
    renderTopics();
    updateTypePopover();
    $("type-filter-btn").textContent = "TYPES · ALL";
    syncURL();
  };
  $("pop-close").onclick = () => pop.classList.remove("open");
  $("type-filter-btn").textContent = state.types.size
    ? `TYPES · ${state.types.size} SELECTED`
    : "TYPES · ALL";
}

function setViewButton() {
  const btn = $("view-toggle");
  if (!btn) return;
  btn.textContent = state.view === "grid" ? "VIEW · GRID ▣" : "VIEW · LIST ☰";
  btn.style.color = state.view === "grid" ? "var(--magenta)" : "var(--cyan)";
}

/* ─── TWEAKS ────────────────────────────────────────────────── */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "amber",
  "density": "regular",
  "show_media": true,
  "theme": "black"
}/*EDITMODE-END*/;

let tweaks = { ...TWEAK_DEFAULTS };

function applyTweaks() {
  document.documentElement.dataset.accent = tweaks.accent;
  document.documentElement.dataset.density = tweaks.density;
  document.documentElement.dataset.theme = tweaks.theme;
  if (tweaks.theme === "navy") {
    document.documentElement.style.setProperty("--bg", "#020611");
    document.documentElement.style.setProperty("--bg-2", "#050a16");
    document.documentElement.style.setProperty("--panel", "#080f1c");
    document.documentElement.style.setProperty("--panel-2", "#0c1525");
  } else if (tweaks.theme === "graphite") {
    document.documentElement.style.setProperty("--bg", "#0f1112");
    document.documentElement.style.setProperty("--bg-2", "#13161a");
    document.documentElement.style.setProperty("--panel", "#181c20");
    document.documentElement.style.setProperty("--panel-2", "#1f242a");
  } else {
    document.documentElement.style.removeProperty("--bg");
    document.documentElement.style.removeProperty("--bg-2");
    document.documentElement.style.removeProperty("--panel");
    document.documentElement.style.removeProperty("--panel-2");
  }
  document.body.classList.toggle("hide-media", !tweaks.show_media);
}

function persistTweaks() {
  window.parent.postMessage({ type: "__edit_mode_set_keys", edits: tweaks }, "*");
}

function buildTweaks() {
  const accents = ["amber", "green", "cyan", "magenta"];
  const accentColors = { amber: "#ffa028", green: "#41d186", cyan: "#4ec9ff", magenta: "#ff5cd2" };
  $("tweaks-body").innerHTML = `
    <div class="row">
      <div class="lbl">ACCENT</div>
      <div class="swatches">
        ${accents.map(a => `<button class="sw ${tweaks.accent===a?"on":""}" data-acc="${a}" style="background:${accentColors[a]}"></button>`).join("")}
      </div>
    </div>
    <div class="row">
      <div class="lbl">THEME</div>
      <div class="seg cols-3">
        ${["black", "graphite", "navy"].map(t => `<button class="${tweaks.theme===t?"on":""}" data-thm="${t}">${t}</button>`).join("")}
      </div>
    </div>
    <div class="row">
      <div class="lbl">DENSITY</div>
      <div class="seg cols-2">
        ${["compact","regular"].map(d => `<button class="${tweaks.density===d?"on":""}" data-dens="${d}">${d}</button>`).join("")}
      </div>
    </div>
    <div class="row">
      <div class="lbl">MEDIA THUMBS IN DEEP READ</div>
      <div class="seg cols-2">
        <button class="${tweaks.show_media?"on":""}" data-media="true">ON</button>
        <button class="${!tweaks.show_media?"on":""}" data-media="false">OFF</button>
      </div>
    </div>
  `;
  $("tweaks-body").querySelectorAll("[data-acc]").forEach(b => b.onclick = () => { tweaks.accent = b.dataset.acc; applyTweaks(); persistTweaks(); buildTweaks(); });
  $("tweaks-body").querySelectorAll("[data-thm]").forEach(b => b.onclick = () => { tweaks.theme = b.dataset.thm; applyTweaks(); persistTweaks(); buildTweaks(); });
  $("tweaks-body").querySelectorAll("[data-dens]").forEach(b => b.onclick = () => { tweaks.density = b.dataset.dens; applyTweaks(); persistTweaks(); buildTweaks(); });
  $("tweaks-body").querySelectorAll("[data-media]").forEach(b => b.onclick = () => { tweaks.show_media = b.dataset.media === "true"; applyTweaks(); persistTweaks(); buildTweaks(); });
}

function setupTweaksProtocol() {
  window.addEventListener("message", e => {
    if (e.data?.type === "__activate_edit_mode") $("tweaks").classList.add("open");
    if (e.data?.type === "__deactivate_edit_mode") $("tweaks").classList.remove("open");
  });
  window.parent.postMessage({ type: "__edit_mode_available" }, "*");
  $("tweaks-close").onclick = () => {
    $("tweaks").classList.remove("open");
    window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*");
  };
}

/* ─── GRAPH ─────────────────────────────────────────────────── */

function renderGraphPanel() {
  if (!window.JMNGGraph) return;
  const data = state.data;
  const g = JMNGGraph.buildGraph(data);
  const container = $("graph");
  JMNGGraph.render(container, g, (kw) => {
    state.q = kw;
    $("q").value = kw;
    state.visibleCount = 50;
    renderFeed();
    syncURL();
    document.getElementById("feed-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("graph-meta").textContent = `${g.nodes.length} NODES · ${g.edges.length} EDGES · MIN CO-OCC ≥ 2`;
}

/* ─── BOOT ──────────────────────────────────────────────────── */

async function main() {
  const res = await fetch("./data/briefing.json");
  state.rawData = await res.json();

  // Read URL state before populating inputs
  const initialId = readURL();

  scopeData();
  const stats = buildStats(state.data);
  const fullStats = buildStats(state.rawData);

  $("q").value = state.q;
  $("sort").value = state.sort;
  setViewButton();

  renderRail(state.rawData, fullStats);
  renderHeadline(state.rawData, fullStats);
  renderKPIs(state.data, stats);
  renderDayHourHeat(state.data);
  renderLead();
  renderTimeline(fullStats);
  renderBrush();
  renderActivity(stats);
  renderKeywords();
  renderRank();
  renderTopics();
  renderFeed();
  renderGraphPanel();
  renderCohort();
  renderTransition();
  wireInputs();
  updateTypePopover();
  updateScopeBadge();
  applyTweaks();
  buildTweaks();
  setupTweaksProtocol();

  if (initialId) openDrawer(initialId);

  // Live clock in rail
  setInterval(() => {
    const now = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
    if ($("rail-clock")) $("rail-clock").innerHTML = `<span class="dim">KST</span> <b class="mono">${now}</b>`;
  }, 1000);

  // Re-render charts on resize (debounced)
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      renderTimeline(fullStats);
      renderBrush();
      renderGraphPanel();
    }, 250);
  });
}

main().catch(err => {
  document.body.innerHTML = `<pre style="padding:24px; color:#ff5757; font-family:monospace">${escapeHtml(err.stack || err.message)}</pre>`;
});
