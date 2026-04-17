# Local PDF LLM Orchestrator

Mac Mini에서 저장된 증권/산업/매크로 PDF를 읽고, Windows PC의 로컬 LLM 서버(`http://192.168.0.218:8080/v1`)로 구조화 요약을 생성하는 Python 배치 파이프라인입니다.

## 현재 source of truth

운영 상태와 세션 인계는 아래 문서를 우선 기준으로 봅니다.

- `docs/PROJECT_MEMORY.md`
- `docs/RUNBOOK.md`
- `docs/SESSION_HANDOFF.md`
- `docs/DECISIONS.md`

## 핵심 특징

- `PDF -> text -> clean -> chunk -> chunk별 JSON -> report_summary -> final_market_view` 순서를 강제합니다.
- 원문 PDF 전체를 한 번에 LLM에 보내지 않습니다.
- 병합 단계는 chunk 원문이 아니라 `chunk_summary JSON`만 사용합니다.
- 사람이 읽는 결과물(`final_market_view.md`)과 기계 처리용 결과물(`*.json`)을 같이 남깁니다.
- `--detail standard|deep` 모드를 지원합니다. `deep`에서는 더 작은 청크, 더 풍부한 필드, 더 긴 병합 인사이트를 생성합니다.
- 동일 PDF가 이미 처리되었고 fingerprint가 같으면 캐시를 보고 스킵합니다.
- 배치 시작 전 반드시 `192.168.0.218:8080`에 아주 짧은 연결 테스트를 먼저 수행합니다.
- 서버가 응답하지 않으면 Mac Mini에서 Windows PC로 Wake-on-LAN을 보내고, 60초 대기 후 다시 확인합니다.
- 연결 실패/요약 실패는 `reports/logs/`에 남기고, 가능한 범위에서 다음 문서를 계속 처리합니다.
- LLM 호출은 `openai.OpenAI` 호환 클라이언트를 사용합니다.

## 출력 구조

- `reports/raw_pdfs/YYYY-MM-DD/*.pdf`
- `reports/extracted_text/YYYY-MM-DD/*.txt`
- `reports/chunks/YYYY-MM-DD/*.json`
- `reports/chunk_summaries/YYYY-MM-DD/*.json`
- `reports/report_summaries/YYYY-MM-DD/*.json`
- `reports/merged/final_market_view.json`
- `reports/merged/final_market_view.md`
- `reports/logs/failed_files.json`
- `reports/logs/run_stats.json`
- `reports/logs/startup_sequence.json`

## 실행 방법

전체 배치:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-local-report-orchestrator.sh
```

특정 날짜만:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-local-report-orchestrator.sh --date 2026-04-14
```

샘플 1건만:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-local-report-orchestrator.sh --date 2026-04-14 --limit 1
```

딥 모드:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-local-report-orchestrator.sh --detail deep
```

LLM 호출 없이 deep 청크만 생성:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-local-report-orchestrator.sh --date 2026-04-15 --detail deep --chunks-only
```

연결 테스트만:

```bash
cd /Users/seo/Documents/Playground/economy-report
.venv/bin/python scripts/test_local_llm_connection.py
```

## 설정

기본 설정 파일:

- [config/local-report-orchestrator.json](/Users/seo/Documents/Playground/economy-report/config/local-report-orchestrator.json)

환경변수로 override 가능:

- `LLM_BASE_URL`
- `LLM_MODEL`
- `LLM_API_KEY`
- `REPORT_ORCHESTRATOR_DETAIL`
- `WINDOWS_HOST`
- `WINDOWS_MAC`
- `REPORT_ORCHESTRATOR_WOL_WAIT_SECONDS`
- `REPORT_ORCHESTRATOR_AUTO_WAKE`
- `REPORT_ORCHESTRATOR_SHUTDOWN_METHOD`
- `WINDOWS_SSH_TARGET`
- `WINDOWS_SHUTDOWN_COMMAND`
- `REPORT_ORCHESTRATOR_BASE_URL`
- `REPORT_ORCHESTRATOR_MODEL`
- `REPORT_ORCHESTRATOR_API_KEY`
- `REPORT_ORCHESTRATOR_INPUT_ROOT`
- `REPORT_ORCHESTRATOR_OUTPUT_ROOT`
- `REPORT_ORCHESTRATOR_MAX_REPORTS`
- `REPORT_ORCHESTRATOR_TIMEOUT_SECONDS`

중요:

- `localhost` 또는 `127.0.0.1`를 사용하지 않습니다.
- 모든 LLM 호출은 `http://192.168.0.218:8080/v1/chat/completions`로 보냅니다.
- 기본 `model` 값은 `Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf`이며, `LLM_MODEL`로 덮어쓸 수 있습니다.
- Windows 종료 자동화 코드는 `ssh` 방식 설정을 지원하지만, 현재 운영 권장 전략은 `wake via WOL`, `stop manually`, `full shutdown automation later` 입니다.

## 운영 메모

- PDF 전문 텍스트가 이미 `data/reports/YYYY-MM-DD/text/*.txt`에 있으면 우선 재사용합니다.
- 전문 텍스트가 없을 때만 로컬 `pdftotext`를 사용합니다.
- 청크 기본값은 `7000~9000자`, overlap `900자`입니다.
- `deep` 모드에서는 기본적으로 더 작은 청크(`4200~6000자`)와 더 큰 출력 토큰 한도를 사용합니다.
- chunk 요약 실패는 1회 재시도 후 `reports/logs/failed_files.json`에 남깁니다.
- 최종 시장 뷰 병합은 `report_summary JSON`만 입력으로 사용합니다.
- `deep` 모드에서는 `market_implications`, `monitoring_points`, `event_timeline`, `variant_view`, `consensus_gap`, `portfolio_relevance`, `scenario_map`, `monitoring_calendar`, `opportunity_buckets` 같은 추가 인사이트 필드가 생성될 수 있습니다.
- Mac Mini에 `wakeonlan` 명령이 없으면 오케스트레이터가 직접 UDP magic packet을 보내는 방식으로 폴백합니다.
- 종료 자동화를 쓰려면 `REPORT_ORCHESTRATOR_SHUTDOWN_METHOD=ssh` 와 `WINDOWS_SSH_TARGET=user@192.168.0.218` 처럼 SSH 타깃을 설정해야 합니다. 다만 현재는 신뢰 가능한 원격 종료 경로가 부족해서 운영 기본값은 `shutdown_method=none` 입니다.
