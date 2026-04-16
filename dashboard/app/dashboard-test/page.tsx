export const dynamic = "force-dynamic";

import Link from "next/link";
import { Activity, Compass, PanelTop } from "lucide-react";

import {
  DashboardTestHeader,
  SectionCard,
} from "./ui";

export default function DashboardTestPage() {
  return (
    <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
      <DashboardTestHeader
        current="home"
        title="실행 / 현황 / 피드백 구조 실험"
        description="기존 대시보드에서 쓰던 리포트·브리핑·계좌 문법은 유지하고, 섹션 순서만 실행 / 현황 / 피드백으로 다시 정리한 테스트 화면입니다."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          href="/dashboard-test/execution"
          className="glass-panel rounded-2xl border border-slate-200/80 px-6 py-6 transition hover:border-slate-300 hover:bg-white"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="section-kicker">Execution</p>
            <Compass className="size-4 text-slate-400" />
          </div>
          <h2 className="mt-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            오늘 바로 뭘 해야 하나
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
            오늘의 실행 리스트, 계좌별 후보, 시황 체크포인트를 한 화면에서 바로 이어 보게 묶었습니다.
          </p>
        </Link>

        <Link
          href="/dashboard-test/status"
          className="glass-panel rounded-2xl border border-slate-200/80 px-6 py-6 transition hover:border-slate-300 hover:bg-white"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="section-kicker">Status</p>
            <PanelTop className="size-4 text-slate-400" />
          </div>
          <h2 className="mt-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            지금 포지션 구조가 어떤가
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
            계좌 상태, 보유 종목, 시황 구조를 실행 판단과 분리해서 차분하게 읽는 화면입니다.
          </p>
        </Link>

        <Link
          href="/dashboard-test/feedback"
          className="glass-panel rounded-2xl border border-slate-200/80 px-6 py-6 transition hover:border-slate-300 hover:bg-white"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="section-kicker">Feedback</p>
            <Activity className="size-4 text-slate-400" />
          </div>
          <h2 className="mt-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            우리가 얼마나 잘 맞췄나
          </h2>
          <p className="mt-3 text-[14px] leading-[1.7] text-slate-600">
            최근 적중률, 빗나간 판단, 다음에 조정할 포인트만 따로 떼어 복기합니다.
          </p>
        </Link>
      </section>

      <SectionCard kicker="Information Architecture" title="기존 대시보드를 더 잘 쓰기 위한 재배치">
        <div className="grid gap-4 md:grid-cols-3">
          <article className="rounded-[1.35rem] border border-slate-200/90 bg-white/90 p-4">
            <p className="text-sm font-semibold text-slate-900">실행</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              오늘의 실행 리스트와 계좌 후보를 먼저 보여줍니다. 시황과 외부 신호는 실행 이유를 덧붙이는 정도로만 씁니다.
            </p>
          </article>
          <article className="rounded-[1.35rem] border border-slate-200/90 bg-white/90 p-4">
            <p className="text-sm font-semibold text-slate-900">현황</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              포지션 구조, 현금, 보유 종목, 시황 구조를 설명합니다. 실행 결론보다 상태 설명이 먼저 오도록 배치했습니다.
            </p>
          </article>
          <article className="rounded-[1.35rem] border border-slate-200/90 bg-white/90 p-4">
            <p className="text-sm font-semibold text-slate-900">피드백</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              적중률과 복기 메모를 따로 보여줍니다. 전략을 바꿔야 하는지, 유지해도 되는지를 학습 관점에서 정리합니다.
            </p>
          </article>
        </div>
      </SectionCard>
    </main>
  );
}
