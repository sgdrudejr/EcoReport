# EcoReport Repair Playbooks

이 문서는 검증기와 failure ledger가 경고를 낼 때 가장 먼저 따라갈 수리 경로를 정리합니다.

## Impact Map Empty

증상:

- Stage 1에 `portfolio_impacts_candidate`가 많은데 `impact-map.json`의 `impacts`가 비어 있음

먼저 볼 파일:

- `data/analysis-state/YYYY-MM-DD/stage1-report-extracts-v2.json`
- `data/portfolio/latest.json`
- `config/securities.json`
- `scripts/build-impact-map.js`

흔한 원인:

- `target_code`와 실제 포트폴리오 code 불일치
- alias / thematic trigger 누락
- 포트폴리오 snapshot에 code가 비어 있음
- Stage 1 candidate가 너무 넓거나 너무 약함

우선 조치:

```bash
cd /Users/seo/Documents/Playground/economy-report
node scripts/build-impact-map.js --date YYYY-MM-DD
```

다음 조치:

- `config/securities.json`의 alias / theme rule 보강
- Stage 1 candidate 생성 로직을 좁히기
- missing code 보정

## Stage 2 Missing Or Mock

증상:

- `stage2-strategy-options.json`이 없음

먼저 볼 파일:

- `.env`
- `scripts/build-stage2-strategy-qwen.py`
- `data/analysis-state/YYYY-MM-DD/stage2-run-log.json`

우선 조치:

```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/run-strategy-pipeline.sh --date YYYY-MM-DD --qwen-stage2
```

계속 실패하면 아래 작업도 실제 Stage 2 복구 후 진행합니다.

- 구조 검증
- Stage 3/4 UI 점검
- 회귀 테스트

실거래 판단 전에는 mock 산출물을 사용하지 않습니다.

## Portfolio Snapshot Incomplete

증상:

- `data/portfolio/latest.json`의 계좌가 `incomplete: true`
- holding `code`가 비어 있어 downstream 연결이 약함

먼저 볼 파일:

- `data/portfolio/latest.json`
- `dashboard/app/portfolio/update/page.tsx`
- `dashboard/lib/portfolio.ts`

우선 조치:

- 누락 스크린샷 재업로드
- 수기 보정
- code가 빠진 holding 보완

이 상태에서는 공격적 액션보다 데이터 품질 경고를 우선합니다.

## Stage 4 Missing Stage 1 Drivers

증상:

- Stage 4에 실행 문장은 있는데 `stage1Drivers[]`가 비어 있거나 id가 Stage 1과 연결되지 않음

먼저 볼 파일:

- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/impact-map.json`
- `scripts/build-stage4-execution-plan.js`

우선 조치:

```bash
cd /Users/seo/Documents/Playground/economy-report
node scripts/build-stage4-execution-plan.js --date YYYY-MM-DD
```

의미:

- 실행 레이어가 근거 사슬을 잃었다는 뜻이므로, 문장 품질보다 연결 품질을 먼저 고칩니다.
