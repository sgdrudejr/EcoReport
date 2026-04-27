export const dynamic = "force-dynamic";

import AccountTabs from "@/components/AccountTabs";
import CompactContentTabs from "@/components/CompactContentTabs";
import ExecutionListTable from "@/components/ExecutionListTable";
import ExecutionNarrativeCard from "@/components/ExecutionNarrativeCard";
import type { PortfolioAccount } from "@/lib/portfolio";

import {
  getAccountFeatureMap,
  getConsensusThemes,
  getQualityFlags,
  getQualityStatus,
  getTopRecommendationIdeas,
  loadDashboardTestData,
  pickAccountIdeas,
  sortSourceSupportEntries,
  type Stage4ExecutionPlanFile,
} from "../data";
import {
  DashboardTestHeader,
  EmptyState,
  MetricCard,
  SectionCard,
  StatusChip,
  compactText,
  formatCount,
  formatMoney,
  formatSignedPercent,
  joinClasses,
} from "../ui";

type ExecutionTableRow = {
  key: string;
  kind: "buy" | "trim" | "hold";
  accountKeys: string[];
  accounts: string[];
  name: string;
  code: string | null;
  amountLabel: string;
  reason: string;
  hitRateBadge?: string | null;
  confidenceLevel?: "high" | "medium" | "low" | null;
};

type Stage4AccountPlan = NonNullable<Stage4ExecutionPlanFile["accountPlans"]>[number];

function biasStatusLabel(bias: string | null | undefined) {
  if (bias === "selective_add") return "보강 필요";
  if (bias === "hold") return "양호";
  if (bias === "reduce" || bias === "trim") return "조정 필요";
  return "집계 중";
}

function biasHeadline(bias: string | null | undefined) {
  if (bias === "selective_add") return "선별 보강";
  if (bias === "hold") return "유지 중심";
  if (bias === "reduce" || bias === "trim") return "비중 조정";
  return "판단 대기";
}

function confidenceLevel(
  value: number | null | undefined,
): "high" | "medium" | "low" | null {
  if (typeof value !== "number" || Number.isNaN(value)) return "medium";
  if (value >= 0.8) return "high";
  if (value >= 0.55) return "medium";
  return "low";
}

function executionRowsFromStage4(
  portfolioAccounts: PortfolioAccount[],
  stage4ExecutionPlan: Stage4ExecutionPlanFile | null,
): ExecutionTableRow[] {
  if (!stage4ExecutionPlan?.accountPlans?.length) {
    return [];
  }

  const accountMap = new Map(portfolioAccounts.map((account) => [account.key, account]));

  return stage4ExecutionPlan.accountPlans
    .filter((plan) => accountMap.has(plan.key))
    .flatMap((plan) => {
      const account = accountMap.get(plan.key);
      if (!account) return [];

      const buys = (plan.stagedBuys ?? []).map((item, index) => ({
        key: `${plan.key}-buy-${item.code ?? item.name ?? index}`,
        kind: "buy" as const,
        accountKeys: [plan.key],
        accounts: [account.label],
        name: item.name ?? "미상",
        code: item.code ?? null,
        amountLabel: formatMoney(item.suggestedAmount),
        reason: item.reason ?? `${plan.label ?? account.label} 계좌의 우선 보강 후보입니다.`,
        hitRateBadge: item.urgency ? `긴급도 ${item.urgency}` : null,
        confidenceLevel: confidenceLevel(item.confidence),
      }));

      const trims = (plan.trims ?? []).map((item, index) => ({
        key: `${plan.key}-trim-${item.code ?? item.name ?? index}`,
        kind: "trim" as const,
        accountKeys: [plan.key],
        accounts: [account.label],
        name: item.name ?? "미상",
        code: item.code ?? null,
        amountLabel: formatMoney(item.suggestedAmount),
        reason: item.reason ?? `${plan.label ?? account.label} 계좌의 비중 조정 후보입니다.`,
        hitRateBadge: item.urgency ? `긴급도 ${item.urgency}` : null,
        confidenceLevel: confidenceLevel(item.confidence),
      }));

      const holds = (plan.holds ?? []).slice(0, 2).map((item, index) => ({
        key: `${plan.key}-hold-${item.code ?? item.name ?? index}`,
        kind: "hold" as const,
        accountKeys: [plan.key],
        accounts: [account.label],
        name: item.name ?? "미상",
        code: item.code ?? null,
        amountLabel: typeof item.score === "number" ? `${item.score}점` : "유지",
        reason: item.reason ?? `${plan.label ?? account.label} 계좌에서 계속 추적하는 보유 후보입니다.`,
        hitRateBadge: item.source ? `${item.source}` : null,
        confidenceLevel: "medium" as const,
      }));

      return [...buys, ...trims, ...holds];
    });
}

function firstExecutionNarrative(
  account: PortfolioAccount,
  plan: Stage4AccountPlan | undefined,
  topIdeaName: string | null,
) {
  if (plan?.stagedBuys?.[0]) {
    const firstBuy = plan.stagedBuys[0];
    return `${account.label}은 ${plan.topGap?.category ?? "핵심 자산군"} 보강이 우선입니다. 1차 실행은 ${firstBuy.name ?? "후보"} ${formatMoney(firstBuy.suggestedAmount)} 규모로 시작하고, 이유는 ${firstBuy.reason ?? "기술·리포트 근거가 모였기 때문"}입니다.`;
  }

  if (topIdeaName) {
    return `${account.label}은 현재 보유를 유지하되 ${topIdeaName} 같은 보강 후보를 눌림 구간에서 점검하는 흐름이 좋습니다.`;
  }

  return `${account.label}은 오늘은 강한 신규 실행보다 보유 구조와 현금 여력을 함께 보는 편이 좋습니다.`;
}

export default function ExecutionDashboardTestPage() {
  const data = loadDashboardTestData();

  if (!data) {
    return (
      <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
        <EmptyState
          title="포트폴리오 스냅샷이 아직 없습니다."
          description="`data/portfolio/latest.json`이 준비되면 실행 중심 테스트 대시보드를 렌더링합니다."
        />
      </main>
    );
  }

  const {
    portfolio,
    recommendationBoard,
    stockeasySnapshot,
    shadowPreview,
    decisionFeatures,
    crossSourceConsensus,
    qualityMatrix,
    reportTabs,
    stage4ExecutionPlan,
    stage2Strategy,
    systemHealth,
  } = data;
  const accountFeatureMap = getAccountFeatureMap(decisionFeatures);
  const qualityStatus = getQualityStatus(qualityMatrix, decisionFeatures);
  const qualityFlags = getQualityFlags(qualityMatrix, decisionFeatures);
  const consensusThemes = getConsensusThemes(decisionFeatures, crossSourceConsensus).slice(0, 5);
  const ideas = getTopRecommendationIdeas(recommendationBoard).slice(0, 10);
  const stockeasySignal = stockeasySnapshot?.marketSignal ?? stockeasySnapshot?.marketAnalysis?.marketSignal;
  const topSectors = (stockeasySnapshot?.stockAnalysis?.sectorRs ?? []).slice(0, 5);
  const topThemes = (stockeasySnapshot?.marketThemes?.themes ?? []).slice(0, 5);
  const topStrategies = (stockeasySnapshot?.strategyRoom?.strategies ?? []).slice(0, 3);
  const priorityActions = (shadowPreview?.stage3?.priority_actions ?? []).slice(0, 4);
  const executionRows = executionRowsFromStage4(portfolio.accounts, stage4ExecutionPlan);
  const planMap = new Map(
    (stage4ExecutionPlan?.accountPlans ?? [])
      .filter((plan) => portfolio.accounts.some((account) => account.key === plan.key))
      .map((plan) => [plan.key, plan]),
  );
  const accountTabs = portfolio.accounts.map((account) => {
    const plan = planMap.get(account.key);
    return {
      key: account.key,
      label: account.label,
      status: biasStatusLabel(plan?.stage2Bias),
      profitRate: formatSignedPercent(account.profitRate, 2),
      profitRateValue: account.profitRate ?? null,
      score:
        typeof plan?.totalScore === "number" ? `${plan.totalScore}점` : `${account.holdings.length}종목`,
      scoreValue: plan?.totalScore ?? null,
    };
  });

  return (
    <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
      <DashboardTestHeader
        current="execution"
        title="실행 중심 테스트 대시보드"
        description="기존 메인 대시보드의 실행 리스트, 사이클 리포트, 계좌별 실행 메모 구조를 그대로 참고해서, 오늘 당장 움직일 내용이 먼저 보이도록 재배치한 화면입니다."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          kicker="실행 항목"
          value={`${formatCount(executionRows.length)}건`}
          detail={
            executionRows[0]
              ? `가장 먼저 보는 실행은 ${executionRows[0].accounts[0]} · ${executionRows[0].name}입니다.`
              : "실행 표에 올라온 항목이 아직 없습니다."
          }
        />
        <MetricCard
          kicker="포트폴리오 총점"
          value={
            typeof stage4ExecutionPlan?.portfolioScore === "number"
              ? `${stage4ExecutionPlan.portfolioScore}점`
              : "집계 중"
          }
          detail={
            stage2Strategy?.macro_view?.summary ??
            "실행 점수와 브리핑 요약이 정리되면 이 카드가 더 풍부해집니다."
          }
        />
        <MetricCard
          kicker="브리핑 테마"
          value={consensusThemes.length > 0 ? consensusThemes.join(" · ") : "핵심 테마 재확인"}
          detail={
            topThemes.length > 0
              ? `StockEasy 테마보드 상단: ${topThemes.map((item) => item.name).join(" · ")}`
              : "외부 테마보드는 아직 비어 있습니다."
          }
        />
        <article className="glass-panel-soft rounded-[1.4rem] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                체크 메모
              </p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-slate-950">
                {qualityStatus}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                11. Execution Plan, 브리핑, 외부 시황이 오늘 실행 화면에 얼마나 안정적으로 반영됐는지 함께 보는 카드입니다.
              </p>
            </div>
            <StatusChip label={qualityStatus} status={qualityStatus} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(qualityFlags.length > 0 ? qualityFlags : ["특이 플래그 없음"]).slice(0, 4).map((flag) => (
              <span
                key={flag}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600"
              >
                {flag}
              </span>
            ))}
          </div>
        </article>
      </section>

      <SectionCard kicker="Today&apos;s Action List" title="실행 리스트와 우선순위">
        <div className="space-y-4">
          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
            <p className="text-sm leading-7 text-slate-700">
              {stage4ExecutionPlan?.regime?.name
                ? `현재 레짐은 ${stage4ExecutionPlan.regime.name}이며, `
                : ""}
              {stage2Strategy?.macro_view?.summary ?? "브리핑 요약이 아직 비어 있습니다."}{" "}
              지금은 실행 표에서 바로 움직일 항목과, 계좌별로 남겨 둘 현금을 함께 읽는 것이 중요합니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                보고서 {systemHealth?.counts?.reports ?? 0}건
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                추출 {systemHealth?.counts?.stage1Extracts ?? 0}건
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                07. Strategy Options {stage2Strategy?.source ?? "unknown"}
              </span>
            </div>
          </div>

          <ExecutionListTable
            rows={executionRows}
            accounts={portfolio.accounts.map((account) => ({
              key: account.key,
              label: account.label,
            }))}
            bodyCopyClass="text-[14px] leading-[1.72]"
            bodyNoteMutedClass="text-[13px] leading-[1.7]"
          />
        </div>
      </SectionCard>

      <SectionCard kicker="Cycle Reports" title="실행 전에 같이 읽을 리포트">
        {reportTabs.length > 0 ? (
          <CompactContentTabs
            tabs={reportTabs.map((tab) => ({
              key: tab.key,
              label: tab.label,
              subtitle: tab.subtitle,
              badge: `${tab.lines.length}`,
            }))}
          >
            {reportTabs.map((tab) => (
              <section key={tab.key}>
                <div className="space-y-3">
                  {tab.lines.map((line, index) => (
                    <p
                      key={`${tab.key}-${index}-${line.slice(0, 24)}`}
                      className={joinClasses(
                        index === 0
                          ? "text-[15px] font-medium leading-[1.72] text-slate-950"
                          : "text-[14px] leading-[1.72] text-slate-700",
                      )}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </CompactContentTabs>
        ) : (
          <p className="text-sm leading-6 text-slate-500">
            아직 읽어올 수 있는 브리핑/실행안 문서가 충분하지 않습니다.
          </p>
        )}
      </SectionCard>

      <SectionCard kicker="Accounts First" title="계좌별 실행과 보유 포인트">
        {accountTabs.length > 0 ? (
          <AccountTabs tabs={accountTabs}>
            {portfolio.accounts.map((account) => {
              const plan = planMap.get(account.key);
              const accountFeature = accountFeatureMap.get(account.key);
              const accountIdeas = pickAccountIdeas(ideas, account.key).slice(0, 3);
              const supportEntries = sortSourceSupportEntries(accountFeature?.support).slice(0, 4);
              const actionNarrative = firstExecutionNarrative(
                account,
                plan,
                accountIdeas[0]?.name ?? null,
              );
              const shadowNote = shadowPreview?.stage3?.portfolio_implications?.find(
                (item) => item.accountKey === account.key,
              );
              const accountPriorityActions = priorityActions;

              return (
                <article key={account.key} className="space-y-6 py-1">
                  <div className="grid grid-cols-6 gap-3">
                    {[
                      { label: "투자 총액", value: formatMoney(account.evaluationAmount) },
                      { label: "현금", value: formatMoney(account.cashAvailable) },
                      { label: "수익률", value: formatSignedPercent(account.profitRate, 2) },
                      {
                        label: "실행 예산",
                        value: formatMoney(plan?.plannedDeployBudget ?? plan?.deployBudget),
                      },
                      { label: "남길 예수금", value: formatMoney(plan?.reserveCash) },
                      { label: "보유 종목", value: `${account.holdings.length}개` },
                    ].map((item) => (
                      <div
                        key={`${account.key}-${item.label}`}
                        className="rounded-[1.3rem] border border-slate-200 bg-white px-4 py-3"
                      >
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          {item.label}
                        </p>
                        <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
                        {account.label}
                      </h3>
                      <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                        방향성 {biasHeadline(plan?.stage2Bias)}
                      </span>
                      {plan?.topGap?.category ? (
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                          부족 자산군 {plan.topGap.category}
                        </span>
                      ) : null}
                    </div>

                    <p className="text-[15px] leading-[1.75] text-slate-700">{actionNarrative}</p>
                  </div>

                  <div className="rounded-[1.65rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="rounded-[1rem] border border-slate-200 bg-white px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          계좌 역할
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {plan?.candidateFromGap
                            ? `${plan.candidateFromGap} 중심으로 ${biasHeadline(plan?.stage2Bias)} 흐름입니다.`
                            : "실행 후보보다 현재 보유 구조를 먼저 점검하는 계좌입니다."}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-white px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          지금 중요 변수
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {plan?.validatorFlags?.length
                            ? `validator ${plan.validatorFlags.join(" · ")}`
                            : stage2Strategy?.account_actions?.find((item) => item.account_key === account.key)
                                ?.rationale ?? "계좌별 bias와 현금 여력을 함께 보는 구간입니다."}
                        </p>
                      </div>
                      <div className="rounded-[1rem] border border-slate-200 bg-white px-4 py-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                          참고 메모
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-700">
                          {shadowNote?.note
                            ? compactText(shadowNote.note, 120)
                            : "Shadow 메모가 없는 경우에는 실행 후보와 보유 종목의 겹침만 먼저 확인합니다."}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                    <div className="rounded-[1.45rem] border border-slate-200 bg-white/90 px-5 py-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                        계좌 실행 메모
                      </p>
                      <div className="mt-4 space-y-4">
                        {[
                          {
                            title: "매수",
                            toneClass: "bg-emerald-50 text-emerald-900",
                            tone: "buy" as const,
                            items: plan?.stagedBuys ?? [],
                          },
                          {
                            title: "매도",
                            toneClass: "bg-rose-50 text-rose-900",
                            tone: "trim" as const,
                            items: plan?.trims ?? [],
                          },
                          {
                            title: "보유 · 관찰",
                            toneClass: "bg-slate-50 text-slate-700",
                            tone: "hold" as const,
                            items: plan?.holds ?? [],
                          },
                        ].map((group) => (
                          <div key={`${account.key}-${group.title}`}>
                            <p className="text-sm font-semibold text-slate-900">{group.title}</p>
                            <div className="mt-2 space-y-2">
                              {group.items.length > 0 ? (
                                group.items.slice(0, 3).map((item, index) => (
                                  <div
                                    key={`${account.key}-${group.title}-${item.code ?? item.name ?? index}`}
                                    className={joinClasses(
                                      "rounded-2xl px-4 py-3 text-sm",
                                      group.toneClass,
                                    )}
                                  >
                                    <p className="font-medium">
                                      {item.name ?? "미상"}
                                      {item.code ? ` (${item.code})` : ""}
                                      {"suggestedAmount" in item && item.suggestedAmount
                                        ? ` · ${formatMoney(item.suggestedAmount)}`
                                        : ""}
                                    </p>
                                    <ExecutionNarrativeCard
                                      text={
                                        item.reason ??
                                        `${account.label} 계좌에서 ${group.title} 쪽으로 정리된 항목입니다.`
                                      }
                                      tone={group.tone}
                                    />
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                                  {group.title === "매도"
                                    ? "즉시 축소가 필요한 항목은 아직 없습니다."
                                    : `${group.title} 메모가 아직 비어 있습니다.`}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4">
                      <article className="rounded-[1.45rem] border border-slate-200 bg-white/90 px-5 py-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          현재 보유 포인트
                        </p>
                        <div className="mt-4 space-y-3">
                          {account.holdings.slice(0, 4).map((holding) => {
                            const linkedIdea = accountIdeas.find((idea) => idea.code === holding.code);
                            return (
                              <div
                                key={`${account.key}-${holding.code ?? holding.name}`}
                                className="rounded-[1rem] border border-slate-200 bg-slate-50/70 px-4 py-3"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">{holding.name}</p>
                                    <p className="mt-1 text-sm text-slate-500">
                                      {holding.code ?? "-"} · 평가 {formatMoney(holding.marketValue)}
                                    </p>
                                  </div>
                                  <p className="text-sm text-slate-500">
                                    {formatSignedPercent(holding.profitRate, 2)}
                                  </p>
                                </div>
                                {linkedIdea ? (
                                  <p className="mt-2 text-sm leading-6 text-slate-600">
                                    {compactText(linkedIdea.rationale, 96)}
                                  </p>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </article>

                      <article className="rounded-[1.45rem] border border-slate-200 bg-white/90 px-5 py-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          External Reinforcement
                        </p>
                        <p className="mt-3 text-sm leading-6 text-slate-700">
                          {accountFeature?.topSupportingThemes?.length
                            ? `${accountFeature.topSupportingThemes.slice(0, 4).join(", ")} 축이 이 계좌와 먼저 겹칩니다.`
                            : "외부/정규화 레이어에서 이 계좌와 직접 겹치는 테마는 아직 약합니다."}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(accountFeature?.topSupportingThemes ?? []).slice(0, 4).map((theme) => (
                            <span
                              key={`${account.key}-${theme}`}
                              className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-500/20"
                            >
                              {theme}
                            </span>
                          ))}
                        </div>
                        {supportEntries.length > 0 ? (
                          <p className="mt-3 text-sm leading-6 text-slate-500">
                            참고 근거:{" "}
                            {supportEntries
                              .map(([source, score]) => `${source} ${score.toFixed(2)}`)
                              .join(" · ")}
                          </p>
                        ) : null}
                      </article>

                      <article className="rounded-[1.45rem] border border-slate-200 bg-white/90 px-5 py-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                          시황과 외부 흐름
                        </p>
                        <p className="mt-3 text-sm leading-6 text-slate-700">
                          단기 {stockeasySignal?.shortSignal ?? "-"} · 장기 {stockeasySignal?.longSignal ?? "-"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          상위 섹터:{" "}
                          {topSectors.length > 0
                            ? topSectors.map((item) => `${item.sector} ${item.score}`).join(" · ")
                            : "섹터 RS 없음"}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          전략실:{" "}
                          {topStrategies.length > 0
                            ? topStrategies.map((item) => `${item.name} ${item.style ?? "-"}`).join(" · ")
                            : "전략실 요약 없음"}
                        </p>
                        {accountPriorityActions[0] ? (
                          <p className="mt-2 text-sm leading-6 text-slate-500">
                            Shadow 메모: {compactText(accountPriorityActions[0].why_now, 90)}
                          </p>
                        ) : null}
                      </article>
                    </div>
                  </div>
                </article>
              );
            })}
          </AccountTabs>
        ) : (
          <p className="text-sm leading-6 text-slate-500">표시할 계좌가 아직 없습니다.</p>
        )}
      </SectionCard>
    </main>
  );
}
