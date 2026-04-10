# Vercel Deploy Runbook

## 목표

EcoReport의 배포 채널을 아래처럼 분리합니다.

- 로컬 Mac Mini 대시보드는 기본 채널이며, 운영 흐름에서 계속 우선합니다.
- Vercel은 보조 채널이며, 명시적으로 요청했을 때만 배포합니다.

즉, "로컬은 항상 반영", "Vercel은 필요할 때만 반영"이 기본 규칙입니다.

## 현재 트리거 규칙

Vercel 워크플로 `.github/workflows/deploy.yml` 은 아래 세 경우에만 실행됩니다.

1. GitHub Actions `workflow_dispatch` 수동 실행
2. GitHub `repository_dispatch` 이벤트 `deploy-vercel`
3. `main` 브랜치에서 `.vercel-deploy-trigger` 파일이 변경된 push

중요:

- 일반 코드 push
- `data` 브랜치 갱신
- Mac Mini 분석 사이클 완료

만으로는 Vercel 배포가 자동 실행되지 않습니다.

## 수동으로 바로 Vercel 배포하기

로컬에서 GitHub API로 바로 Vercel 배포를 요청하려면:

```bash
cd /Users/seo/stock-pilot
GITHUB_TOKEN=... node scripts/dispatch-vercel-deploy.js --reason "share latest dashboard"
```

필수 조건:

- `GITHUB_TOKEN` 에 이 저장소 `repo` 권한 또는 동등 권한이 있어야 함

## Git 신호로 Vercel 배포하기

Git 커밋 자체를 배포 신호로 쓰고 싶으면:

```bash
cd /Users/seo/stock-pilot
bash scripts/request-vercel-deploy-signal.sh "phone preview refresh"
git add .vercel-deploy-trigger
git commit -m "chore: request vercel deploy"
git push origin main
```

동작 방식:

- 스크립트가 `.vercel-deploy-trigger` 파일에 요청 시각과 사유를 기록
- 그 파일 변경이 `main` 에 push 되면 Vercel 워크플로가 실행

## 로컬 배포 규칙

Mac Mini self-hosted runner 워크플로 `.github/workflows/trigger-mac.yml` 은 분석 사이클 뒤에 항상 로컬 대시보드 배포 스크립트를 실행합니다.

기본 동작:

- `dashboard/node_modules` 가 없으면 `npm ci`
- 그다음 `dashboard` 에서 `npm run build`

필요하면 아래 환경변수로 실제 운영 명령을 덮어쓸 수 있습니다.

```bash
LOCAL_DASHBOARD_DEPLOY_CMD='cd dashboard && npm ci && npm run build && launchctl kickstart -k gui/$(id -u)/com.ecoreport.dashboard'
```

선택 옵션:

- `LOCAL_DASHBOARD_DEPLOY_CMD`: 로컬 배포 전체 명령을 직접 지정
- `LOCAL_DASHBOARD_INSTALL_MODE=always`: 매번 `npm ci`
- `LOCAL_DASHBOARD_INSTALL_MODE=never`: 의존성 설치를 건너뜀

## GitHub Secrets

Vercel 배포 워크플로에는 아래 secret 이 필요합니다.

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

## 운영 원칙 요약

- 로컬 Mac Mini 대시보드가 1순위
- Vercel은 수동/신호 기반 보조 채널
- 원격 배포 실패가 로컬 운영을 막지 않도록 유지
