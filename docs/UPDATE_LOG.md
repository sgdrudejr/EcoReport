# EcoReport Update Log

이 문서는 `EcoReport`의 구조/기능/운영 방식이 어떤 상태까지 올라왔는지 날짜순으로 기록합니다.
목적은 세 가지입니다.

- 다른 날짜에 다시 열어봐도 “지금 어디까지 됐는지” 빠르게 파악
- 다른 사람/다른 에이전트가 이어받을 때 회복 시간 단축
- README가 너무 길어지지 않게 최근 변경 사항을 별도로 추적

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

1. [README.md](/Users/seo/stock-pilot/README.md)
2. [docs/STAGE_1_4_ARCHITECTURE.md](/Users/seo/stock-pilot/docs/STAGE_1_4_ARCHITECTURE.md)
3. [docs/OPERATOR_RUNBOOK.md](/Users/seo/stock-pilot/docs/OPERATOR_RUNBOOK.md)
4. 이 [docs/UPDATE_LOG.md](/Users/seo/stock-pilot/docs/UPDATE_LOG.md)
