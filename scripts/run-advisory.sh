#!/usr/bin/env bash
# 어드바이저 컨텍스트를 조립하고 일간 브리핑 생성을 호출하는 스크립트입니다.

set -euo pipefail

ROOT_DIR="${ROOT_DIR:-${ECOREPORT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
DATE="$(node "$ROOT_DIR/scripts/resolve-cycle-date.js")"
TIME="$(date +%H%M)"
SKIP_LLM="${SKIP_LLM:-0}"
MANUAL_LLM="${MANUAL_LLM:-0}"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --date)
      DATE="$2"
      shift 2
      ;;
    --skip-llm)
      SKIP_LLM=1
      shift
      ;;
    --manual-llm)
      MANUAL_LLM=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    *)
      DATE="$1"
      shift
      ;;
  esac
done

REPORT_DIR="$ROOT_DIR/reports/daily"
PROMPT_FILE="$REPORT_DIR/$DATE-$TIME-advisory-prompt.md"
BRIEFING_FILE="$REPORT_DIR/$DATE-$TIME-briefing.md"

mkdir -p "$REPORT_DIR"

if [[ "$FORCE" -eq 0 ]] && compgen -G "$REPORT_DIR/$DATE-*-briefing.md" > /dev/null; then
  echo "- 이미 오늘 브리핑 파일이 있습니다."
  echo "- 다시 생성하려면 --force 옵션을 사용하세요."
  exit 0
fi

echo "🧠 어드바이저 컨텍스트 조립 중..."
node "$ROOT_DIR/scripts/build-context.js" --date "$DATE" --output "$PROMPT_FILE" > /dev/null

API_KEY="${ANTHROPIC_API_KEY:-}"

if [[ "$MANUAL_LLM" == "1" ]]; then
  cat > "$BRIEFING_FILE" <<EOF
# EcoReport Manual Advisory Queue

- date: $DATE
- generated_at: $(date -Iseconds)
- llm_status: manual_queue
- prompt_file: $PROMPT_FILE

## Codex / Claude Code 사용법

1. 아래 프롬프트 파일을 Codex 또는 Claude Code에 열어주세요.
2. 출력은 오늘의 핵심 변화, 계좌별 액션, 다음 매수 시점 중심의 짧은 브리핑이면 충분합니다.
3. 결과를 이 파일 경로로 저장하면 대시보드에 바로 표시됩니다.

\`$BRIEFING_FILE\`

## 참고

- 오늘 컨텍스트 프롬프트: \`$PROMPT_FILE\`
- 자동 API 호출은 하지 않았습니다.
EOF

  echo "✅ 수동 LLM용 브리핑 큐 저장 완료: $BRIEFING_FILE"
  echo "📝 컨텍스트 프롬프트 저장 완료: $PROMPT_FILE"
  exit 0
fi

if [[ "$SKIP_LLM" == "1" || -z "$API_KEY" || "$API_KEY" == "sk-ant-xxxxx" ]]; then
  cat > "$BRIEFING_FILE" <<EOF
# EcoReport Advisory Placeholder

- date: $DATE
- generated_at: $(date -Iseconds)
- llm_status: skipped
- reason: API 비용 절약 또는 키 미설정 상태라 LLM 호출을 건너뜀
- prompt_file: $PROMPT_FILE

## Next Step

- 나중에 LLM을 활성화하려면 \`bash scripts/run-advisory.sh --date $DATE\` 를 다시 실행하세요.
- 현재는 컨텍스트 프롬프트만 생성된 상태입니다.
EOF

  echo "✅ 드라이런 브리핑 저장 완료: $BRIEFING_FILE"
  echo "📝 컨텍스트 프롬프트 저장 완료: $PROMPT_FILE"
  exit 0
fi

if command -v claude >/dev/null 2>&1; then
  echo "🧠 Claude CLI로 브리핑 생성 중..."
  claude -p < "$PROMPT_FILE" --output "$BRIEFING_FILE"
  echo "✅ 리포트 생성 완료: $BRIEFING_FILE"
  exit 0
fi

cat > "$BRIEFING_FILE" <<EOF
# EcoReport Advisory Pending

- date: $DATE
- generated_at: $(date -Iseconds)
- llm_status: pending
- reason: ANTHROPIC_API_KEY는 있지만 \`claude\` CLI를 찾지 못해 실행하지 못함
- prompt_file: $PROMPT_FILE

## Action Needed

- \`claude\` CLI 설치 후 다시 실행하거나, API 직접 호출 스크립트를 별도로 연결하세요.
EOF

echo "⚠️ claude CLI가 없어 placeholder 브리핑으로 대체했습니다: $BRIEFING_FILE"
