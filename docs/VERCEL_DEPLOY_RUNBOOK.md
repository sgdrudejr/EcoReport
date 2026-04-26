# Vercel Deploy Runbook

## 목표

현재 Vercel 배포는 중단 상태입니다. 완성된 데이터가 안정적으로 생성될 때까지 GitHub Actions Vercel workflow를 두지 않습니다.

- 로컬 Mac Mini 대시보드는 기본 채널이며, 운영 흐름에서 계속 우선합니다.
- Vercel은 보조 채널이지만 현재는 비활성화되어 있습니다.

즉, "로컬은 항상 반영", "Vercel은 완성 데이터 안정화 이후 재개"가 기본 규칙입니다.

## 현재 트리거 규칙

Vercel 워크플로 `.github/workflows/deploy.yml` 은 제거되어 실행되지 않습니다.

재개 전까지 아래 방식은 사용하지 않습니다.

- GitHub Actions `workflow_dispatch` 수동 실행
- GitHub `repository_dispatch` 이벤트 `deploy-vercel`
- `main` 브랜치의 `.vercel-deploy-trigger` 변경
- `scripts/dispatch-vercel-deploy.js`
- `scripts/request-vercel-deploy-signal.sh`

## 로컬 배포 규칙

Mac Mini self-hosted runner 워크플로 `.github/workflows/trigger-mac.yml` 은 현재 분석 사이클과 완성 데이터 push gate만 수행합니다.

완성 데이터가 안정화되기 전까지 아래 동작은 자동 실행하지 않습니다.

- 로컬 대시보드 build/deploy
- Vercel build/deploy
- 원격 공개 대시보드 갱신

## 운영 원칙 요약

- 로컬 Mac Mini 대시보드가 1순위
- Vercel은 완성 데이터 안정화 전까지 비활성화
- 원격 배포 대신 `system-health=ok`인 데이터 산출을 우선
