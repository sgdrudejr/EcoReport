# Stage 7 Strategy Provider

## Canonical Provider: Qwen API

Stage 7 전략 탐색의 기본 provider는 **Qwen API**입니다.

이 단계의 역할은:

- Windows 로컬 LLM이 이미 압축한 대용량 리포트 병합본
- Stage 2 구조화 extract
- Stage 4 research agenda
- Stage 6 rich briefing

을 읽고, 최종적으로 **투자 가능한 JSON 액션 후보**를 만드는 것입니다.

즉, 이 단계는 검색 엔진이 아니라 **판단/정리 엔진**입니다.

## 역할 분리 원칙

### 1. Windows Local LLM

- 긴 PDF
- 많은 청크
- 리포트별 병합 요약
- 시장 전체 병합

같은 **대용량 문서 처리**를 담당합니다.

### 2. Qwen API

- research agenda
- rich briefing
- strategy JSON

처럼 **압축된 근거에서 인사이트를 정리하는 작업**만 담당합니다.

### 3. Gemini Deep Research

- 새 정책/산업/기업 뉴스
- 외부 반론
- 추가 검색 근거
- follow-up / refinement

같은 **외부 신규 조사 보강**에만 사용합니다.

## Canonical Script

```bash
.venv/bin/python scripts/build-stage2-strategy-qwen.py --date YYYY-MM-DD
```

레거시 호환을 위해 아래 파일명도 남아 있습니다.

```bash
.venv/bin/python scripts/build-stage2-strategy-gemini.py --date YYYY-MM-DD
```

하지만 내부 구현과 운영 의미는 모두 **Qwen 전략 생성기** 기준으로 봅니다.

## run-strategy-pipeline.sh 플래그

권장:

```bash
bash scripts/run-strategy-pipeline.sh --date 2026-04-10 --qwen-stage2 --strict-qwen-stage2
```

레거시 호환:

```bash
bash scripts/run-strategy-pipeline.sh --date 2026-04-10 --gemini-stage2 --strict-gemini-stage2
```

위 legacy 플래그도 현재는 같은 Qwen 경로로 연결됩니다.

## 실패 해석

- `Qwen Stage 7 실행 실패`
  - DashScope 키
  - 네트워크
  - rate limit / quota
  - JSON 형식 오류

- `Gemini Deep Research 실패`
  - Stage 7 실패와 별개입니다.
  - 이 경우는 외부 추가 조사 레이어가 빠지는 것이지, Qwen 전략 판단 단계 자체의 실패와는 다릅니다.

## 운영 판단 기준

1. 문서량이 크면 먼저 Windows 로컬 LLM로 보냅니다.
2. 이미 압축된 결과에서 토픽/전략 판단이 필요하면 Qwen API를 씁니다.
3. 외부 신규 사실과 검색 결과를 붙여야 하면 Gemini Deep Research를 씁니다.
