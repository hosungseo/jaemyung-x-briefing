#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import pathlib
import re
import subprocess
import sys
import textwrap
import urllib.parse
import urllib.request
from typing import Any

HOME = pathlib.Path.home()
WORKSPACE = HOME / ".openclaw" / "workspace"
NAVER_ENV = HOME / "Documents" / "codex" / "question-forecast" / ".env"
REPORT_DIR = WORKSPACE / "x-watch" / "jaemyung-lee" / "reports"
POLICY_ADAPTER = WORKSPACE / "tools" / "public_adapters" / "policy_briefing_press.py"
MOLEG_ADAPTER = WORKSPACE / "kgov-ready-demo" / "scripts" / "moleg-law.mjs"
ASSEMBLY_BILL_ADAPTER = WORKSPACE / "kgov-ready-demo" / "scripts" / "assembly-bill.mjs"
KGOV_ENV = WORKSPACE / "kgov-ready-demo" / ".env.local"


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s or ""))).strip()


def load_env(path: pathlib.Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip("'\"")
    return out


def request_json(url: str, headers: dict[str, str] | None = None, timeout: int = 20) -> dict[str, Any]:
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "OpenClaw tweet analyzer"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def extract_keywords(text: str) -> list[str]:
    candidates = re.findall(r"[가-힣A-Za-z0-9·ㆍ]{2,}", text)
    stop = {
        "https", "t.co", "입니다", "그로", "하는", "광고입니다", "제보받은", "것인데", "진짜인지",
        "확인해", "봐야겠습니다", "여러분도", "함께", "주십시오", "사실이", "아니길", "바라지만",
        "참으로", "심각한", "문제입니다", "돈이", "마귀라지만", "사람의", "탈을", "쓰고", "있을까요",
    }
    seen: set[str] = set()
    out: list[str] = []
    for word in candidates:
        word = word.strip(".,!?()[]{}'\"")
        if len(word) < 2 or word in stop or word.startswith("http"):
            continue
        key = word.replace("ㆍ", "·")
        if key not in seen:
            seen.add(key)
            out.append(key)
    priority = ["박종철", "고문치사", "6월", "민주항쟁", "민주화운동", "무신사", "스타벅스", "광고"]
    ordered = [p for p in priority if any(p in k or k in p for k in out)]
    ordered += [k for k in out if k not in ordered]
    return ordered[:10]


def build_queries(keywords: list[str]) -> list[str]:
    queries: list[str] = []
    joined = " ".join(keywords[:4])
    if joined:
        queries.append(joined)
    for q in [
        "이재명 대통령 트윗 " + " ".join(keywords[:3]),
        "이재명 " + " ".join(keywords[:3]),
        " ".join(keywords[:3]),
    ]:
        if q.strip() and q not in queries:
            queries.append(q.strip())
    return queries[:4]


def fetch_naver_news(queries: list[str], limit: int = 8) -> list[dict[str, Any]]:
    env = load_env(NAVER_ENV)
    cid = env.get("NAVER_CLIENT_ID") or os.environ.get("NAVER_CLIENT_ID", "")
    secret = env.get("NAVER_CLIENT_SECRET") or os.environ.get("NAVER_CLIENT_SECRET", "")
    if not cid or not secret:
        return [{"error": "missing_naver_credentials"}]
    headers = {"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": secret}
    seen: set[str] = set()
    items: list[dict[str, Any]] = []
    for query in queries:
        params = urllib.parse.urlencode({"query": query, "display": "5", "sort": "date"})
        url = f"https://openapi.naver.com/v1/search/news.json?{params}"
        try:
            payload = request_json(url, headers=headers)
        except Exception as e:
            items.append({"query": query, "error": str(e)})
            continue
        for it in payload.get("items", []):
            link = it.get("originallink") or it.get("link") or ""
            title = clean(it.get("title", ""))
            key = link or title
            if not key or key in seen:
                continue
            seen.add(key)
            items.append({
                "query": query,
                "title": title,
                "description": clean(it.get("description", "")),
                "link": link,
                "pubDate": it.get("pubDate", ""),
            })
            if len(items) >= limit:
                return items
    return items


def run_json(cmd: list[str], env: dict[str, str] | None = None, timeout: int = 30) -> dict[str, Any]:
    p = subprocess.run(cmd, cwd=str(HOME), env={**os.environ, **(env or {})}, text=True,
                       capture_output=True, timeout=timeout)
    if p.returncode != 0:
        return {"error": p.stderr.strip() or p.stdout.strip() or f"exit {p.returncode}"}
    try:
        return json.loads(p.stdout)
    except Exception:
        return {"error": "json_parse_failed", "raw": p.stdout[:500]}


def adapter_env() -> dict[str, str]:
    env = load_env(KGOV_ENV)
    allowed = {
        "ASSEMBLY_API_KEY", "OPEN_ASSEMBLY_API_KEY", "NA_API_KEY",
        "MOLEG_OC", "LAW_GO_KR_OC", "LAW_API_OC",
    }
    return {k: v for k, v in env.items() if k in allowed}


def fetch_policy(keywords: list[str]) -> list[dict[str, Any]]:
    if not POLICY_ADAPTER.exists():
        return [{"error": "missing_policy_adapter"}]
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    policy_keywords = [k for k in keywords if len(k) >= 3 and not re.fullmatch(r"\d+월", k)]
    for keyword in policy_keywords[:4]:
        payload = run_json([sys.executable, str(POLICY_ADAPTER), "--keyword", keyword, "--limit", "3"])
        if payload.get("error"):
            items.append({"keyword": keyword, "error": payload["error"]})
            continue
        for it in payload.get("items", []):
            key = it.get("source_url") or it.get("title", "")
            if not key or key in seen:
                continue
            seen.add(key)
            it["keyword"] = keyword
            items.append(it)
            if len(items) >= 5:
                return items
    return items


def fetch_laws(keywords: list[str]) -> list[dict[str, Any]]:
    if not MOLEG_ADAPTER.exists():
        return [{"error": "missing_moleg_adapter"}]
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    queries = []
    if any("민주" in k or "항쟁" in k for k in keywords):
        queries.extend(["민주화운동", "5·18민주화운동", "민주유공자"])
    if any("모욕" in k or "조롱" in k for k in keywords):
        queries.extend(["형법", "정보통신망 이용촉진 및 정보보호 등에 관한 법률"])
    queries.extend(keywords[:3])
    base_env = adapter_env()
    base_env["MOLEG_OC"] = os.environ.get("MOLEG_OC", base_env.get("MOLEG_OC", "openclaw"))
    for q in dict.fromkeys([x for x in queries if x]):
        payload = run_json(["node", str(MOLEG_ADAPTER), "search", "--query", q, "--limit", "3"],
                           env=base_env)
        if payload.get("error"):
            items.append({"query": q, "error": payload["error"]})
            continue
        for it in payload.get("items", []):
            key = it.get("law_id") or it.get("law_name", "")
            if not key or key in seen:
                continue
            seen.add(key)
            it["query"] = q
            items.append(it)
            if len(items) >= 6:
                return items
    return items


def fetch_assembly_bills(keywords: list[str]) -> list[dict[str, Any]]:
    if not ASSEMBLY_BILL_ADAPTER.exists():
        return [{"error": "missing_assembly_adapter"}]
    env = adapter_env()
    has_key = any(env.get(k) or os.environ.get(k) for k in ("ASSEMBLY_API_KEY", "OPEN_ASSEMBLY_API_KEY", "NA_API_KEY"))
    if not has_key:
        return [{"error": "missing_assembly_api_key"}]
    queries: list[str] = []
    if any("민주" in k or "항쟁" in k for k in keywords):
        queries.extend(["민주화운동", "5·18민주화운동", "민주유공자"])
    if any("박종철" in k or "고문치사" in k for k in keywords):
        queries.extend(["인권", "국가폭력"])
    queries.extend([k for k in keywords[:4] if len(k) >= 3])
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for q in dict.fromkeys(queries):
        payload = run_json([
            "node", str(ASSEMBLY_BILL_ADAPTER), "search",
            "--endpoint", "ALLBILLV2", "--eraco", "제22대",
            "--query", q, "--limit", "3",
        ], env=env)
        if payload.get("error"):
            items.append({"query": q, "error": payload["error"]})
            continue
        for it in payload.get("items", []):
            key = it.get("bill_id") or it.get("title", "")
            if not key or key in seen:
                continue
            seen.add(key)
            it["query"] = q
            items.append(it)
            if len(items) >= 6:
                return items
    return items


def classify(text: str) -> str:
    if any(w in text for w in ["확인", "제보", "사실"]):
        return "제보 확인 요청형 / 논란 제기형"
    if any(w in text for w in ["법", "처벌", "개정"]):
        return "입법·정책 의제 제기형"
    return "정치 메시지 / 현안 반응형"


def md_list(items: list[str]) -> str:
    return "\n".join(f"- {x}" for x in items) if items else "- 없음"


def preview_safe_x_url(url: str) -> str:
    """Keep the X URL readable while preventing Telegram/X app previews."""
    return re.sub(r"^https://x\.com/", "x[.]com/", url or "")


def infer_issues(text: str) -> list[str]:
    issues = []
    if any(k in text for k in ["고문치사", "박종철", "6월 민주항쟁"]):
        issues.append("민주화운동 기억과 상업 광고 표현의 충돌")
    if any(k in text for k in ["제보", "확인"]):
        issues.append("공적 인물의 미확인 제보 공유와 사실확인 책임")
    if any(k in text for k in ["모욕", "조롱"]):
        issues.append("역사적 사건 비하 표현에 대한 사회적·입법적 대응")
    if not issues:
        issues.append("트윗이 만든 정치·정책 의제의 확산 경로")
    return issues


def build_report(tweet: dict[str, Any], media_urls: list[str], news: list[dict[str, Any]],
                 policies: list[dict[str, Any]], laws: list[dict[str, Any]],
                 assembly_bills: list[dict[str, Any]], keywords: list[str]) -> str:
    text = tweet.get("text", "")
    url = tweet.get("url") or f"https://x.com/Jaemyung_Lee/status/{tweet.get('id', '')}"
    lang = tweet.get("lang") or "unknown"
    now = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    issues = infer_issues(text)

    lines = [
        f"# 이재명 대통령 X 게시글 분석: {tweet.get('id', '')}",
        "",
        f"- 작성 시각: {tweet.get('created_at', '')}",
        f"- 분석 시각: {now}",
        f"- 원문: {url}",
        f"- X API 원문 언어: {lang}",
        f"- 유형: {classify(text)}",
        f"- 키워드: {', '.join(keywords) if keywords else '(자동 추출 실패)'}",
        "",
        "## 트윗 원문",
        "",
        text,
        "",
    ]
    if media_urls:
        lines += ["## 첨부 이미지", "", *[f"- {u}" for u in media_urls], ""]
    lines += [
        "## 1차 해석",
        "",
        "이 게시글은 특정 광고가 박종철 열사 고문치사사건과 6월 민주항쟁을 모욕·조롱한다는 문제제기입니다. 동시에 작성자가 직접 사실확인을 요청하고 있어, 단순 비판보다 ‘제보 검증을 공개적으로 요청한 현안 제기’에 가깝습니다.",
        "",
        "## 핵심 쟁점",
        "",
        md_list(issues),
        "",
        "## 관련 최신 뉴스",
        "",
    ]
    if news:
        for i, it in enumerate(news[:6], 1):
            if it.get("error"):
                lines.append(f"{i}. 검색 오류({it.get('query', '')}): {it['error']}")
            else:
                lines.append(f"{i}. {it.get('title', '')}")
                lines.append(f"   - 발행: {it.get('pubDate', '')}")
                lines.append(f"   - 링크: {it.get('link', '')}")
                if it.get("description"):
                    lines.append(f"   - 요약: {it['description'][:180]}")
    else:
        lines.append("- 관련 기사를 찾지 못함")
    lines += ["", "## 정책브리핑/정부 보도자료", ""]
    if policies:
        for i, it in enumerate(policies[:5], 1):
            if it.get("error"):
                lines.append(f"{i}. 검색 오류({it.get('keyword', '')}): {it['error']}")
            else:
                lines.append(f"{i}. {it.get('title', '')}")
                lines.append(f"   - 부처/일자: {it.get('agency', '')} / {it.get('date', '')}")
                lines.append(f"   - 링크: {it.get('source_url', '')}")
    else:
        lines.append("- 직접 관련 정부 보도자료를 찾지 못함")
    lines += ["", "## 법령 검색", ""]
    if laws:
        for i, it in enumerate(laws[:6], 1):
            if it.get("error"):
                lines.append(f"{i}. 검색 오류({it.get('query', '')}): {it['error']}")
            else:
                lines.append(f"{i}. {it.get('law_name', '')} ({it.get('law_type', '')})")
                lines.append(f"   - 소관: {it.get('ministry', '')}, 시행: {it.get('enforcement_date', '')}")
                lines.append(f"   - 링크: {it.get('detail_url', '')}")
    else:
        lines.append("- 관련 법령 후보를 찾지 못함")
    lines += [
        "",
        "## 국회/입법 API",
        "",
    ]
    if assembly_bills:
        for i, it in enumerate(assembly_bills[:6], 1):
            if it.get("error"):
                lines.append(f"{i}. 검색 오류({it.get('query', '')}): {it['error']}")
            else:
                lines.append(f"{i}. {it.get('title', '')}")
                lines.append(f"   - 제안: {it.get('proposer', '')} / {it.get('proposed_date', '')}")
                lines.append(f"   - 소관/상태: {it.get('committee', '')} / {it.get('status', '')}")
                lines.append(f"   - 링크: {it.get('source_url', '')}")
    else:
        lines.append("- 관련 법안 후보를 찾지 못함")
    lines += [
        "",
        "## 후속 관찰 포인트",
        "",
        "- 해당 광고가 실제 집행된 것인지, 원 제작·게시 주체가 누구인지 확인",
        "- 기업 측 공식 해명·삭제·사과 여부",
        "- 여야 논평과 입법 발의 여부",
        "- 역사적 사건 비하 표현을 어디까지 제재할 수 있는지에 대한 표현의 자유 쟁점",
        "",
    ]
    return "\n".join(lines)


def telegram_summary(tweet: dict[str, Any], report_path: pathlib.Path, news: list[dict[str, Any]],
                     laws: list[dict[str, Any]], assembly_bills: list[dict[str, Any]],
                     media_urls: list[str]) -> str:
    text = tweet.get("text", "")
    url = tweet.get("url") or f"https://x.com/Jaemyung_Lee/status/{tweet.get('id', '')}"
    safe_url = preview_safe_x_url(url)
    lang = tweet.get("lang") or "unknown"
    title_news = [n for n in news if not n.get("error")][:5]
    law_names = [l.get("law_name", "") for l in laws if not l.get("error") and l.get("law_name")][:4]
    bill_titles = [b.get("title", "") for b in assembly_bills if not b.get("error") and b.get("title")][:3]
    issues = infer_issues(text)
    one_line = "새 X 게시글은 역사적 사건 비하 논란을 제기하며 사실확인을 요청한 내용입니다."
    if "박종철" not in text and "민주" not in text:
        one_line = clean(text)[:120]
    parts = [
        "[이재명 대통령 X 새 글 분석]",
        one_line,
        "",
        f"- X API 원문 언어: {lang}",
        f"- 원문 링크(미리보기 방지): {safe_url}",
        f"- 유형: {classify(text)}",
        f"- 이미지: {'있음' if media_urls else '없음'}",
        "",
        "- API 원문:",
        clean(text)[:700],
        "",
        "- 핵심 쟁점:",
        *[f"  {i}. {issue}" for i, issue in enumerate(issues, 1)],
    ]
    if title_news:
        parts += ["", "- 관련 기사:"]
        parts.extend([f"  {i}. {n['title']}" for i, n in enumerate(title_news, 1)])
    if law_names:
        parts += ["", "- 법령 후보:", *[f"  {i}. {name}" for i, name in enumerate(law_names, 1)]]
    if bill_titles:
        parts += ["", "- 국회 법안 후보:", *[f"  {i}. {title}" for i, title in enumerate(bill_titles, 1)]]
    parts += [
        "",
        "- 후속 관찰:",
        "  1. 광고 실제 집행 여부와 원 제작·게시 주체",
        "  2. 기업 측 해명·삭제·사과 여부",
        "  3. 여야 논평과 입법 발의 여부",
        "",
        f"상세 리포트: {report_path}",
    ]
    return "\n".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tweet-json", required=True)
    ap.add_argument("--target", default=os.environ.get("TELEGRAM_TARGET", "5089905038"))
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--no-send", action="store_true")
    args = ap.parse_args()

    payload = json.loads(pathlib.Path(args.tweet_json).read_text(encoding="utf-8"))
    tweet = payload.get("tweet", payload)
    media_urls = payload.get("media_urls") or []
    tweet.setdefault("url", f"https://x.com/Jaemyung_Lee/status/{tweet.get('id', '')}")

    keywords = extract_keywords(tweet.get("text", ""))
    queries = build_queries(keywords)
    news = fetch_naver_news(queries)
    policies = fetch_policy(keywords)
    laws = fetch_laws(keywords)
    assembly_bills = fetch_assembly_bills(keywords)

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    day = dt.datetime.now().strftime("%Y-%m-%d")
    report_path = REPORT_DIR / f"{day}-{tweet.get('id', 'unknown')}.md"
    report = build_report(tweet, media_urls, news, policies, laws, assembly_bills, keywords)
    report_path.write_text(report, encoding="utf-8")

    summary = telegram_summary(tweet, report_path, news, laws, assembly_bills, media_urls)
    if args.send and not args.no_send:
        subprocess.run(["openclaw", "message", "send", "--channel", "telegram", "--target", args.target, "--message", summary],
                       check=False)
    print(json.dumps({"report": str(report_path), "summary": summary}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
