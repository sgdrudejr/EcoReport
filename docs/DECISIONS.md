# DECISIONS

로컬 PDF 리포트 오케스트레이터의 핵심 설계 결정을 기록한다.

## 1. 왜 Mac Mini / Windows 분리 구조인가

- 결정:
  - Mac Mini는 오케스트레이션과 파일 파이프라인 담당
  - Windows PC(RTX 5070 Ti)는 llama-server 추론 담당
- 이유:
  - PDF 수집/전처리/배치 제어와 GPU 추론을 분리하면 운영이 단순해진다
  - Mac Mini는 항상성 있는 배치 호스트 역할에 적합하고, Windows PC는 GPU 자원을 집중적으로 쓰는 추론 노드 역할에 적합하다
  - 추론 서버를 분리하면 모델 교체나 서버 튜닝이 오케스트레이터 코드와 덜 결합된다

## 2. 왜 WOL + LAN API 구조인가

- 결정:
  - Mac Mini에서 Windows를 LAN으로 깨우고, 이후 OpenAI-compatible HTTP API로 붙는다
- 이유:
  - 같은 LAN에서 가장 단순하고 비용이 적은 제어 방식이다
  - 오케스트레이터가 원격 GUI 제어나 복잡한 에이전트를 몰라도 된다
  - 추론 준비 여부를 API 응답으로 바로 판별할 수 있다

## 3. 왜 full shutdown 대신 sleep/wake 전략을 우선하는가

- 결정:
  - 현 단계 기본 전략은 `wake = WOL`, `stop = manual`, `full shutdown automation = later`
- 이유:
  - WOL은 sleep 상태에서 검증되었지만, 완전 종료(S5)에서는 불안정하거나 실패할 수 있다
  - 신뢰 가능한 원격 종료 경로도 아직 확보되지 않았다
  - 자동 종료까지 억지로 붙이면 운영 신뢰도가 떨어질 수 있다

## 4. 왜 raw PDF direct input을 금지하는가

- 결정:
  - PDF 원문 전체를 한 번에 LLM으로 보내지 않는다
- 이유:
  - 긴 리포트는 길이와 잡음이 커서 요약 품질과 안정성이 급격히 흔들린다
  - 표/수치/반복 문구가 많아 구조적 추출 품질이 떨어진다
  - chunk 단위 처리 후 병합하는 편이 재시도, 캐시, 오류 격리에 유리하다

## 5. 왜 chunk summary -> merge 구조인가

- 결정:
  - `chunk_text -> chunk_summary JSON -> report_summary -> final_market_view` 구조를 유지한다
- 이유:
  - 병합 단계 입력을 구조화된 JSON으로 제한하면 노이즈가 줄고 일관성이 높아진다
  - chunk 원문을 다시 병합 단계에 넣으면 컨텍스트가 비대해지고 중복이 커진다
  - provenance와 후속 DB 적재에도 JSON 요약이 더 적합하다

## 6. 왜 unsupported parameter를 제거해야 하는가

- 결정:
  - local llama-server에 OpenAI 전용/비표준 파라미터를 보내지 않는다
- 이유:
  - 실제로 `prompt_cache_retention`는 `invalid_request_error`를 유발할 수 있다
  - Windows llama-server는 OpenAI-compatible이지 OpenAI 완전 동일 구현이 아니다
  - 안정적인 운영을 위해 현재는 `response_format`과 `chat_template_kwargs(enable_thinking false)` 중심의 최소 파라미터 집합을 유지해야 한다

## 7. 현재까지의 설계 방향 요약

- 추론은 Windows GPU 서버에 맡긴다
- 배치 제어와 문서화는 Mac Mini에서 책임진다
- 긴 문서는 청크화 후 구조화 요약을 병합한다
- 전원 제어는 wake만 자동화하고 종료는 보수적으로 다룬다
- 로컬 llama-server에는 최소 호환 파라미터만 보낸다
