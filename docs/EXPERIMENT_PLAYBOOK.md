# EcoReport Experiment Playbook

실험은 “돌아갔다”가 아니라 “다시 검증 가능한 상태로 남겼다”를 기준으로 합니다.

## 기본 원칙

1. 날짜를 고정합니다.
2. 성공 기준을 파일 또는 화면으로 명시합니다.
3. 실패를 로그/산출물에 남깁니다.
4. 운영 플로우가 바뀌면 문서도 같이 고칩니다.

## 표준 실험 세트

### 1. 전략 파이프라인 스모크 테스트

```bash
cd /Users/seo/stock-pilot
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD
```

성공 기준:

- `stage1-report-extracts-v2.json`
- `stage2-run-log.json`
- `impact-map.json`
- `stage3-quant-scores.json`
- `holding-clusters.json`
- `stage4-execution-plan.json`

### 2. 피드백 루프 테스트

```bash
cd /Users/seo/stock-pilot
node scripts/build-feedback-snapshot.js --date YYYY-MM-DD
node scripts/build-feedback-analysis.js --date YYYY-MM-DD
node scripts/build-feedback-report.js --date YYYY-MM-DD
node scripts/auto-tune-weights.js --date YYYY-MM-DD --dry-run
```

성공 기준:

- `data/feedback/snapshots/YYYY-MM-DD.json`
- `data/feedback/analysis/YYYY-MM-DD-feedback.json`
- `reports/feedback-summary.md`
- dry-run 결과가 JSON으로 출력됨

### 3. 일일 전체 러너 테스트

```bash
cd /Users/seo/stock-pilot
bash scripts/run-daily-system.sh --date YYYY-MM-DD --skip-push
```

성공 기준:

- `system-health.json`
- `automation-cycle.json`
- `reports/daily/YYYY-MM-DD-briefing.md`

### 4. 대시보드 빌드 테스트

```bash
cd /Users/seo/stock-pilot/dashboard
npm run build
```

성공 기준:

- Next build 통과

### 5. 실험 UI 토글 테스트

화면 확인 포인트:

- 상단 우측 `테스트 UI`가 글로벌 토글인가
- off일 때 실험 섹션이 모두 숨겨지는가
- on일 때 아래가 함께 보이는가
  - 배분 히트맵
  - 실행 신뢰도 뱃지
  - 피드백 대시보드
  - 상관관계 클러스터

### 6. 클러스터 경고 테스트

```bash
cd /Users/seo/stock-pilot
node scripts/build-holding-clusters.js --date YYYY-MM-DD
node scripts/build-stage4-execution-plan.js --date YYYY-MM-DD
```

성공 기준:

- `holding-clusters.json` 생성
- Stage 4 `stagedBuys`에 cluster warning이 붙을 수 있음

## 실패 디버깅 루프

1. 실패 날짜를 고정합니다.
2. 해당 단계 스크립트만 재실행합니다.
3. `data/analysis-state/YYYY-MM-DD/*`와 `logs/*.log`를 봅니다.
4. 수정 후 스모크 테스트를 다시 합니다.
5. 운영 기준이 달라졌으면 문서를 갱신합니다.

## 실험 후 반드시 남길 것

- 날짜
- 실행 명령
- 성공 여부
- 생성된 핵심 파일
- 남은 리스크

기록 위치:

- 장기 변경: `docs/UPDATE_LOG.md`
- 당일 상세: `knowledge/daily/*`, `system-health`, `automation-cycle`
