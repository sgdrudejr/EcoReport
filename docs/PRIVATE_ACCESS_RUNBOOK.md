# Private Access Runbook

## 목적

EcoReport를 공개 배포 없이 **Mac Mini 내부 실행 + 개인 원격 접속** 형태로 운영하기 위한 기준 문서입니다.

이 문서는 Vercel이 불안정하거나 불필요할 때 기본 운영 경로로 사용합니다.

## 권장 방식

기본 권장안은 **Tailscale tailnet 내부 접속**입니다.

이유:

- 대시보드를 공개 인터넷에 노출하지 않아도 됨
- 집 밖에서도 폰으로 접속 가능
- Vercel preview / branch deploy 실패와 무관하게 운영 가능
- 앱 구조를 크게 바꾸지 않고 바로 적용 가능

공식 참고:

- [Tailscale Docs](https://tailscale.com/docs)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)

위 문서 기준으로 `Tailscale Serve`는 tailnet 내부 다른 기기에서 로컬 서비스를 접근하게 해주며, 공개 노출은 `Funnel`을 별도로 사용합니다.

## 운영 구조

```text
Mac Mini
  ├─ EcoReport dashboard (localhost:3000)
  ├─ daily pipeline + files
  └─ Tailscale client

iPhone / iPad / Laptop
  ├─ Tailscale client
  └─ same tailnet login
```

즉:

- 대시보드는 Mac Mini에서만 실행
- 다른 기기는 같은 Tailscale 네트워크로만 접속

## 사용자 권한 체크리스트

아래 항목은 **사용자 직접 승인/로그인**이 필요합니다.

1. Mac Mini에 Tailscale 설치
2. 휴대폰/태블릿에 Tailscale 설치
3. 두 기기를 **같은 Tailscale 계정/tailnet**으로 로그인
4. macOS에서 Tailscale 네트워크 확장 승인
5. tailnet에서 HTTPS certificates/Serve 사용 가능 상태 확인
6. 원격에서 접속할 기기에도 Tailscale 로그인 유지

## Codex가 대신할 수 있는 것

- EcoReport 로컬 실행 명령 정리
- 포트/로그/실행 순서 문서화
- `localhost` 기준 대시보드 실행 스크립트 정리
- 로컬 파일 의존 경로 정리
- “공개 배포 없이 운영” 문서/체크리스트 유지

## Codex가 대신할 수 없는 것

- Tailscale 계정 로그인
- macOS 보안 승인 클릭
- 모바일 앱 로그인
- tailnet / DNS / certificate 관련 웹 콘솔 승인

## 운영 원칙

### 1. 공개 배포는 선택사항

Vercel은 더 이상 기본 운영 경로가 아닙니다.

- 기본: 로컬 + private access
- 선택: 필요할 때만 `data` 브랜치/원격 대시보드 병행

### 2. 데이터는 여전히 로컬 기준

EcoReport의 기준 데이터는 Mac Mini의 로컬 파일입니다.

- `data/`
- `knowledge/`
- `reports/`

즉 private access는 **접속 방식만 바꾸는 것**이고, 데이터 파이프라인 자체는 그대로 유지됩니다.

### 3. Vercel 실패가 일일 운영을 막지 않음

일일 루프는 아래만 돌면 됩니다.

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/run-daily-system.sh --date YYYY-MM-DD --skip-push
```

이렇게 하면:

- 수집
- 텍스트화
- RAG
- Stage 1~4
- 시스템 검증

까지 끝나고, 원격 배포 없이 Mac Mini 내부에서만 결과를 확인할 수 있습니다.

## 로컬 우선 실행 체크

대시보드 실행:

```bash
cd /Users/seo/Documents/Playground/EcoReport/dashboard
npm run dev
```

또는 운영 모드:

```bash
cd /Users/seo/Documents/Playground/EcoReport/dashboard
npm run build
npm run start
```

파이프라인 실행:

```bash
cd /Users/seo/Documents/Playground/EcoReport
bash scripts/run-daily-system.sh --date YYYY-MM-DD --skip-push
```

검증:

- `knowledge/daily/YYYY-MM-DD-system-health.md`
- `reports/daily/YYYY-MM-DD-briefing.md`
- `data/analysis-state/YYYY-MM-DD/stage4-execution-plan.json`

## 대체안

### 1. Tailscale

가장 추천.

- 개인용
- 외부에서도 접속 가능
- public deploy 불필요

### 2. ZeroTier

대안은 가능하지만, 현재 EcoReport 목적에서는 Tailscale보다 문서/운영성이 약간 덜 직관적입니다.

### 3. 같은 Wi-Fi 내부 접속만 사용

가장 단순하지만 외부에서는 접속할 수 없습니다.

### 4. Cloudflare Tunnel

공개 hostname 운영에는 좋지만, “오직 내 기기에서만 접속” 목적에는 Tailscale보다 과합니다.

## 추천 결론

현재 EcoReport 운영 기본값은 아래로 두는 것이 좋습니다.

1. **Mac Mini 로컬 실행**
2. **Tailscale tailnet 내부 접속**
3. 필요할 때만 `data` 브랜치 동기화
4. Vercel은 선택적 참고 대시보드
