#!/usr/bin/env bash
# Smoke test against a running `npm run dev` on port 3000.
# Usage: BASE=http://localhost:3000 TOKEN=devtoken bash scripts/smoke.sh
set -u
BASE="${BASE:-http://localhost:3000}"
TOKEN="${TOKEN:-devtoken}"
AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"
PASS=0; FAIL=0

# step <name> <expected-status-regex> <curl args...>; prints body, sets $BODY
step() {
  local name="$1" expect="$2"; shift 2
  local out code
  out=$(curl -s -w $'\n%{http_code}' "$@")
  code="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
  if [[ "$code" =~ ^($expect)$ ]]; then
    PASS=$((PASS+1)); echo "PASS [$code] $name"
  else
    FAIL=$((FAIL+1)); echo "FAIL [$code] $name"; echo "     $BODY" | head -c 600; echo
  fi
}
jget() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const v=JSON.parse(d);const p=process.argv[1].split(".");let o=v;for(const k of p)o=o?.[k];console.log(o??"")}catch{console.log("")}})' "$1"; }

echo "== Pod Talk smoke test against $BASE"

step "GET /api/health" 200 "$BASE/api/health"
step "GET /api/queue without auth -> 401" 401 "$BASE/api/queue"

echo "-- feeds (network)"
step "POST /api/feeds darknetdiaries" "200|201|502" -X POST -H "$AUTH" -H "$JSON" \
  -d '{"url":"https://feeds.megaphone.fm/darknetdiaries"}' "$BASE/api/feeds"
FEED_ID=$(printf '%s' "$BODY" | jget feed.id)
if [[ -n "$FEED_ID" ]]; then
  echo "     feed $FEED_ID, episodes: $(printf '%s' "$BODY" | jget episodes)"
  step "GET /api/feeds/:id/episodes" 200 -H "$AUTH" "$BASE/api/feeds/$FEED_ID/episodes"
  step "GET /api/feeds" 200 -H "$AUTH" "$BASE/api/feeds"
else
  echo "     (feed fetch failed - network? continuing)"
fi

echo "-- queue"
step "POST /api/queue (upload url)" "200|201" -X POST -H "$AUTH" -H "$JSON" \
  -d '{"audio_url":"https://www2.cs.uic.edu/~i101/SoundFiles/preamble10.wav","title":"Preamble (test)"}' "$BASE/api/queue"
QID=$(printf '%s' "$BODY" | jget id)
echo "     queue item $QID"
step "POST /api/queue again is idempotent (200)" 200 -X POST -H "$AUTH" -H "$JSON" \
  -d '{"audio_url":"https://www2.cs.uic.edu/~i101/SoundFiles/preamble10.wav","title":"Preamble (test)"}' "$BASE/api/queue"
step "GET /api/queue" 200 -H "$AUTH" "$BASE/api/queue"
step "PATCH /api/queue/:id status=downloaded" 200 -X PATCH -H "$AUTH" -H "$JSON" -d '{"status":"downloaded","duration_ms":10000}' "$BASE/api/queue/$QID"

echo "-- validation (must be 400, never 500)"
step "PATCH /api/queue/:id duration_ms=1.5 -> 400" 400 -X PATCH -H "$AUTH" -H "$JSON" -d '{"duration_ms":1.5}' "$BASE/api/queue/$QID"
step "PATCH /api/queue/:id duration_ms=1e12 -> 400" 400 -X PATCH -H "$AUTH" -H "$JSON" -d '{"duration_ms":1e12}' "$BASE/api/queue/$QID"
step "PUT transcript duration_ms=-5 -> 400" 400 -X PUT -H "$AUTH" -H "$JSON" -d '{"duration_ms":-5,"segments":[]}' "$BASE/api/queue/$QID/transcript"
step "PUT transcript end<start -> 400" 400 -X PUT -H "$AUTH" -H "$JSON" -d '{"segments":[{"start_ms":10,"end_ms":5,"text":"x"}]}' "$BASE/api/queue/$QID/transcript"
step "POST /api/queue malformed percent URL -> 201 (title falls back to raw segment)" "200|201" -X POST -H "$AUTH" -H "$JSON" \
  -d '{"audio_url":"https://example.com/smoke-%E0%A4%A.mp3"}' "$BASE/api/queue"
BAD_QID=$(printf '%s' "$BODY" | jget id)
[[ -n "$BAD_QID" ]] && step "DELETE malformed-percent item" 200 -X DELETE -H "$AUTH" "$BASE/api/queue/$BAD_QID"

echo "-- transcript"
step "PUT /api/queue/:id/transcript (3 segments)" 200 -X PUT -H "$AUTH" -H "$JSON" -d '{
  "engine":"whisper.cpp/base.en","duration_ms":10000,
  "segments":[
    {"start_ms":0,"end_ms":3200,"text":"We the People of the United States, in Order to form a more perfect Union,"},
    {"start_ms":3200,"end_ms":6800,"text":"establish Justice, insure domestic Tranquility, provide for the common defence,"},
    {"start_ms":6800,"end_ms":10000,"text":"promote the general Welfare, and secure the Blessings of Liberty to ourselves and our Posterity."}
  ]}' "$BASE/api/queue/$QID/transcript"
step "GET /api/queue/:id/transcript" 200 -H "$AUTH" "$BASE/api/queue/$QID/transcript"

echo "-- webhook (registered before conversation so events get delivered)"
step "POST /api/webhooks -> local sink" 201 -X POST -H "$AUTH" -H "$JSON" \
  -d "{\"url\":\"$BASE/api/webhook-sink\",\"secret\":\"shh\",\"events\":[]}" "$BASE/api/webhooks"
WID=$(printf '%s' "$BODY" | jget id)
echo "     webhook $WID"

echo "-- conversation"
step "POST /api/conversations" 201 -X POST -H "$AUTH" -H "$JSON" -d "{\"queue_item_id\":\"$QID\",\"audio_position_ms\":4100}" "$BASE/api/conversations"
CID=$(printf '%s' "$BODY" | jget id)
echo "     conversation $CID"
step "POST events paused" 200 -X POST -H "$AUTH" -H "$JSON" -d '{"type":"paused","audio_position_ms":4100}' "$BASE/api/conversations/$CID/events"
step "POST events type=constructor -> 400" 400 -X POST -H "$AUTH" -H "$JSON" -d '{"type":"constructor"}' "$BASE/api/conversations/$CID/events"
step "POST turn audio_position_ms=1e12 -> 400" 400 -X POST -H "$AUTH" -H "$JSON" -d '{"role":"user","text":"hi","audio_position_ms":1e12}' "$BASE/api/conversations/$CID/turns"
step "POST /api/conversations audio_position_ms=1.5 -> 400" 400 -X POST -H "$AUTH" -H "$JSON" -d "{\"queue_item_id\":\"$QID\",\"audio_position_ms\":1.5}" "$BASE/api/conversations"
step "POST turn user" 201 -X POST -H "$AUTH" -H "$JSON" -d '{"role":"user","text":"What does domestic tranquility mean here?","audio_position_ms":4100,"segment_start_ms":3200,"segment_end_ms":6800,"context_excerpt":"establish Justice, insure domestic Tranquility","engine":"whisper.cpp/base.en"}' "$BASE/api/conversations/$CID/turns"
step "POST turn assistant" 201 -X POST -H "$AUTH" -H "$JSON" -d '{"role":"assistant","text":"It refers to peace and order within the country, one of the goals the preamble lists for the new government.","audio_position_ms":4100,"segment_start_ms":3200,"segment_end_ms":6800,"engine":"bm25"}' "$BASE/api/conversations/$CID/turns"
step "POST events resumed" 200 -X POST -H "$AUTH" -H "$JSON" -d '{"type":"resumed","audio_position_ms":4100}' "$BASE/api/conversations/$CID/events"
step "POST /api/answer (503 without key, 200 with)" "200|503" -X POST -H "$AUTH" -H "$JSON" -d '{"question":"What is this about?","context":"We the People...","title":"Preamble","audio_position_ms":4100}' "$BASE/api/answer"

echo "-- webhook test"
step "POST /api/webhooks/:id/test" 200 -X POST -H "$AUTH" "$BASE/api/webhooks/$WID/test"
echo "     $BODY"
step "GET /api/webhooks" 200 -H "$AUTH" "$BASE/api/webhooks"

echo "-- conversations"
step "GET /api/conversations" 200 -H "$AUTH" "$BASE/api/conversations?queue_item_id=$QID"
echo "$BODY" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(d),null,2)))'

echo "== $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
