import type { ReactNode } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, CircleGauge, FolderKanban, Radar, Wallet } from "lucide-react";

import {
  loadShadowPreview,
  type ShadowAccountImplication,
  type ShadowPriorityAction,
  type ShadowTopic,
} from "@/lib/shadow-preview";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function normalizeSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function stanceTone(stance?: string) {
  switch (stance) {
    case "constructive":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "fragile":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "two_sided":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "mixed":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function biasTone(bias?: string) {
  switch (bias) {
    case "aggressive_add":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "selective_add":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "hold":
      return "border-slate-200 bg-slate-50 text-slate-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function signalTone(signal?: string) {
  switch (signal) {
    case "BUY":
      return "text-emerald-700";
    case "SELL":
      return "text-rose-700";
    case "HOLD":
      return "text-slate-700";
    default:
      return "text-sky-700";
  }
}

function actionTone(actionType?: string) {
  if (
    [
      "accumulate_on_pullback",
      "macro_tailwind",
      "selective_add",
      "candidate_watch",
      "watch_for_entry",
      "hold_with_conviction",
    ].includes(actionType ?? "")
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (
    [
      "avoid_chasing",
      "verify_before_add",
      "hold_reduce_risk",
      "account_tighten",
      "headline_risk",
      "cost_pressure",
      "avoid_new_entries",
    ].includes(actionType ?? "")
  ) {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (
    [
      "macro_confirm",
      "hold_and_verify",
      "relative_selection",
      "account_review",
      "rates_sensitive",
      "credit_check",
      "fx_check",
      "policy_split",
      "revision_check",
      "orderbook_check",
      "capex_watch",
      "event_driven",
      "selective_structural",
      "explore",
    ].includes(actionType ?? "")
  ) {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function actionTypeLabel(actionType?: string) {
  switch (actionType) {
    case "accumulate_on_pullback":
      return "눌림목 관심";
    case "macro_tailwind":
      return "매크로 우호";
    case "selective_add":
      return "선별 강화";
    case "candidate_watch":
      return "후보 유지";
    case "avoid_chasing":
      return "추격 보류";
    case "verify_before_add":
      return "확인 우선";
    case "hold_reduce_risk":
      return "비중 확대 보류";
    case "account_tighten":
      return "구조 압축";
    case "headline_risk":
      return "헤드라인 리스크";
    case "rates_sensitive":
      return "금리 민감";
    case "credit_check":
      return "신용 점검";
    case "fx_check":
      return "환노출 점검";
    case "cost_pressure":
      return "원가 압박";
    case "policy_split":
      return "정책 분리";
    case "revision_check":
      return "리비전 확인";
    case "orderbook_check":
      return "수주 확인";
    case "capex_watch":
      return "CAPEX 확인";
    case "event_driven":
      return "이벤트 중심";
    case "macro_confirm":
      return "조건 확인";
    case "hold_and_verify":
      return "보유 점검";
    case "relative_selection":
      return "강약 구분";
    case "account_review":
      return "계좌 점검";
    case "account_selective_add":
      return "선별 보강";
    case "watch_for_entry":
      return "진입 대기";
    case "hold_with_conviction":
      return "보유 유지";
    case "selective_structural":
      return "구조적 선별";
    case "avoid_new_entries":
      return "신규 보류";
    case "explore":
      return "탐색";
    default:
      return "action";
  }
}

function MetricCard({
  icon,
  label,
  value,
  note,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  note?: string | null;
}) {
  return (
    <div className="glass-panel rounded-3xl p-5">
      <div className="flex items-center gap-3 text-slate-500">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2">{icon}</div>
        <span className="text-xs font-semibold uppercase tracking-[0.22em]">{label}</span>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</div>
      {note ? <p className="mt-2 text-sm leading-6 text-slate-600">{note}</p> : null}
    </div>
  );
}

function TopicCard({ topic }: { topic: ShadowTopic }) {
  const insightRows = [
    { label: "지금 해석", value: topic.thesis },
    { label: "좋아지려면", value: topic.keep_watch },
    { label: "경계 신호", value: topic.risk_watch },
    { label: "투자 메모", value: topic.decision_note },
    { label: "근거", value: topic.evidence_note },
  ].filter((row) => row.value);

  return (
    <article className="glass-panel rounded-[28px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="section-kicker">Topic Bucket</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{topic.bucket_label}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {topic.report_count}개 리포트 · {topic.card_count}개 카드
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${stanceTone(topic.stance)}`}>
          {topic.stance ?? "watch"}
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {insightRows.map((row) => (
          <div key={`${topic.bucket_id}-${row.label}`} className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{row.label}</div>
            <p className="mt-1.5 text-[15px] leading-7 text-slate-700">{row.value}</p>
          </div>
        ))}
      </div>

      {topic.related_holdings?.length ? (
        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Portfolio Linkage</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {topic.related_holdings.map((holding) => (
              <span
                key={`${topic.bucket_id}-${holding.code}`}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                <span className="font-medium text-slate-900">{holding.name}</span>
                {holding.signal ? <span className={`ml-2 text-xs font-semibold ${signalTone(holding.signal)}`}>{holding.signal}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {topic.source_reports?.length ? (
        <div className="mt-5">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source Reports</div>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            {topic.source_reports.slice(0, 3).map((report) => (
              <li key={report} className="flex gap-2">
                <ArrowRight className="mt-1 size-3.5 shrink-0 text-slate-400" />
                <span>{report}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

function AccountCard({ item }: { item: ShadowAccountImplication }) {
  return (
    <article className="glass-panel rounded-[26px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="section-kicker">Account</div>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{item.label}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${biasTone(item.bias)}`}>
          {item.bias ?? "hold"}
        </span>
      </div>
      <div className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{item.totalScore ?? "n/a"}</div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{item.note}</p>
      {item.riskNotes?.length ? (
        <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
          {item.riskNotes.map((risk) => (
            <li key={risk} className="flex gap-2">
              <AlertCircle className="mt-1 size-4 shrink-0 text-amber-500" />
              <span>{risk}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function ActionCard({ item }: { item: ShadowPriorityAction }) {
  return (
    <article className="glass-panel-soft rounded-[24px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.scope}</div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${actionTone(item.action_type)}`}>
          {actionTypeLabel(item.action_type)}
        </span>
      </div>
      <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-950">{item.action}</h3>
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">왜 지금 보나</div>
      <p className="mt-1.5 text-sm leading-6 text-slate-700">{item.why_now}</p>
    </article>
  );
}

export default async function ShadowPreviewPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const date = normalizeSearchParam(resolvedSearchParams.date);
  const bundle = loadShadowPreview(date);

  if (!bundle) {
    return (
      <main className="min-h-screen bg-[var(--page-base)] px-6 py-10 text-slate-900">
        <div className="mx-auto flex max-w-4xl flex-col gap-6">
          <div className="glass-panel rounded-[32px] p-8">
            <div className="section-kicker">Shadow Preview</div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">사용 가능한 shadow preview 결과가 없습니다.</h1>
            <p className="mt-4 text-base leading-8 text-slate-600">
              먼저 `stage2-shadow-topic-buckets.json`과 `stage3-shadow-final-insights.json`이 생성된 날짜가 필요합니다.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const { stage2, stage3, availableDates } = bundle;
  const topTopics = stage3.top_topics ?? [];
  const executiveSummary = stage3.executive_summary ?? [];
  const portfolioImplications = stage3.portfolio_implications ?? [];
  const priorityActions = stage3.priority_actions ?? [];
  const watchpoints = stage3.watchpoints ?? [];
  const dashboardPreview = stage3.dashboard_preview ?? {};
  const marketRegime = stage3.market_regime ?? {};
  const portfolioSummary = stage3.portfolio_summary ?? {};

  return (
    <main className="min-h-screen bg-[var(--page-base)] px-6 py-8 text-slate-900">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8">
        <section className="glass-panel overflow-hidden rounded-[36px]">
          <div className="bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.24),_transparent_32%),radial-gradient(circle_at_80%_20%,_rgba(251,191,36,0.18),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(248,250,252,0.98))] px-8 py-8">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-4xl">
                <div className="section-kicker">Shadow Preview</div>
                <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
                  Stage 3 Shadow를 대시보드 문장 직전 형태로 읽는 preview
                </h1>
                <p className="mt-4 max-w-3xl text-[16px] leading-8 text-slate-700">
                  기존 메인 대시보드는 건드리지 않고, `report → evidence → topic bucket → final insight` 흐름이 실제 화면에서
                  어떻게 읽히는지만 확인하는 전용 페이지입니다.
                </p>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Preview Date</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{bundle.date}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">최신 shadow 결과가 있는 날짜를 기본으로 사용합니다.</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {availableDates.slice(0, 12).map((item) => {
                const active = item === bundle.date;
                return (
                  <Link
                    key={item}
                    href={`/shadow-preview?date=${item}`}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {item}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<CircleGauge className="size-5 text-sky-600" />}
            label="Market Regime"
            value={`${marketRegime.name ?? "N/A"}${marketRegime.confidencePct ? ` ${marketRegime.confidencePct}%` : ""}`}
            note={marketRegime.summary}
          />
          <MetricCard
            icon={<Wallet className="size-5 text-emerald-600" />}
            label="Portfolio Score"
            value={String(portfolioSummary.totalScore ?? "n/a")}
            note={portfolioSummary.note}
          />
          <MetricCard
            icon={<FolderKanban className="size-5 text-amber-600" />}
            label="Topic Buckets"
            value={String(stage2.bucketCount)}
            note={`${stage2.cardCount} cards / ${stage2.reportCount} reports`}
          />
          <MetricCard
            icon={<Radar className="size-5 text-violet-600" />}
            label="Top Topics"
            value={String(topTopics.length)}
            note={(stage2.topBuckets ?? []).slice(0, 3).join(", ")}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
          <div className="glass-panel rounded-[30px] p-7">
            <div className="section-kicker">Executive Summary</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
              오늘 시장을 한 번에 읽는 shadow 요약
            </h2>
            <div className="mt-5 space-y-3">
              {executiveSummary.map((line) => (
                <p key={line} className="text-[15px] leading-7 text-slate-700">
                  {line}
                </p>
              ))}
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/80 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Dashboard Preview</div>
              <h3 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                {dashboardPreview.headline ?? "Preview headline unavailable"}
              </h3>
              {dashboardPreview.subhead ? (
                <p className="mt-3 text-[15px] leading-7 text-slate-700">{dashboardPreview.subhead}</p>
              ) : null}
              {dashboardPreview.bullets?.length ? (
                <ul className="mt-4 space-y-2 text-sm leading-6 text-slate-600">
                  {dashboardPreview.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="glass-panel rounded-[30px] p-7">
            <div className="section-kicker">Watchpoints</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">지금 같이 봐야 할 조건들</h2>
            <ul className="mt-5 space-y-3">
              {watchpoints.map((item) => (
                <li key={item} className="flex gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 text-sm leading-6 text-slate-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="space-y-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="section-kicker">Top Topics</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">버킷별 인사이트 preview</h2>
            </div>
            <p className="max-w-2xl text-right text-sm leading-6 text-slate-600">
              각 카드의 원문을 직접 붙이지 않고, 유지 조건과 깨지는 조건이 같이 보이도록 정리한 shadow 뷰입니다.
            </p>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            {topTopics.map((topic) => (
              <TopicCard key={topic.bucket_id} topic={topic} />
            ))}
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="space-y-5">
            <div>
              <div className="section-kicker">Portfolio Implications</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">계좌별 영향</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {portfolioImplications.map((item) => (
                <AccountCard key={item.accountKey} item={item} />
              ))}
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <div className="section-kicker">Priority Actions</div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">지금 당장 볼 것</h2>
            </div>
            <div className="grid gap-4">
              {priorityActions.map((item, index) => (
                <ActionCard key={`${item.scope}-${index}`} item={item} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
