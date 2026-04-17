# EcoReport Update Log

이 문서는 `EcoReport`의 구조/기능/운영 방식이 어떤 상태까지 올라왔는지 날짜순으로 기록합니다.
목적은 세 가지입니다.

- 다른 날짜에 다시 열어봐도 “지금 어디까지 됐는지” 빠르게 파악
- 다른 사람/다른 에이전트가 이어받을 때 회복 시간 단축
- README가 너무 길어지지 않게 최근 변경 사항을 별도로 추적

## 2026-04-12

### 문서 체계 정리

- `README.md`를 현재 운영 구조 기준으로 전면 갱신
- `docs/DOCS_MAP.md`를 1차/2차/3차 문서 체계로 정리
- 기본 진입 문서를 줄이고, 과거성 문서는 보조 참고 문서로 역할 재정리

### 파이프라인 문서 현실화

- `docs/STAGE_1_4_ARCHITECTURE.md`를 실제 코드 기준 구조로 갱신
- `Stage 2.5 impact map`, `holding clusters`, `feedback loop`, `auto-tune`까지 아키텍처에 포함
- Stage 2 기본 경로를 `Gemini -> Claude -> Mock fallback` 체인 기준으로 정리

### 운영/실험 문서 갱신

- `docs/OPERATOR_RUNBOOK.md`를 현재 실행 명령과 산출물 기준으로 축약/정리
- `docs/EXPERIMENT_PLAYBOOK.md`에 피드백 루프, 실험 UI 토글, 클러스터 경고 검증 절차 추가

### 대시보드 문서 추가 정리

- `dashboard/README.md`를 기본 Next.js 템플릿에서 실제 운영 문서로 교체
- 글로벌 `테스트 UI` 토글, 실험 UI 구성 요소, 파일 기반 데이터 원칙을 명시

### 점수 체계 문서 보정

- `docs/SCORE_SYSTEM_V2.md`에 리서치 소스 적중률 보정과 클러스터 경고 맥락을 추가
- 피드백 기반 가중치 튜닝이 Stage 3/Stage 4와 어떻게 연결되는지 설명 강화

## 2026-04-06

## 2026-04-15

### 자동화 preflight 차단 로직 보정

- `scripts/check-automation-readiness.js`가 이제 리포트 수집 네트워크뿐 아니라 이전 거래일 `data/reports` fallback 자산도 함께 확인
- 직전 거래일 usable report bundle이 있으면 `reportCollectionReady=true` 로 간주해 `run-daily-automation-cycle.js`가 baseline을 입구에서 막지 않도록 보정
- baseline 차단 문구도 "네트워크 + fallback 모두 unavailable일 때만 중단"으로 정리

### 2026-04-15 재실행 복구

- 4월 15일 런을 다시 돌려 `stage1-report-extracts-v2`, `stage2-strategy-options`, `impact-map`, `stage3-quant-scores`, `stage4-execution-plan`, `knowledge/wiki/daily/2026-04-15.md`를 재생성
- dashboard `npm run build`까지 통과해 최신 4월 15일 산출물이 대시보드 경로에서 다시 읽히는 상태를 확인
- 남은 병목은 Gemini Deep Research Web 장시간 대기이며, 이후에는 이 단계에 대한 skip/reuse/fallback 정책을 추가하는 것이 우선 과제로 남음

### Data Architecture V2 설계 초안 추가

- `docs/DATA_ARCHITECTURE_V2.md` 추가
- source-specific raw data를 `normalized observations -> evidence graph -> decision features`로 올리는 구조 초안 문서화
- 아래 스키마 초안 추가
  - `docs/schemas/normalized-observations.schema.json`
  - `docs/schemas/evidence-graph.schema.json`
  - `docs/schemas/decision-features.schema.json`
- 목표를 "새 소스를 더 붙이는 것"에서 "모든 소스를 같은 엔터티/근거 모델 위에 올리는 것"으로 명확화

### KIS 3계좌 체계로 계좌 모델 정리

- `ISA / PENSION / KIS_MAIN` 기준으로 최신 포트폴리오 스냅샷이 유지되도록 sync pruning 추가
- 전략/워치리스트/보조 추천 매핑에서 `TOSS` 전술 역할을 `KIS_MAIN`으로 흡수
- 프롬프트/브리핑/위키 생성 경로도 3계좌 기준으로 정리

### Gemini Deep Research 오버레이 고정

- Stage 1 추출물과 포트폴리오를 묶는 `Stage 1.5` 프롬프트 생성 스크립트 추가
- Safari Gemini 웹 자동 주입/응답 저장 스크립트 추가
- Deep Research 결과를 Stage 1 fact anchor와 다시 합성하는 `Stage 1.6` rich briefing 단계 추가

### 아침 자동화 사이클 추가

- `npm run automation:daily` 러너 추가
- baseline 파이프라인 + Gemini Deep Research + Stage 1.6 + Stage 2~4 재계산 + wiki 갱신 + 검증까지 한 번에 실행
- 결과를 아래에 남기도록 고정
  - `data/analysis-state/YYYY-MM-DD/automation-cycle.json`
  - `knowledge/daily/YYYY-MM-DD-automation-cycle.md`

### 자동화 안정성 보강

- Safari focus churn 완화
- Stage 2 Gemini JSON 재시도 로직 추가
- baseline 단계에서 전략/위키 중복 실행을 줄여 아침 자동화 효율 개선

### 대시보드 의사결정 구조 재배치

- 홈 흐름을 `Macro View -> Strategy -> Action`으로 재배치
- 시나리오 트리, 촉매 일정, 체크포인트, 계좌별 목표, 포트폴리오 시사점, 계좌별 실행안을 단계별 구좌에 노출

### 문서 체계 재정리

- `docs/DOCS_MAP.md`
- `docs/MULTI_TOOL_HANDOFF.md`
- `docs/EXPERIMENT_PLAYBOOK.md`

를 추가해 여러 코딩 프로그램과 담당자가 같은 기준으로 작업할 수 있게 정리

## 2026-04-04

### 운영 기준 변경

- `Vercel`을 1순위 운영 채널에서 내리고, `Mac Mini + localhost:3000`을 기본 운영 경로로 전환
- 외부 공개 배포가 깨지더라도 일일 운영은 막히지 않도록 정리
- `data` 브랜치와 원격 배포는 보조 채널로 유지

### Stage 1~4 파이프라인

- 리포트 수집 → 전문 텍스트화 → RAG → Stage 1~4 실행까지 일일 파이프라인 고정
- 대표 러너:
  - `bash scripts/run-daily-system.sh --date YYYY-MM-DD`
  - `bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD`

### 리포트 수집 / 텍스트화

- 네이버 리서치 6종 + 신한투자증권 리포트 수집
- 수집 후 반드시 전문 텍스트화 수행
- `pdftotext` 우선, 실패 시 OCR fallback 적용
- 결과 파일:
  - `data/reports/YYYY-MM-DD/index.json`
  - `data/reports/YYYY-MM-DD/text/*.txt`
  - `data/reports/YYYY-MM-DD/crawl-manifest.json`
  - `data/reports/YYYY-MM-DD/text-manifest.json`

### RAG 코퍼스

- 리포트 원문 코퍼스 구축
- 포트폴리오 스냅샷 코퍼스 구축
- 병렬 RAG 코퍼스로 결합
- 결과 파일:
  - `data/reports/YYYY-MM-DD/rag/*`
  - `data/portfolio/rag/YYYY-MM-DD/*`
  - `knowledge/rag/YYYY-MM-DD/*`

### 경제 리포트

- Gemini 기반 리치 경제 브리핑 생성
- 대시보드와 `/reports`에서 아래 메타를 같이 표시
  - 활용 리포트 수
  - 사용 청크 수
  - 후보 청크 수
  - 요약 전용 청크 수
- 섹션별 태그 칩, 체크 포인트, 액션 포인트 노출

### 어드바이저 브리핑

- Stage 4 실행계획 기반 브리핑 생성
- `/reports`에서 경제 리포트와 어드바이저 브리핑을 분리 표시
- 생성 결과가 로컬뿐 아니라 `data` 브랜치에도 동기화되도록 보정

### 점수체계 v2

- 구조: `BaseScore - RiskPenalty`
- BaseScore 구성:
  - Allocation
  - Tech
  - Report
  - Regime Fit
  - Stage 2
- Coverage-aware weighting 적용
- RiskPenalty 구성:
  - Data Quality
  - Concentration
  - Regime Stress
  - Tail risk는 스키마만 열어두고 미적용

### 현금파킹 점수 보정

- 현금파킹 자산(`KOFR` 등)을 일반 위험자산처럼 RSI/MACD 위주로 깎지 않도록 Stage 3 보정 로직 추가
- 현재 레짐 + 목표 현금 비중을 반영한 정책 보정 점수를 사용
- 2026-04-03 기준:
  - ISA 총점 `32점 → 39점`
  - 포트폴리오 총점 `38점 → 42점`

### 대시보드 개선

- 홈 한 화면에서 확인 가능:
  - 시장 지표
  - 포트폴리오 스냅샷
  - 운용 가이드
  - 종목 추천
  - 경제 리포트 요약
  - 어드바이저 브리핑
- 계좌별 설명 강화:
  - 왜 이 점수인가
  - 점수를 올리려면
  - 기술 상위 신호
  - 리포트 근거
  - 액션 포인트

### 추천 보드

- `코어 ETF / 섹터 ETF / 개별주` 3레인 구조
- Stage 1 리포트 테마 + Stage 2 전략 후보 + Stage 3 기술점수 반영
- 레인은 점수순 정렬

### 현재 기준 검증 상태

`http://localhost:3000` 기준으로 아래는 확인됨:

- 포트폴리오 스냅샷 정상 표시
- 경제 리포트 요약 정상 표시
- 어드바이저 브리핑 정상 표시
- 추천 보드 3레인 표시
- 계좌별 점수와 설명 표시

### 아직 남은 핵심 과제

- `impact-map.json` 구현
  - 리포트-계좌 양방향 영향 확정 레이어
- 모바일/PC 전용 레이아웃 분리 고도화
- ETF 외부 탐색(웹 검색 기반) 추가
- 계좌 코멘트를 사건 → 자산군 → 계좌 액션 흐름으로 더 정교화

## 사용 방법

새 담당자/새 에이전트는 아래 순서로 확인합니다.

1. [README.md](../README.md)
2. [docs/DOCS_MAP.md](DOCS_MAP.md)
3. [docs/MULTI_TOOL_HANDOFF.md](MULTI_TOOL_HANDOFF.md)
4. [docs/OPERATOR_RUNBOOK.md](OPERATOR_RUNBOOK.md)
5. 이 [docs/UPDATE_LOG.md](UPDATE_LOG.md)
