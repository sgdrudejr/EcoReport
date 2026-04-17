# RUNBOOK

이 문서는 Mac Mini에서 로컬 PDF 리포트 오케스트레이터를 운영할 때 쓰는 실행 절차다.

## 1. 기본 원칙

- `localhost` 또는 `127.0.0.1`를 쓰지 않는다
- 항상 Windows LLM 서버 `http://192.168.0.218:8080/v1`에 붙는다
- local llama-server 호출에는 unsupported 파라미터를 보내지 않는다
- 종료 자동화는 현재 기본 전략이 아니다

## 2. 기본 환경

```bash
cd /Users/seo/Documents/Playground/economy-report
export LLM_BASE_URL="http://192.168.0.218:8080/v1"
export LLM_MODEL="${LLM_MODEL:-Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf}"
```

## 3. Windows LLM 연결 테스트 명령

```bash
cd /Users/seo/Documents/Playground/economy-report
LLM_BASE_URL="http://192.168.0.218:8080/v1" \
LLM_MODEL="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf" \
.venv/bin/python scripts/test_local_llm_connection.py
```

정상 시 기대 결과:

- `LLM connection OK: http://192.168.0.218:8080/v1/chat/completions | model=...`

## 4. Mac Mini에서 전체 배치 실행 명령

```bash
cd /Users/seo/Documents/Playground/economy-report
LLM_BASE_URL="http://192.168.0.218:8080/v1" \
LLM_MODEL="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf" \
bash scripts/run-local-report-orchestrator.sh
```

특정 날짜만:

```bash
cd /Users/seo/Documents/Playground/economy-report
LLM_BASE_URL="http://192.168.0.218:8080/v1" \
LLM_MODEL="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf" \
bash scripts/run-local-report-orchestrator.sh --date 2026-04-14
```

샘플 1건만:

```bash
cd /Users/seo/Documents/Playground/economy-report
LLM_BASE_URL="http://192.168.0.218:8080/v1" \
LLM_MODEL="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf" \
bash scripts/run-local-report-orchestrator.sh --date 2026-04-14 --limit 1 --force
```

## 5. deep 모드 실행 명령

```bash
cd /Users/seo/Documents/Playground/economy-report
LLM_BASE_URL="http://192.168.0.218:8080/v1" \
LLM_MODEL="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf" \
bash scripts/run-local-report-orchestrator.sh --detail deep
```

특정 날짜 deep:

```bash
cd /Users/seo/Documents/Playground/economy-report
LLM_BASE_URL="http://192.168.0.218:8080/v1" \
LLM_MODEL="Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf" \
bash scripts/run-local-report-orchestrator.sh --date 2026-04-14 --detail deep
```

## 6. WOL 테스트 명령

명시적 Wake-on-LAN 테스트:

```bash
wakeonlan A0:AD:9F:CD:47:D2
```

참고:

- Mac Mini에 `wakeonlan` 바이너리가 없으면 오케스트레이터 코드가 UDP magic packet 폴백을 사용한다
- WOL은 sleep 상태에서 검증되었지만, 완전 종료(S5) 상태에서는 성공률이 낮을 수 있다

## 7. 서버가 안 붙을 때 점검 순서

1. base URL이 정확한지 확인한다
   - 반드시 `http://192.168.0.218:8080/v1`
2. 수동 연결 테스트를 먼저 실행한다
   - `scripts/test_local_llm_connection.py`
3. 응답이 없으면 WOL을 보낸다
   - `wakeonlan A0:AD:9F:CD:47:D2`
4. 최소 60초 기다린 뒤 연결 테스트를 다시 실행한다
5. 그래도 실패하면 Windows가 정말 켜졌는지, 같은 LAN에 있는지 확인한다
6. Windows가 절전 복귀 상태라면 llama-server 시작프로그램이 재실행되지 않았을 수 있으니 서버 프로세스 상태를 확인한다
7. `reports/logs/connection_test.json` 와 `reports/logs/startup_sequence.json`을 본다
8. shutdown 경로 문제와 연결 문제를 혼동하지 않는다
   - 현재 shutdown 자동화는 보류 상태다

## 8. unsupported parameter(prompt_cache_retention) 회피 규칙

- local llama-server에는 `prompt_cache_retention` 같은 OpenAI 전용/비표준 파라미터를 보내지 않는다
- 오케스트레이터 LLM 호출은 아래 두 가지 중심으로 유지한다
  - `response_format`
  - `chat_template_kwargs: {"enable_thinking": false}`
- 세션 compact 또는 다른 상위 계층에서 `prompt_cache_retention` 관련 에러가 보여도, 먼저 오케스트레이터 코드와 별개 문제인지 분리해서 판단한다
- llama-server 연동 안정성이 흔들릴 때는 새 파라미터를 추가하기보다 현재 최소 파라미터 집합을 유지한다

## 9. 주요 산출물과 로그

- 최종 시장 뷰
  - `reports/merged/final_market_view.json`
  - `reports/merged/final_market_view.md`
- deep 최종 산출물
  - `reports/merged/final_market_view.deep.json`
  - `reports/merged/final_market_view.deep.md`
- 시작/연결 로그
  - `reports/logs/connection_test.json`
  - `reports/logs/startup_sequence.json`
- 실패/통계 로그
  - `reports/logs/failed_files.json`
  - `reports/logs/run_stats.json`

## 10. 현재 운영 결론

- 자동 wake는 사용 가능
- 자동 stop/full shutdown은 아직 운영 기본값이 아님
- 따라서 현재 권장 전략은 `wake via WOL`, `stop manually`, `shutdown automation later`
