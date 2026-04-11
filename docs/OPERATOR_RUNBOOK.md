# EcoReport Operator Runbook

이 문서는 EcoReport를 실제로 운영할 때 필요한 최소 절차를 정리합니다.

## 기본 원칙

- 기준 운영은 `로컬 Mac Mini + 파일 기반 산출물`입니다.
- 전략 파이프라인의 중심은 `scripts/run-strategy-pipeline.sh`입니다.
- 전체 자동화의 중심은 `scripts/run-daily-system.sh`입니다.
- 문서는 코드와 같이 갱신합니다.

## 가장 많이 쓰는 명령

### 일일 전체 러너

```bash
cd /Users/seo/stock-pilot
bash scripts/run-daily-system.sh --date YYYY-MM-DD
```

자주 쓰는 옵션:

- `--skip-collect`
- `--skip-rag`
- `--skip-wiki`
- `--skip-verify`
- `--skip-push`
- `--gemini-stage2`
- `--mock-stage2`

### 전략 파이프라인만 재실행

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
```

자주 쓰는 옵션:

- `--gemini-stage2`
- `--claude-stage2`
- `--mock-stage2`
- `--skip-stage1-5-prompt`
- `--auto-tune-dry-run`
- `--auto-tune`

### 대시보드 실행

```bash
cd /Users/seo/stock-pilot/dashboard
npm run dev -- --hostname 0.0.0.0
```

## 하루 운영 권장 순서

### 1. 포트폴리오 최신화

가능하면 먼저 최신 계좌 상태를 반영합니다.

```bash
cd /Users/seo/stock-pilot
npm run portfolio:sync:kis -- --date YYYY-MM-DD
```

또는 대시보드에서 직접 반영:

- `/portfolio/update`

### 2. 일일 데이터 수집

전체 러너를 쓰지 않는 경우:

```bash
cd /Users/seo/stock-pilot
bash scripts/collect-report-assets.sh --date YYYY-MM-DD
node scripts/fetch-market-data.js --date YYYY-MM-DD
node scripts/calc-technicals.js --date YYYY-MM-DD
```

확인 파일:

- `data/reports/YYYY-MM-DD/index.json`
- `data/reports/YYYY-MM-DD/text-manifest.json`
- `data/market/YYYY-MM-DD.json`
- `data/technical/YYYY-MM-DD.json`

### 3. 전략 파이프라인 실행

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
```

이 파이프라인은 아래를 수행합니다.

1. Stage 1 추출
2. Stage 1.5 deep research prompt 백그라운드 생성
3. Stage 2 provider chain 실행
4. Stage 2.5 impact map 생성
5. Stage 3 점수화
6. holding clusters 생성
7. Stage 4 실행 계획 생성
8. feedback snapshot 생성
9. 선택적으로 feedback analysis + auto tune

### 4. 피드백 검증

피드백 루프만 다시 보고 싶으면:

```bash
cd /Users/seo/stock-pilot
node scripts/build-feedback-snapshot.js --date YYYY-MM-DD
node scripts/build-feedback-analysis.js --date YYYY-MM-DD
node scripts/build-feedback-report.js --date YYYY-MM-DD
node scripts/auto-tune-weights.js --date YYYY-MM-DD --dry-run
```

### 5. 위키 갱신

```bash
cd /Users/seo/stock-pilot
node scripts/build-llm-wiki.js --date YYYY-MM-DD
node scripts/publish-llm-wiki-to-vault.js
```

### 6. 검증

```bash
cd /Users/seo/stock-pilot
node scripts/verify-daily-system.js --date YYYY-MM-DD
cd dashboard
npm run build
```

## 성공 확인 체크포인트

### 전략 산출물

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `data/analysis-state/YYYY-MM-DD/stage2-run-log.json`
- `data/analysis-state/YYYY-MM-DD/impact-map.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/holding-clusters.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `reports/daily/YYYY-MM-DD-briefing.md`

### 피드백 산출물

- `data/feedback/snapshots/YYYY-MM-DD.json`
- `data/feedback/analysis/YYYY-MM-DD-feedback.json`
- `reports/feedback-summary.md`

### 자동화/검증

- `data/analysis-state/YYYY-MM-DD/system-health.json`
- `data/analysis-state/YYYY-MM-DD/automation-cycle.json`

## 대시보드 운영 포인트

### 기본 접속

- `http://localhost:3000`

### 실험 UI

상단 우측 `테스트 UI` 토글이 전체 실험 UI 노출 스위치입니다.

토글로 켜지는 항목:

- 배분 히트맵
- 실행 신뢰도 뱃지
- 피드백 대시보드
- 상관관계 클러스터

### 화면 검증 포인트

- Stage 4 실행 리스트가 정상 노출되는가
- 실험 UI 토글 on/off 시 실험 섹션이 함께 토글되는가
- 피드백 대시보드가 최신 `data/feedback/analysis` 파일을 읽는가
- 클러스터 0건일 때와 다건일 때 모두 깨지지 않는가

## 운영 중 자주 보는 파일

### 오늘 상태

- `data/analysis-state/YYYY-MM-DD/*`
- `reports/daily/YYYY-MM-DD-briefing.md`
- `knowledge/daily/YYYY-MM-DD-system-health.md`

### 장기 추적

- `data/feedback/analysis/*`
- `data/feedback/weight-history.jsonl`
- `knowledge/wiki/*`

## 자주 쓰는 디버깅 루프

1. 해당 날짜 디렉터리 확인
2. 실패 단계만 단독 재실행
3. `logs/*.log`와 `system-health` 확인
4. 코드 수정 후 `dashboard npm run build`와 관련 스크립트 재검증
5. 흐름이 바뀌면 문서 갱신

## 현재 운영상 주의점

- `holding-clusters.json`은 `data/analysis-state` 내부 생성물이므로 커밋 대상이 아닐 수 있습니다.
- `auto-tune`는 실제 `config/strategy.json`을 바꾸므로 먼저 `--dry-run`을 권장합니다.
- `feedback analysis`는 충분한 표본이 없으면 일부 지표가 비어 있을 수 있습니다.
