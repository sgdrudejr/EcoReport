# EcoReport Dashboard

이 디렉터리는 EcoReport의 로컬 Next.js 대시보드입니다.

## 역할

- 날짜별 산출물을 서버에서 직접 읽어 UI로 렌더링
- 계좌 현황, 실행 계획, 브리핑, 실험 분석 패널을 한 화면에 통합
- 실험 UI를 글로벌 토글로 운영

## 실행

```bash
cd /Users/seo/stock-pilot/dashboard
npm install
npm run dev -- --hostname 0.0.0.0
```

검증:

```bash
npm run build
```

## 주요 구조

- `app/page.tsx`: 메인 대시보드 조립
- `components/MainNav.tsx`: 우측 상단 네비게이션 + `테스트 UI` 토글
- `components/ExperimentalUiProvider.tsx`: 실험 UI 글로벌 상태
- `components/ExperimentalVisibility.tsx`: 실험 UI 표시 래퍼
- `components/ExecutionListTable.tsx`: Stage 4 실행 리스트와 신뢰도 뱃지
- `components/FeedbackPanel.tsx`: 피드백 대시보드
- `components/AllocationHeatmap.tsx`: 배분 히트맵
- `components/ClusterMap.tsx`: 상관관계 클러스터 표시

## 데이터 원칙

- 대시보드는 가능한 한 서버에서 파일을 직접 읽습니다.
- 새 분석을 위해 대시보드가 별도 API 호출을 하지 않습니다.
- 주요 입력은 아래 파일들입니다.

### 핵심 입력

- `data/portfolio/latest.json`
- `data/analysis-state/YYYY-MM-DD/stage3-quant-scores.json`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`
- `data/analysis-state/YYYY-MM-DD/holding-clusters.json`
- `data/feedback/analysis/*.json`

## 실험 UI

상단 우측 `테스트 UI` 토글이 실험 영역 전체를 켜고 끕니다.

현재 토글 대상:

- 배분 히트맵
- 실행계획 신뢰도 뱃지
- 피드백 대시보드
- 상관관계 클러스터

## 개발 시 체크포인트

- `npm run build`가 통과하는가
- 토글 off에서 실험 UI가 DOM/인덱스에 남지 않는가
- 최신 피드백 파일이 없을 때도 빈 상태로 안전하게 보이는가
- 클러스터 데이터가 없어도 깨지지 않는가
