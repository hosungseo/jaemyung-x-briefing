#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PRESS_ROOT = process.env.PRESS_ROOT || path.resolve(ROOT, "..", "gov-press-md");
const DATA_PATH = path.join(ROOT, "data", "briefing.json");
const OUT_PATH = path.join(ROOT, "data", "policy-links.json");
const WINDOW_DAYS = Number(process.env.WINDOW_DAYS || 14);
const TOP_N = Number(process.env.TOP_N || 2);

const STOP = new Set([
  "오늘", "이번", "관련", "위해", "대해", "통해", "있는", "없는", "한다", "했다", "합니다", "했습니다",
  "정부", "대통령", "대한민국", "국민", "여러분", "우리", "이재명", "보도자료", "설명", "참고",
  "함께", "개최", "추진", "지원", "운영", "확대", "강화", "관련", "광고", "6월",
]);

function dayKey(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function tokenize(text) {
  return Array.from(String(text || "").matchAll(/[가-힣A-Za-z0-9·.-]{2,}/g))
    .map((m) => m[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .map((w) => w.replace(/(입니다|합니다|했습니다|드립니다|이라는|라는|으로|에서|에게|까지|부터|에는|에도|으로서|으로써|은|는|이|가|을|를|의|와|과|도|로|에)$/g, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^[0-9]+$/.test(w));
}

function parseFrontmatter(md) {
  const out = {};
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return out;
  for (const line of m[1].split(/\n/)) {
    const p = line.match(/^([a-zA-Z0-9_]+):\s*(.*)$/);
    if (!p) continue;
    out[p[1]] = p[2].replace(/^"|"$/g, "").replace(/\\"/g, "\"");
  }
  return out;
}

function normalizeDate(value, fallback) {
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return fallback;
}

function collectNeededDates(tweets) {
  const dates = new Set();
  for (const t of tweets) {
    const base = new Date(`${t.date}T00:00:00Z`);
    for (let i = -WINDOW_DAYS; i <= WINDOW_DAYS; i += 1) dates.add(dayKey(addDays(base, i)));
  }
  return [...dates].sort();
}

function readPressDocs(dates) {
  const docs = [];
  for (const d of dates) {
    const [year, month] = d.split("-");
    const dir = path.join(PRESS_ROOT, "data", year, `${year}-${month}`, d);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md");
    for (const file of files) {
      const full = path.join(dir, file);
      const md = fs.readFileSync(full, "utf8");
      const fm = parseFrontmatter(md);
      const body = md.replace(/^---\n[\s\S]*?\n---/, "").slice(0, 5000);
      const text = `${fm.title || ""} ${fm.ministry || ""} ${body}`;
      const terms = tokenize(text);
      const tf = new Map();
      for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
      docs.push({
        id: fm.news_item_id || `${d}/${file}`,
        date: normalizeDate(fm.approve_date, d),
        title: fm.title || file.replace(/\.md$/, ""),
        ministry: fm.ministry || "미분류",
        original_url: fm.original_url || "",
        path: path.relative(PRESS_ROOT, full),
        len: Math.max(1, terms.length),
        text,
        textLower: text.toLowerCase(),
        tf,
        termSet: new Set(tf.keys()),
      });
    }
  }
  return docs;
}

function buildDf(docs) {
  const df = new Map();
  for (const doc of docs) {
    for (const term of doc.termSet) df.set(term, (df.get(term) || 0) + 1);
  }
  return df;
}

function bm25(queryTerms, doc, df, avgLen, totalDocs) {
  const k1 = 1.4;
  const b = 0.72;
  let score = 0;
  for (const term of queryTerms) {
    const f = doc.tf.get(term) || 0;
    if (!f) continue;
    const n = df.get(term) || 0;
    const idf = Math.log(1 + (totalDocs - n + 0.5) / (n + 0.5));
    score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.len / avgLen))));
  }
  return score;
}

function sharedTerms(queryTerms, doc) {
  const out = [];
  for (const term of queryTerms) {
    const q = term.toLowerCase();
    if (doc.termSet.has(term) || doc.textLower.includes(q)) out.push(term);
  }
  return [...new Set(out)];
}

function softScore(queryTerms, doc) {
  let score = 0;
  for (const term of queryTerms) {
    const q = term.toLowerCase();
    if (doc.termSet.has(term)) score += term.length >= 4 ? 1.2 : 0.7;
    else if (doc.textLower.includes(q)) score += term.length >= 4 ? 0.9 : 0.35;
  }
  return score;
}

function makeQuery(tweet) {
  const weighted = [];
  for (const k of tweet.keywords || []) {
    weighted.push(k, k);
    for (const t of tokenize(k)) weighted.push(t);
  }
  weighted.push(tweet.type || "");
  tokenize(tweet.text).slice(0, 16).forEach((t) => weighted.push(t));
  return [...new Set(weighted.map((x) => x.trim()).filter(Boolean).filter((x) => !STOP.has(x)))].slice(0, 28);
}

function strength(finalScore, overlap) {
  if (finalScore >= 11 || overlap >= 4) return "높음";
  if (finalScore >= 6 || overlap >= 2) return "중간";
  return "낮음";
}

function isPublicMatch(item) {
  return item.strength === "높음" || item.strength === "중간";
}

function reason(tweet, doc, shared, delta) {
  const bits = [];
  if (shared.length) bits.push(`공통 의제: ${shared.slice(0, 3).join(", ")}`);
  if (doc.ministry && doc.ministry !== "미분류") bits.push(`${doc.ministry} 자료`);
  if (Math.abs(delta) <= 3) bits.push(`게시일 ${delta === 0 ? "당일" : `${Math.abs(delta)}일 ${delta > 0 ? "후" : "전"}`}`);
  return bits.join(" · ") || `${tweet.type} 흐름과 가까운 보도자료`;
}

function main() {
  const briefing = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const dates = collectNeededDates(briefing.tweets);
  const docs = readPressDocs(dates);
  const df = buildDf(docs);
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  const docsByDate = new Map();
  for (const doc of docs) {
    if (!docsByDate.has(doc.date)) docsByDate.set(doc.date, []);
    docsByDate.get(doc.date).push(doc);
  }

  const links = {};
  for (const tweet of briefing.tweets) {
    const q = makeQuery(tweet);
    const qSet = new Set(q);
    const base = new Date(`${tweet.date}T00:00:00Z`);
    const candidates = [];
    for (let i = -WINDOW_DAYS; i <= WINDOW_DAYS; i += 1) {
      const d = dayKey(addDays(base, i));
      for (const doc of docsByDate.get(d) || []) {
        const shared = sharedTerms([...qSet], doc);
        if (!shared.length) continue;
        const b25 = bm25(q, doc, df, avgLen, docs.length);
        const soft = softScore(q, doc);
        const dateBoost = Math.max(0, 2.2 - Math.abs(i) * 0.12);
        const overlapBoost = Math.min(5, shared.length * 1.15);
        const finalScore = b25 + soft + dateBoost + overlapBoost;
        if (finalScore < 18 && shared.length < 4) continue;
        candidates.push({
          title: doc.title,
          ministry: doc.ministry,
          date: doc.date,
          url: doc.original_url,
          path: doc.path,
          strength: strength(finalScore, shared.length),
          reason: reason(tweet, doc, shared, i),
          debug: {
            bm25_score: Number(b25.toFixed(4)),
            keyword_overlap: shared.length,
            shared_terms: shared.slice(0, 10),
            date_delta_days: i,
            date_score: Number(dateBoost.toFixed(4)),
            soft_match_score: Number(soft.toFixed(4)),
            final_score: Number(finalScore.toFixed(4)),
          },
        });
      }
    }
    links[tweet.id] = candidates
      .sort((a, b) => b.debug.final_score - a.debug.final_score)
      .filter(isPublicMatch)
      .slice(0, TOP_N);
  }

  const linkedCount = Object.values(links).filter((items) => items.length).length;
  const out = {
    generated_at: new Date().toISOString(),
    source: {
      tweets: path.relative(ROOT, DATA_PATH),
      press_root: PRESS_ROOT,
      window_days: WINDOW_DAYS,
      candidate_press_docs: docs.length,
    },
    note: "debug scores are for owner/admin review only; public UI should show strength and reason, not raw BM25.",
    linked_tweets: linkedCount,
    total_tweets: briefing.tweets.length,
    links,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(JSON.stringify({ total_tweets: briefing.tweets.length, linked_tweets: linkedCount, candidate_press_docs: docs.length, out: path.relative(ROOT, OUT_PATH) }, null, 2));
}

main();
