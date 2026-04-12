export const dynamic = "force-dynamic";

import Link from "next/link";

export default function DashboardTestPage() {
  return (
    <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
      <section className="glass-panel rounded-2xl px-6 py-6">
        <p className="section-kicker">Dashboard Test</p>
        <h1 className="mt-2 text-[1.6rem] font-semibold tracking-tight text-slate-950">
          Decision / Feedback 분리 시안
        </h1>
        <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
          기존 메인 대시보드는 그대로 두고, 테스트용으로 실행 중심 화면과 사후 분석 화면을
          분리해 보는 라우트입니다.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <Link
          href="/dashboard-test/decision"
          className="glass-panel rounded-2xl border border-slate-200/80 px-6 py-6 transition hover:border-slate-300 hover:bg-white"
        >
          <p className="section-kicker">Decision Dashboard</p>
          <h2 className="mt-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            실행 화면 분리
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
            오늘의 실행 리스트, 계좌 운용, 시황 가이드, 추천 종목처럼 바로 액션으로 이어지는
            화면만 모아둔 테스트 버전입니다.
          </p>
        </Link>

        <Link
          href="/dashboard-test/feedback"
          className="glass-panel rounded-2xl border border-slate-200/80 px-6 py-6 transition hover:border-slate-300 hover:bg-white"
        >
          <p className="section-kicker">Feedback Dashboard</p>
          <h2 className="mt-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            사후 분석 화면 분리
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
            성과 피드백, 상관관계 클러스터처럼 진단과 복기 중심의 정보만 따로 떼어낸 테스트
            버전입니다.
          </p>
        </Link>
      </section>
    </main>
  );
}
