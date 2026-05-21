#!/usr/bin/env bash
set -euo pipefail

USER_ID="106379129"
USERNAME="Jaemyung_Lee"
STATE_DIR="${HOME}/.openclaw/state/x-watch"
STATE_FILE="${STATE_DIR}/${USERNAME}.last_id"
TOKEN_FILE="${HOME}/.openclaw/secrets/x-api-bearer-token"
TARGET="${TELEGRAM_TARGET:-5089905038}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANALYZER="${SCRIPT_DIR}/analyze-jaemyung-tweet.py"
GITHUB_UPDATER="${SCRIPT_DIR}/update-github-pages.sh"

mkdir -p "$STATE_DIR"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "missing token: $TOKEN_FILE" >&2
  exit 2
fi

TOKEN="$(<"$TOKEN_FILE")"
MODE="${1:-check}"

fetch_latest() {
  local url="https://api.twitter.com/2/users/${USER_ID}/tweets?max_results=5&exclude=retweets&tweet.fields=created_at,lang,public_metrics,attachments,referenced_tweets&expansions=attachments.media_keys&media.fields=type,url,preview_image_url,width,height,alt_text"
  curl -sS -H "Authorization: Bearer ${TOKEN}" "$url"
}

json="$(fetch_latest)"

if [[ "$(jq -r 'has("data")' <<<"$json")" != "true" ]]; then
  echo "$json" | jq -r '"x api error: " + ((.title // "unknown")|tostring) + " - " + ((.detail // .errors[0].detail // "")|tostring)' >&2
  exit 1
fi

latest_id="$(jq -r '.data[0].id' <<<"$json")"

if [[ "$MODE" == "--init" || "$MODE" == "init" ]]; then
  printf '%s' "$latest_id" > "$STATE_FILE"
  echo "initialized ${USERNAME} last_id=${latest_id}"
  exit 0
fi

last_id=""
if [[ -f "$STATE_FILE" ]]; then
  last_id="$(<"$STATE_FILE")"
fi

if [[ -z "$last_id" ]]; then
  printf '%s' "$latest_id" > "$STATE_FILE"
  echo "initialized ${USERNAME} last_id=${latest_id}"
  exit 0
fi

if [[ "$latest_id" == "$last_id" ]]; then
  echo "no new tweet for @${USERNAME}"
  exit 0
fi

new_items="$(jq --arg last "$last_id" '[.data[] | select(.id != $last)] | reverse' <<<"$json")"
new_count="$(jq 'length' <<<"$new_items")"

jq -c '.[]' <<<"$new_items" | while IFS= read -r item; do
  id="$(jq -r '.id' <<<"$item")"
  payload_file="${STATE_DIR}/${USERNAME}.${id}.json"
  jq --argjson tweet "$item" '
    {
      tweet: ($tweet + {url: ("https://x.com/Jaemyung_Lee/status/" + $tweet.id)}),
      media_urls: ((.includes.media // []) | map(select(.url != null)) | map(.url))
    }
  ' <<<"$json" > "$payload_file"

  if [[ -x "$ANALYZER" || -f "$ANALYZER" ]]; then
    if ! python3 "$ANALYZER" --tweet-json "$payload_file" --target "$TARGET" --send >/dev/null; then
      created="$(jq -r '.created_at' <<<"$item")"
      text="$(jq -r '.text' <<<"$item")"
      metrics="$(jq -r '"RT " + (.public_metrics.retweet_count|tostring) + " / 답글 " + (.public_metrics.reply_count|tostring) + " / 좋아요 " + (.public_metrics.like_count|tostring)' <<<"$item")"
      lang="$(jq -r '.lang // "unknown"' <<<"$item")"
      url="https://x.com/${USERNAME}/status/${id}"
      safe_url="${url/https:\\/\\/x.com/x[.]com}"
      msg="@${USERNAME} 새 트윗
시간: ${created}
원문 언어: ${lang}
${metrics}

${text}

원문 링크(미리보기 방지): ${safe_url}

분석 스크립트 실행 실패: ${payload_file}"
      openclaw message send --channel telegram --target "$TARGET" --message "$msg" >/dev/null
    fi
  else
    echo "missing analyzer: $ANALYZER" >&2
  fi
done

if [[ "$new_count" -gt 0 ]]; then
  if [[ -x "$GITHUB_UPDATER" || -f "$GITHUB_UPDATER" ]]; then
    if update_output="$(bash "$GITHUB_UPDATER" 2>&1)"; then
      openclaw message send --channel telegram --target "$TARGET" --message "GitHub Pages 데이터 업데이트 완료

${update_output}" >/dev/null
    else
      openclaw message send --channel telegram --target "$TARGET" --message "GitHub Pages 데이터 업데이트 실패

${update_output}" >/dev/null
    fi
  else
    openclaw message send --channel telegram --target "$TARGET" --message "GitHub Pages 업데이트 스크립트 없음: ${GITHUB_UPDATER}" >/dev/null
  fi
fi

printf '%s' "$latest_id" > "$STATE_FILE"
echo "sent new tweet alert(s), latest_id=${latest_id}"
