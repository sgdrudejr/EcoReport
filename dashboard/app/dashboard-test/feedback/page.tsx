export const dynamic = "force-dynamic";

import CompactContentTabs from "@/components/CompactContentTabs";
import FeedbackPanel from "@/components/FeedbackPanel";
import type { FeedbackAnalysis as FeedbackPanelAnalysis } from "@/components/FeedbackPanel";

import {
  getConsensusThemes,
  getQualityFlags,
  getQualityStatus,
  loadDashboardTestData,
} from "../data";
import {
  DashboardTestHeader,
  EmptyState,
  MetricCard,
  SectionCard,
  StatusChip,
  compactText,
  formatCount,
  formatRatioPercent,
  joinClasses,
} from "../ui";

export default function FeedbackDashboardTestPage() {
  const data = loadDashboardTestData();

  if (!data) {
    return (
      <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
        <EmptyState
          title="포트폴리오 스냅샷이 아직 없습니다."
          description="`data/portfolio/latest.json`이 준비되면 피드백 테스트 대시보드를 렌더링합니다."
        />
      </main>
    );
  }

  const {
    feedbackAnalysis,
    sourceDivergence,
    qualityMatrix,
    decisionFeatures,
    crossSourceConsensus,
    feedbackHistory,
    feedbackReportLines,
  } =
    data;
  const qualityStatus = getQualityStatus(qualityMatrix, decisionFeatures);
  const qualityFlags = getQualityFlags(qualityMatrix, decisionFeatures);
  const consensusThemes = getConsensusThemes(decisionFeatures, crossSourceConsensus).slice(0, 6);
  const sourceConflicts = (sourceDivergence?.divergence?.sourceConflicts ?? []).slice(0, 8);
  const correlations = Object.entries(feedbackAnalysis?.scoreReturnCorrelation ?? {}).filter(([key]) =>
    key.startsWith("ret_"),
  );
  const weightSuggestions = feedbackAnalysis?.weightSuggestions ?? [];
  const worstMispredictions = (feedbackAnalysis?.worstMispredictions ?? []).slice(0, 6);
  const buyHitRate = feedbackAnalysis?.signalHitRates?.buy_hit_5d ?? null;
  const trimHitRate = feedbackAnalysis?.signalHitRates?.trim_negative_5d ?? null;
  const reasoningRows = feedbackAnalysis?.autoAdjustment?.reasoning ?? [];
  const availableHistory = feedbackHistory.filter((entry) => entry.available);
  const missingHistory = feedbackHistory.filter((entry) => !entry.available);
  const panelAnalysis = feedbackAnalysis
    ? {
        ...feedbackAnalysis,
        analysisDate: feedbackAnalysis.analysisDate ?? undefined,
        generatedAt: feedbackAnalysis.generatedAt ?? undefined,
      }
    : null;

  return (
    <main className="mx-auto flex w-full max-w-[calc(var(--dashboard-fixed-width)-8px)] flex-col gap-4 px-1 pb-10 pt-5">
      <DashboardTestHeader
        current="feedback"
        title="피드백 중심 테스트 대시보드"
        description="기존 메인 대시보드의 feedback panel 구조를 중심에 두고, 적중률과 복기 메모를 앞쪽에 붙여 한 화면에서 다시 읽도록 정리한 화면입니다."
      />

      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          kicker="기록 수"
          value={formatCount(feedbackAnalysis?.snapshotCount)}
          detail={`분석일 ${feedbackAnalysis?.analysisDate ?? "-"}`}
        />
        <MetricCard
          kicker="표본"
          value={formatCount(feedbackAnalysis?.sampleSize ?? feedbackAnalysis?.positionCount)}
          detail="피드백에 쓰인 포지션/표본 수입니다."
        />
        <MetricCard
          kicker="매수 적중률"
          value={formatRatioPercent(buyHitRate, 0)}
          detail="최근 5일 매수 계열 신호 적중률입니다."
        />
        <article className="glass-panel-soft rounded-[1.4rem] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                감축 적중률
              </p>
              <p className="mt-3 text-[1.8rem] font-semibold tracking-tight text-slate-950">
                {formatRatioPercent(trimHitRate, 0)}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                최근 5일 감축 계열 신호 적중률과 오늘 데이터 상태를 같이 봅니다.
              </p>
            </div>
            <StatusChip label={qualityStatus} status={qualityStatus} />
          </div>
        </article>
      </section>

      <SectionCard kicker="Feedback Timeline" title="4월 6일부터 쌓인 피드백 이력">
        <div className="space-y-4">
          <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
            <p className="text-sm leading-7 text-slate-700">
              이번 테스트 화면은 최신 피드백 한 장만 보여주지 않고,{" "}
              <span className="font-semibold text-slate-900">2026-04-06 ~ 2026-04-14</span> 기간을
              날짜 축으로 펼칩니다. 실제 피드백 파일이 있는 날은 수치로 채우고, 없는 날은
              `미생성` 상태로 남겨서 왜 영역이 비어 보였는지 바로 보이게 했습니다.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                채워진 날짜 {availableHistory.length}일
              </span>
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">
                비어 있는 날짜 {missingHistory.length}일
              </span>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {feedbackHistory.map((entry) => (
              <article
                key={entry.date}
                className={joinClasses(
                  "rounded-[1.35rem] border px-4 py-4",
                  entry.available
                    ? "border-slate-200/90 bg-white/90"
                    : "border-dashed border-slate-200 bg-slate-50/80",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{entry.date}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {entry.available ? "피드백 집계 완료" : "피드백 미생성"}
                    </p>
                  </div>
                  <StatusChip
                    label={entry.available ? "available" : "missing"}
                    status={entry.available ? "ok" : "info"}
                  />
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Snapshots</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {entry.snapshotCount ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Samples</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {entry.sampleSize ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">BUY 5d</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {formatRatioPercent(entry.buyHitRate, 0)}
                    </p>
                  </div>
                  <div className="rounded-[1rem] bg-slate-50 px-3 py-3">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">TRIM 5d</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">
                      {formatRatioPercent(entry.trimHitRate, 0)}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-sm leading-6 text-slate-500">
                  ret_5d {typeof entry.ret5Correlation === "number" ? entry.ret5Correlation.toFixed(3) : "-"} ·
                  ret_10d {typeof entry.ret10Correlation === "number" ? entry.ret10Correlation.toFixed(3) : "-"}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {entry.notes.join(" · ")}
                </p>
              </article>
            ))}
          </div>
        </div>
      </SectionCard>

      <SectionCard kicker="Feedback Loop" title="피드백 패널 전체 보기">
        <FeedbackPanel analysis={panelAnalysis as unknown as FeedbackPanelAnalysis | null} />
      </SectionCard>

      <SectionCard kicker="Review Notes" title="복기할 메모와 학습 포인트">
        <CompactContentTabs
          tabs={[
            {
              key: "report",
              label: "피드백 리포트",
              subtitle: "feedback summary markdown",
              badge: `${feedbackReportLines.length}`,
            },
            {
              key: "conflicts",
              label: "엇갈린 신호",
              subtitle: "source divergence",
              badge: `${sourceConflicts.length}`,
            },
            {
              key: "weights",
              label: "가중치 메모",
              subtitle: "weight suggestions",
              badge: `${weightSuggestions.length}`,
            },
            {
              key: "mispredictions",
              label: "빗나간 사례",
              subtitle: "worst mispredictions",
              badge: `${worstMispredictions.length}`,
            },
            {
              key: "data",
              label: "데이터 메모",
              subtitle: "quality and overlap",
              badge: `${qualityFlags.length}`,
            },
          ]}
        >
          <section>
            <div className="space-y-3">
              {feedbackReportLines.length > 0 ? (
                feedbackReportLines.map((line, index) => (
                  <p
                    key={`feedback-report-${index}-${line.slice(0, 24)}`}
                    className={joinClasses(
                      index === 0
                        ? "text-[15px] font-medium leading-[1.72] text-slate-950"
                        : "text-[14px] leading-[1.72] text-slate-700",
                    )}
                  >
                    {line}
                  </p>
                ))
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  `reports/feedback-summary.md`가 아직 비어 있습니다.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="space-y-3">
              {sourceConflicts.length > 0 ? (
                sourceConflicts.map((conflict, index) => (
                  <article
                    key={`${conflict.entityType}-${conflict.entityId}-${index}`}
                    className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {conflict.entityType} · {conflict.entityId}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-500">
                      {(conflict.sources ?? []).join(" · ") || "-"} 에서 방향{" "}
                      {(conflict.directions ?? []).join(", ")}
                    </p>
                  </article>
                ))
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  아직 크게 엇갈리는 신호는 많지 않습니다.
                </p>
              )}
            </div>
          </section>

          <section>
            <div className="space-y-3">
              {weightSuggestions.length > 0 ? (
                weightSuggestions.map((item, index) => (
                  <article
                    key={`${item.factor}-${index}`}
                    className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.factor ?? "-"}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                          {compactText(item.suggestion, 120)}
                        </p>
                      </div>
                      <p className="text-sm text-slate-500">
                        corr{" "}
                        {typeof item.correlation_5d === "number"
                          ? item.correlation_5d.toFixed(3)
                          : "-"}
                      </p>
                    </div>
                  </article>
                ))
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  현재는 가중치 조정 제안이 비어 있습니다.
                </p>
              )}

              {reasoningRows.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {reasoningRows.slice(0, 4).map((row, index) => (
                    <article
                      key={`${row.factor}-${index}`}
                      className="rounded-[1.3rem] border border-slate-200/90 bg-slate-50/90 px-4 py-4"
                    >
                      <p className="text-sm font-semibold text-slate-900">{row.factor ?? "-"}</p>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        base {typeof row.baseWeight === "number" ? row.baseWeight.toFixed(2) : "-"} ·
                        multiplier {typeof row.multiplier === "number" ? row.multiplier.toFixed(2) : "-"} ·
                        corr {typeof row.correlation === "number" ? row.correlation.toFixed(3) : "-"}
                      </p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <div className="space-y-3">
              {worstMispredictions.length > 0 ? (
                worstMispredictions.map((item, index) => (
                  <article
                    key={`${item.code}-${index}`}
                    className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {item.name ?? item.code ?? "Unknown"}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {item.accountKey ?? "-"} · {item.signal ?? "-"}
                        </p>
                      </div>
                      <p className="text-sm text-slate-500">
                        ret {typeof item.returnPct === "number" ? `${item.returnPct.toFixed(2)}%` : "-"}
                      </p>
                    </div>
                    {item.warnings?.length ? (
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {item.warnings.join(" · ")}
                      </p>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="text-sm leading-6 text-slate-500">
                  현재 worst misprediction 리스트가 비어 있어, 아직 실패 사례 표본이 크지 않습니다.
                </p>
              )}

              {correlations.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {correlations.map(([key, value]) => (
                    <article
                      key={key}
                      className="rounded-[1.3rem] border border-slate-200/90 bg-slate-50/90 p-4"
                    >
                      <p className="text-sm font-semibold text-slate-900">{key}</p>
                      <p className="mt-2 text-[1.6rem] font-semibold text-slate-950">
                        {typeof value?.correlation === "number" ? value.correlation.toFixed(3) : "-"}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        samples {formatCount(value?.sampleCount)}
                      </p>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <div className="space-y-3">
              <article className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">데이터 메모</p>
                  <StatusChip label={qualityStatus} status={qualityStatus} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {qualityFlags.length > 0 ? (
                    qualityFlags.map((flag) => (
                      <span
                        key={flag}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600"
                      >
                        {flag}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-slate-500">특이 플래그 없음</span>
                  )}
                </div>
              </article>

              <article className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">자주 겹친 테마</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {consensusThemes.length > 0
                    ? consensusThemes.join(" · ")
                    : "현재는 테마 교집합보다 개별 리포트 해석 비중이 더 큽니다."}
                </p>
              </article>

              <article className="rounded-[1.3rem] border border-slate-200/90 bg-white/90 px-4 py-4">
                <p className="text-sm font-semibold text-slate-900">운영 메모</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  피드백 화면에서는 새 지표를 더 만들기보다, 기존 점수와 실제 수익률이 어디서 맞고 어긋났는지를 계속 같은 문법으로 남기는 편이 좋습니다.
                </p>
              </article>
            </div>
          </section>
        </CompactContentTabs>
      </SectionCard>
    </main>
  );
}
