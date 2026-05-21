#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const REPORT_DIR = path.join(ROOT, "reports");
const USER_ID = "106379129";
const USERNAME = "Jaemyung_Lee";
const TOKEN_PATH = path.join(process.env.HOME, ".openclaw/secrets/x-api-bearer-token");
const START_DATE = process.env.START_DATE || "2025-06-04";
const START_TIME = `${START_DATE}T00:00:00Z`;

function requestJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: { Authorization: `Bearer ${token}` } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(`${res.statusCode}: ${json.title || "request failed"} ${json.detail || ""}`));
            return;
          }
          resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function clean(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTerm(word) {
  const protectedWord = String(word || "")
    .replace(/민주주의/g, "민주주의X")
    .replace(/한반도/g, "한반도X");
  return protectedWord
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/^(대한|국민|우리|저는|오늘|내일|이번|관련|대해|위해)/, "")
    .replace(/(입니다|합니다|했습니다|드립니다|하겠습니다|이라는|라는|으로|에서|에게|까지|부터|처럼|보다|이며|이고|하고|하는|했다|한다|하게|들이|들의|으로서|으로써|께서|에게|에는|에도|만큼|조차|마저|부터|까지|한테|보다|마다|라도|이라도|님|은|는|이|가|을|를|의|와|과|도|로|에)$/g, "")
    .replace(/민주주의X/g, "민주주의")
    .replace(/한반도X/g, "한반도")
    .trim();
}

const STOP_TERMS = new Set([
  "https", "t.co", "http", "co", "lt", "gt", "amp",
  "이재명", "대통령", "대통령님", "민국", "대한민국", "대한국민", "국민", "여러분", "정부",
  "오늘", "어제", "내일", "이번", "지난", "처음", "다시", "이제", "모두", "가장", "매우", "정말", "진심", "감사",
  "합니다", "했습니다", "드립니다", "하겠습니다", "있습니다", "없습니다", "바랍니다", "생각", "되어", "되어야", "가졌습니다",
  "만났습니다", "나눴습니다", "찾습니다", "모십니다", "뵙겠습니다", "관련", "위해", "대해", "통해", "함께",
  "나라", "세계", "한국", "사람", "분들", "곳곳", "현장", "시간", "마음", "목소리", "소식", "모습", "자리",
  "축하", "기쁘게", "따뜻한", "든든한", "오랜", "새로운", "가능한", "필요", "문제", "상황", "기준",
  "여러분께", "아닙니다", "덕분에", "열리고", "거듭나고", "재임하시며", "주십시오", "진짜인지", "총리님", "장관님",
]);

const EVENT_PATTERNS = [
  /5[.·ㆍ]18\s*민주화운동/g,
  /6월\s*민주항쟁/g,
  /박종철\s*열사/g,
  /고문치사사건/g,
  /국가정보자원관리원/g,
  /대중문화교류위원회/g,
  /대통령실/g,
  /국정기획위원회/g,
  /국가안전보장회의/g,
  /비상경제점검TF회의/g,
  /타운홀\s*미팅/g,
  /국제인도법/g,
  /불법\s*성착취물/g,
  /보이스피싱/g,
  /가짜뉴스/g,
  /주가조작/g,
  /설탕부담금/g,
  /부동산투기/g,
  /양도세중과유예/g,
  /공공기관\s*지방이전/g,
  /해수부\s*이전/g,
  /해사법원/g,
  /주권정부/g,
  /자유민주적\s*기본질서/g,
  /시장경제질서/g,
  /노동권/g,
  /기업경영권/g,
  /산업인공지능전환/g,
  /기후에너지환경부/g,
  /필수의료/g,
  /희귀질환/g,
  /국제기구/g,
  /한센병/g,
  /민주당/g,
  /국민의힘/g,
  /국회/g,
  /검찰/g,
  /경찰/g,
  /법원/g,
  /공무원/g,
  /공공기관/g,
  /소상공인/g,
  /다주택자/g,
  /부동산/g,
  /주택/g,
  /노동/g,
  /임금체불/g,
  /산재/g,
  /외교/g,
  /안보/g,
  /한반도/g,
  /북한/g,
  /미국/g,
  /중국/g,
  /일본/g,
  /베트남/g,
  /튀르키예/g,
  /이집트/g,
  /UAE/g,
  /APEC/g,
  /G20/g,
  /AI/g,
  /반도체/g,
  /바이오/g,
  /방산/g,
  /인공지능/g,
  /데이터센터/g,
  /문화/g,
  /영화/g,
  /케이팝/g,
];

function addCandidate(scores, term, score) {
  const k = normalizeTerm(term).replace(/\s+/g, " ").trim();
  if (!k || STOP_TERMS.has(k)) return;
  if (k.length < 2 || /^[0-9]+$/.test(k)) return;
  if (/^[A-Za-z0-9]{8,}$/.test(k) && !/^(APEC|G20|UAE|AI|AWS|IMF|WHO|WBC|KF-21|RE100)$/i.test(k)) return;
  if (/[A-Za-z0-9]{7,}[A-Za-z0-9]*$/.test(k) && !/[가-힣]/.test(k)) return;
  if (/(습니다|습니까|했습|됩니다|됩니다만|되기|되었|되어야|되어|한다면|하시기|하셨|하신|해주시|했는데|이라니|인데|면서|지만|네요|군요|까요|런지)$/.test(k)) return;
  if (/(입니다|합니다|했습니다|드립니다|하겠습니다|있습니다|없습니다|바랍니다|생각합니다|전합니다|감사합니다|감사드립니다|기대합니다)$/.test(k)) return;
  if (/(하시며|하며|하며서|받은|받고|받아|하게|하고|하며|하며서|되는|된다고|되도록|되길|하기|하길|위한|위해|싶습니다)$/.test(k)) return;
  if (/^(무슨|어떤|이런|저런|그런|얼마|혹시|바로|일단|조금|많이|너무|아직|언제|어디|누구|이게|그간)$/.test(k)) return;
  scores.set(k, Math.max(scores.get(k) || 0, score));
}

function keywords(text) {
  const source = String(text || "").replace(/https?:\/\/\S+/g, " ");
  const scores = new Map();

  for (const pattern of EVENT_PATTERNS) {
    for (const m of source.matchAll(pattern)) addCandidate(scores, m[0], 120);
  }

  const tokens = Array.from(source.matchAll(/[가-힣A-Za-z0-9·.-]{2,}/g)).map((m) => m[0]);
  tokens.forEach((raw, index) => {
    const k = normalizeTerm(raw);
    let score = 10;
    if (/[·.-]/.test(k)) score += 8;
    if (k.length >= 4) score += 6;
    if (/(정책|제도|개혁|법안|법|세제|세금|예산|추경|시장|투자|산업|기술|의료|교육|노동|안전|범죄|수사|재판|외교|안보|협력|문화|지역|민주|인권|평화|경제|금융|부동산|주택|에너지|기후|복지|돌봄|청년|소상공|공공기관|위원회|장관|총리|대통령|국회|검찰|경찰)$/.test(k)) score += 18;
    if (/^(故|전|현|신임)$/.test(raw)) score -= 6;
    if (index > 10) score -= Math.min(8, Math.floor((index - 10) / 4));
    addCandidate(scores, k, score);
  });

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = normalizeTerm(tokens[i]);
    const b = normalizeTerm(tokens[i + 1]);
    if (!a || !b || STOP_TERMS.has(a) || STOP_TERMS.has(b)) continue;
    if (a.length + b.length < 5) continue;
    if (/(정책|제도|개혁|법안|세제|투자|산업|기술|의료|교육|노동|범죄|외교|안보|문화|민주|경제|금융|부동산|주택|에너지|기후|복지|돌봄|청년|공공기관|위원회|민주화운동|항쟁|질서)$/.test(b)) {
      addCandidate(scores, `${a} ${b}`, 55);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([term]) => term)
    .slice(0, 8);
}

function classify(text) {
  const t = text || "";
  if (/제보|확인|사실/.test(t)) return "검증 요청";
  if (/선거|투표|대선|총선|지방선거|민주당|국민의힘|정당|후보|공천|당대표|원내대표|의원|정치개혁|탄핵|개헌|정쟁|협치|야당|여당|국회|본회의|상임위|입법|법안|특검|청문회/.test(t)) return "정당·국회";
  if (/AI|인공지능|반도체|바이오|과학|기술|첨단|산업|스타트업|벤처|수출|제조|조선|자동차|배터리|로봇|데이터|플랫폼|디지털|게임|콘텐츠|R&D|연구개발|혁신/.test(t)) return "산업·과학기술";
  if (/교육|학교|대학|교사|교원|학생|입시|수능|돌봄|보육|유치원|어린이집|청소년|학부모|장학|늘봄/.test(t)) return "교육·돌봄";
  if (/기후|탄소|에너지|전기|전력|원전|재생에너지|태양광|풍력|환경|미세먼지|녹색|RE100|수소|배출/.test(t)) return "기후·에너지";
  if (/의료|의사|간호|병원|응급|필수의료|건강보험|질병|백신|의대|환자|돌봄|요양/.test(t)) return "보건·의료";
  if (/모욕|조롱|역사|민주|항쟁|박종철|5·18|5ㆍ18|세월호|4월 16일|계엄|노벨평화상|인권|여성의날|성평등|차별|평화상/.test(t)) return "역사·민주주의";
  if (/경제|민생|물가|소상공|청년|주거|복지|재정|긴축|창업|부동산|금융|대출|생산성|세금|양도세|보유세|상속세|주가|투자|주택|임대|농지|노동|임금|생리대|먹거리|생필품|유류값|성장|규제/.test(t)) return "민생·경제";
  if (/검찰|사법|재판|수사|법원|증거조작|조폭|군사반란|훈장|국방부|보훈부|행안부/.test(t)) return "사법·권력기관";
  if (/외교|안보|미국|중국|일본|북한|전쟁|총리|대통령|네덜란드|인도네시아|베트남|Việt Nam|Hàn Quốc|필리핀|튀르키예|이집트|UAE|아랍에미리트|양국|수교|협력|국제|WHO|세계보건|반도체|KF-21|전투기|자주국방|군인|군사|참전용사|한반도/.test(t)) return "외교·안보";
  if (/불법|범죄|엄벌|처벌|단속|성착취|도박|고리대|보복|매점매석|카르텔|비리|감찰|직무유기|법질서|안전|순직|산불|신고|구조|재난|사고/.test(t)) return "사회안전·법질서";
  if (/공직|공무원|민원|권익|내각|지시|대책|문책|감사|장관|위원장|실장|특보|정부|국정|개혁|경찰/.test(t)) return "국정운영·행정";
  if (/어린이날|청와대|잼블록스|축하|기념|추모|명복|현충사|이순신|문화|케이팝|아카데미|바비|새마을운동|영화|국가대표|선수|WBC|설날|새해|떡국|소원성취|어린이|고마워요|행복한 하루/.test(t)) return "기념·문화소통";
  if (/가짜뉴스|여론조작|언론|보도|기사|음해|허위|왜곡|매국|마타도어|악의적/.test(t)) return "언론·여론대응";
  if (/지역|광주|부산|대구|인천|전남|전북|경기/.test(t)) return "지역";
  return "정치 메시지";
}

function issueLines(text) {
  const t = text || "";
  const out = [];
  if (/고문치사|박종철|6월 민주항쟁|5·18|5ㆍ18/.test(t)) out.push("민주화운동 기억과 공적 표현의 충돌");
  if (/제보|확인|사실/.test(t)) out.push("공적 인물의 제보 공유와 사실확인 책임");
  if (/모욕|조롱|왜곡/.test(t)) out.push("역사 비하 표현에 대한 사회적·입법적 대응");
  if (/민생|경제|물가|소상공|주거/.test(t)) out.push("생활 의제의 정책 전환 가능성");
  if (!out.length) out.push("메시지가 만든 정치·정책 의제의 확산 경로");
  return out;
}

function dateKey(iso) {
  return new Date(iso).toISOString().slice(0, 10);
}

function kst(iso) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

async function fetchTweets() {
  const token = fs.readFileSync(TOKEN_PATH, "utf8").trim();
  let next = "";
  const tweets = [];
  const mediaByKey = new Map();
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`https://api.twitter.com/2/users/${USER_ID}/tweets`);
    url.searchParams.set("max_results", "100");
    url.searchParams.set("exclude", "retweets");
    url.searchParams.set("tweet.fields", "created_at,lang,public_metrics,attachments,referenced_tweets,entities");
    url.searchParams.set("expansions", "attachments.media_keys");
    url.searchParams.set("media.fields", "type,url,preview_image_url,width,height,alt_text");
    if (next) url.searchParams.set("pagination_token", next);
    const json = await requestJson(url, token);
    for (const media of json.includes?.media || []) mediaByKey.set(media.media_key, media);
    for (const tweet of json.data || []) {
      if (tweet.created_at < START_TIME) return { tweets, mediaByKey };
      tweets.push(tweet);
    }
    next = json.meta?.next_token || "";
    if (!next) break;
  }
  return { tweets, mediaByKey };
}

function summarize(tweets, mediaByKey) {
  const enriched = tweets.map((tweet) => {
    const media = (tweet.attachments?.media_keys || []).map((key) => mediaByKey.get(key)).filter(Boolean);
    const text = clean(tweet.text);
    return {
      id: tweet.id,
      url: `https://x.com/${USERNAME}/status/${tweet.id}`,
      created_at: tweet.created_at,
      created_kst: kst(tweet.created_at),
      date: dateKey(tweet.created_at),
      lang: tweet.lang || "unknown",
      text,
      type: classify(text),
      keywords: keywords(text),
      issues: issueLines(text),
      metrics: tweet.public_metrics || {},
      media: media.map((m) => ({ type: m.type, url: m.url || m.preview_image_url || "", alt_text: m.alt_text || "" })),
    };
  });

  const byType = {};
  const byMonth = {};
  const keywordCount = {};
  for (const t of enriched) {
    byType[t.type] = (byType[t.type] || 0) + 1;
    const month = t.date.slice(0, 7);
    byMonth[month] = (byMonth[month] || 0) + 1;
    for (const k of t.keywords) keywordCount[k] = (keywordCount[k] || 0) + 1;
  }
  const topKeywords = Object.entries(keywordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 28)
    .map(([term, count]) => ({ term, count }));
  const topTweets = [...enriched].sort((a, b) => (b.metrics.like_count || 0) - (a.metrics.like_count || 0)).slice(0, 12);
  const recent = enriched.slice(0, 18);

  return {
    generated_at: new Date().toISOString(),
    source: `@${USERNAME}`,
    startDate: START_DATE,
    count: enriched.length,
    newest: enriched[0]?.created_at || null,
    oldest: enriched.at(-1)?.created_at || null,
    byType,
    byMonth,
    topKeywords,
    topTweets,
    recent,
    tweets: enriched,
  };
}

function writeReports(tweets) {
  for (const t of tweets) {
    const lines = [
      `# ${t.date} ${t.type}: ${t.id}`,
      "",
      `- 원문: ${t.url}`,
      `- 작성: ${t.created_kst}`,
      `- 유형: ${t.type}`,
      `- 키워드: ${t.keywords.join(", ") || "없음"}`,
      "",
      "## 핵심 쟁점",
      "",
      ...t.issues.map((x) => `- ${x}`),
      "",
      "## 원문",
      "",
      t.text,
      "",
    ];
    if (t.media.length) lines.push("## 첨부", "", ...t.media.map((m) => `- ${m.url}`), "");
    fs.writeFileSync(path.join(REPORT_DIR, `${t.date}-${t.id}.md`), lines.join("\n"), "utf8");
  }
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  if (process.env.REBUILD_FROM_DATA === "1") {
    const existing = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "briefing.json"), "utf8"));
    const mediaByTweet = new Map((existing.tweets || []).map((t) => [t.id, t.media || []]));
    const tweets = existing.tweets.map((t) => ({
      id: t.id,
      text: t.text,
      created_at: t.created_at,
      public_metrics: t.metrics || {},
      attachments: {},
    }));
    const briefing = summarize(tweets, new Map());
    briefing.tweets.forEach((t) => {
      t.media = mediaByTweet.get(t.id) || [];
    });
    briefing.topTweets.forEach((t) => {
      t.media = mediaByTweet.get(t.id) || [];
    });
    briefing.recent.forEach((t) => {
      t.media = mediaByTweet.get(t.id) || [];
    });
    fs.writeFileSync(path.join(DATA_DIR, "briefing.json"), JSON.stringify(briefing, null, 2), "utf8");
    writeReports(briefing.tweets);
    console.log(JSON.stringify({ count: briefing.count, newest: briefing.newest, oldest: briefing.oldest }, null, 2));
    return;
  }
  const { tweets, mediaByKey } = await fetchTweets();
  const briefing = summarize(tweets, mediaByKey);
  fs.writeFileSync(path.join(DATA_DIR, "briefing.json"), JSON.stringify(briefing, null, 2), "utf8");
  writeReports(briefing.tweets);
  console.log(JSON.stringify({ count: briefing.count, newest: briefing.newest, oldest: briefing.oldest }, null, 2));
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
