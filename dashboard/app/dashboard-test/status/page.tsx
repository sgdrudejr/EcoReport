export const dynamic = "force-dynamic";

import AccountTabs from "@/components/AccountTabs";
import HoldingTabs from "@/components/HoldingTabs";
import {
  getAccountHoldingsProfitLoss,
  getAccountHoldingsProfitRate,
  getHoldingProfitLoss,
  getHoldingProfitRate,
} from "@/lib/portfolio";

import {
  getAccountFeatureMap,
  getQualityFlags,
  getQualityStatus,
  getTopThemeFeatures,
  loadDashboardTestData,
  sortSourceSupportEntries,
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

function biasStatusLabel(bias: string | null | undefined) {
  if (bias === "selective_add") return "보강 필요";
  if (bias === "hold") return "양호";
  if (bias === "reduce" || bias === "trim") return "조정 필요";
  return "집계 중";
}

function holdingSignalLabel(profitRate: number | null | undefined) {
  if (typeof profitRate !== "number" || Number.isNaN(profitRate)) return "관찰";
  if (profitRate >= 8) return "강세";
  if (profitRate >= 0) return "유지";
  return "재점검";
}

export default function StatusDashboardTestPage() {
  const data = loadDashboardTestData();

  if (!data) {
    return (
      <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
        <EmptyState
          title="포트폴리오 스냅샷이 아직 없습니다."
          description="`data/portfolio/latest.json`이 준비되면 현황 중심 테스트 대시보드를 렌더링합니다."
        />
      </main>
    );
  }

  const {
    portfolio,
    totals,
    stockeasySnapshot,
    decisionFeatures,
    sourceDivergence,
    qualityMatrix,
    stage4ExecutionPlan,
    systemHealth,
  } = data;
  const accountFeatureMap = getAccountFeatureMap(decisionFeatures);
  const qualityStatus = getQualityStatus(qualityMatrix, decisionFeatures);
  const qualityFlags = getQualityFlags(qualityMatrix, decisionFeatures);
  const topThemeFeatures = getTopThemeFeatures(decisionFeatures).slice(0, 10);
  const conflicts = (sourceDivergence?.divergence?.sourceConflicts ?? []).slice(0, 8);
  const stockeasySignal = stockeasySnapshot?.marketSignal ?? stockeasySnapshot?.marketAnalysis?.marketSignal;
  const sectorRows = stockeasySnapshot?.marketAnalysis?.sectors?.rows?.slice(0, 6) ?? [];
  const leadingRows = stockeasySnapshot?.marketAnalysis?.leadingSectors?.rows?.slice(0, 6) ?? [];
  const topThemes = (stockeasySnapshot?.marketThemes?.themes ?? []).slice(0, 5);
  const topStrategies = (stockeasySnapshot?.strategyRoom?.strategies ?? []).slice(0, 3);
  const healthChecks = (systemHealth?.checks ?? []).slice(0, 6);
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
        current="status"
        title="현황 중심 테스트 대시보드"
        description="기존 메인 대시보드의 계좌/보유 구조를 최대한 유지하면서, 실행 판단보다 현재 포지션과 시장 구조를 먼저 읽도록 재배치한 화면입니다."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          kicker="총 자산"
          value={formatMoney(totals.totalEvaluationAmount)}
          detail={`총 보유 ${formatCount(totals.totalHoldingCount)}개 · 손익 ${formatSignedPercent(
            totals.totalHoldingsProfitRate,
            2,
          )}`}
        />
        <MetricCard
          kicker="현금 여력"
          value={formatMoney(totals.totalCashAvailable)}
          detail="현황 화면에서는 지금 남아 있는 현금과 계좌별 포지션 구조를 먼저 봅니다."
        />
        <MetricCard
          kicker="시장 구조"
          value={stockeasySignal?.shortSignal ?? "집계 중"}
          detail={`장기 ${stockeasySignal?.longSignal ?? "-"} · 코스피 ${stockeasySignal?.kospi?.statusLabel ?? "-"}`}
        />
        <article className="glass-panel-soft rounded-[1.4rem] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                데이터 메모
              </p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-slate-950">
                {qualityStatus}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                오늘 대시보드에 반영된 계좌/시황/리포트 상태를 함께 보는 카드입니다.
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

      <SectionCard kicker="Accounts First" title="계좌별 포지션 구조와 보유 상태">
        <AccountTabs tabs={accountTabs}>
          {portfolio.accounts.map((account) => {
            const plan = planMap.get(account.key);
            const accountFeature = accountFeatureMap.get(account.key);
            const sourceSupport = sortSourceSupportEntries(accountFeature?.support).slice(0, 4);
            const accountHoldingsProfitLoss = getAccountHoldingsProfitLoss(account);
            const accountHoldingsProfitRate = getAccountHoldingsProfitRate(account);

            return (
              <article key={account.key} className="space-y-6 py-1">
                <div className="grid grid-cols-6 gap-3">
                  {[
                    { label: "평가금액", value: formatMoney(account.evaluationAmount) },
                    { label: "현금", value: formatMoney(account.cashAvailable) },
                    { label: "보유자산 손익", value: formatMoney(accountHoldingsProfitLoss) },
                    { label: "보유자산 수익률", value: formatSignedPercent(accountHoldingsProfitRate, 2) },
                    {
                      label: "실행 bias",
                      value: plan?.stage2Bias ? plan.stage2Bias : "집계 중",
                    },
                    { label: "종목 수", value: `${account.holdings.length}개` },
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

                <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-[1.45rem] border border-slate-200 bg-white/90 px-5 py-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
                        {account.label}
                      </h3>
                      <span className="rounded-full bg-slate-900/5 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                        {biasStatusLabel(plan?.stage2Bias)}
                      </span>
                    </div>
                    <p className="mt-3 text-[15px] leading-[1.75] text-slate-700">
                      {plan?.topGap?.category
                        ? `${account.label}은 현재 ${plan.topGap.category} 쪽 갭이 가장 크게 남아 있습니다.`
                        : `${account.label}은 보유 종목 구조와 현금 여력을 먼저 차분히 보는 구간입니다.`}{" "}
                      {plan?.reserveCash != null
                        ? `남겨 둘 예수금은 ${formatMoney(plan.reserveCash)} 수준으로 잡혀 있습니다.`
                        : ""}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {(accountFeature?.topSupportingThemes ?? []).slice(0, 6).map((theme) => (
                        <span
                          key={`${account.key}-${theme}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>

                    {sourceSupport.length > 0 ? (
                      <p className="mt-3 text-sm leading-6 text-slate-500">
                        참고 근거:{" "}
                        {sourceSupport
                          .map(([source, score]) => `${source} ${score.toFixed(2)}`)
                          .join(" · ")}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-[1.45rem] border border-slate-200 bg-white/90 px-5 py-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      External Reinforcement
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-700">
                      상위 섹터 {sectorRows.slice(0, 3).map((row) => row.sector).join(" · ") || "-"} / 테마{" "}
                      {topThemes.map((item) => item.name).join(" · ") || "-"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      전략실 {topStrategies.map((item) => item.name).join(" · ") || "-"}
                    </p>
                    {plan?.candidateFromGap ? (
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        실행 후보 연결: {plan.candidateFromGap}
                      </p>
                    ) : null}
                  </div>
                </div>

                <section className="space-y-4">
                  <div className="section-header-row flex items-start justify-between gap-4">
                    <div className="section-header-band">
                      <p className="section-kicker">Account Holdings</p>
                      <h4 className="mt-1.5 text-[1.02rem] font-semibold tracking-tight text-slate-950">
                        보유 종목 요약과 점수
                      </h4>
                    </div>
                    <span className="text-xs text-slate-400">종목별 상태와 근거</span>
                  </div>

                  {account.holdings.length > 0 ? (
                    <HoldingTabs
                      tabs={account.holdings.map((holding) => ({
                        key: `${account.key}-${holding.code ?? holding.name}`,
                        label: holding.name,
                        code: holding.code ?? null,
                        profitRate: formatSignedPercent(getHoldingProfitRate(holding), 2),
                        profitRateValue: getHoldingProfitRate(holding),
                        profitLoss: formatMoney(getHoldingProfitLoss(holding)),
                        profitLossValue: getHoldingProfitLoss(holding),
                      }))}
                    >
                      {account.holdings.map((holding) => {
                        const securityFeature = decisionFeatures?.securityFeatures?.find(
                          (item) => item.code === holding.code || item.name === holding.name,
                        );
                        const linkedConflicts = conflicts.filter(
                          (conflict) =>
                            conflict.entityId === holding.code || conflict.entityId === holding.name,
                        );

                        return (
                          <div
                            key={`holding-panel-${account.key}-${holding.code ?? holding.name}`}
                            className="space-y-4 px-1 py-1"
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="text-lg font-semibold tracking-tight text-slate-950">
                                  {holding.name}
                                </h5>
                                <span className="rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                                  {holding.code ?? "티커 미입력"}
                                </span>
                                <span className="rounded-full bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-500/20">
                                  {holdingSignalLabel(getHoldingProfitRate(holding))}
                                </span>
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-500">
                                평가금액 {formatMoney(holding.marketValue)} · 손익{" "}
                                {formatMoney(getHoldingProfitLoss(holding))} · 수익률{" "}
                                {formatSignedPercent(getHoldingProfitRate(holding), 2)}
                              </p>
                            </div>

                            <div className="grid grid-cols-4 gap-2">
                              <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                  보유 수량
                                </p>
                                <p className="mt-1 text-base font-semibold text-slate-950">
                                  {holding.quantity ?? "-"}
                                </p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                  평균가
                                </p>
                                <p className="mt-1 text-base font-semibold text-slate-950">
                                  {formatMoney(holding.avgPrice)}
                                </p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                  현재가
                                </p>
                                <p className="mt-1 text-base font-semibold text-slate-950">
                                  {formatMoney(holding.currentPrice)}
                                </p>
                              </div>
                              <div className="rounded-2xl bg-slate-50 px-3 py-2">
                                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">
                                  근거 수
                                </p>
                                <p className="mt-1 text-base font-semibold text-slate-950">
                                  {securityFeature?.sourceCount ?? 0}개
                                </p>
                              </div>
                            </div>

                            <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
                              <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  핵심 메모
                                </p>
                                <p className="mt-2 text-sm leading-6 text-slate-700">
                                  {securityFeature
                                    ? `${holding.name}은 ${securityFeature.netScore.toFixed(3)} 점수로 정규화 레이어에 올라와 있고, ${sortSourceSupportEntries(
                                        securityFeature.support,
                                      )
                                        .map(([source, score]) => `${source} ${score.toFixed(2)}`)
                                        .join(" · ")} 근거가 같이 붙습니다.`
                                    : `${holding.name}은 아직 정규화 근거가 얕아서 보유 손익과 시황 흐름을 함께 보는 편이 좋습니다.`}
                                </p>
                              </div>

                              <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  유의할 점
                                </p>
                                {linkedConflicts.length > 0 ? (
                                  <div className="mt-2 space-y-2">
                                    {linkedConflicts.slice(0, 2).map((conflict, index) => (
                                      <p
                                        key={`${holding.code ?? holding.name}-conflict-${index}`}
                                        className="text-sm leading-6 text-slate-600"
                                      >
                                        {(conflict.sources ?? []).join(" · ")} 에서 방향{" "}
                                        {(conflict.directions ?? []).join(", ")}
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="mt-2 text-sm leading-6 text-slate-500">
                                    현재 저장된 충돌 신호는 크지 않습니다. 다만 리포트 커버리지가 얕은 종목은 보수적으로 해석합니다.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </HoldingTabs>
                  ) : (
                    <p className="text-sm leading-6 text-slate-500">보유 종목이 아직 비어 있습니다.</p>
                  )}
                </section>
              </article>
            );
          })}
        </AccountTabs>
      </SectionCard>

      <SectionCard kicker="Market Structure" title="시황과 외부 흐름">
        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[1.45rem] border border-slate-200/90 bg-white/90 p-5">
            <p className="text-sm font-semibold text-slate-900">시장신호</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              단기 {stockeasySignal?.shortSignal ?? "-"} · 장기 {stockeasySignal?.longSignal ?? "-"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              코스피 {stockeasySignal?.kospi?.statusLabel ?? "-"} · 코스닥 {stockeasySignal?.kosdaq?.statusLabel ?? "-"}
            </p>
          </article>

          <article className="rounded-[1.45rem] border border-slate-200/90 bg-white/90 p-5">
            <p className="text-sm font-semibold text-slate-900">섹터 / 추세유지</p>
            <div className="mt-3 space-y-2">
              {sectorRows.slice(0, 3).map((row, index) => (
                <p key={`${row.sector}-${index}`} className="text-sm leading-6 text-slate-600">
                  {row.sector} · {row.signal ?? "-"} · {row.position ?? "-"}
                </p>
              ))}
              {leadingRows.slice(0, 3).map((row, index) => (
                <p key={`${row.sector}-leading-${index}`} className="text-sm leading-6 text-slate-500">
                  추세유지 {row.sector} · {row.holdDays ?? "-"}일 · {row.signal ?? "-"}
                </p>
              ))}
            </div>
          </article>

          <article className="rounded-[1.45rem] border border-slate-200/90 bg-white/90 p-5">
            <p className="text-sm font-semibold text-slate-900">테마보드 / 전략실</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              테마 {topThemes.map((item) => item.name).join(" · ") || "-"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              전략실 {topStrategies.map((item) => item.name).join(" · ") || "-"}
            </p>
          </article>
        </div>
      </SectionCard>

      <SectionCard kicker="Health Notes" title="체크 메모와 테마 노출">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-3">
            {healthChecks.length > 0 ? (
              healthChecks.map((check, index) => (
                <article
                  key={`${check.key ?? check.label}-${index}`}
                  className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{check.label ?? check.key ?? "-"}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">{check.detail ?? "-"}</p>
                    </div>
                    <StatusChip label={check.status ?? "info"} status={check.status} />
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-slate-500">system health 체크가 아직 없습니다.</p>
            )}
          </div>

          <div className="space-y-3">
            {topThemeFeatures.length > 0 ? (
              topThemeFeatures.map((feature) => (
                <article
                  key={feature.theme}
                  className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{feature.theme}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        해석 점수 {feature.netScore.toFixed(3)} · 근거 {feature.sourceCount}개
                      </p>
                    </div>
                    <StatusChip
                      label={`${feature.sourceCount}개`}
                      status={feature.sourceCount >= 2 ? "ok" : "info"}
                    />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    {compactText(
                      sortSourceSupportEntries(feature.support)
                        .map(([source, score]) => `${source} ${score.toFixed(2)}`)
                        .join(" · ") || "아직 단일 근거 중심",
                      120,
                    )}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-slate-500">테마 노출 요약이 아직 비어 있습니다.</p>
            )}
          </div>
        </div>
      </SectionCard>
    </main>
  );
}
