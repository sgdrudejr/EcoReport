"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  BrainCircuit,
  Grid2X2,
  Radar,
  Sparkles,
} from "lucide-react";
import HorizontalTabRail from "@/components/HorizontalTabRail";
import SectionJumpButton from "@/components/SectionJumpButton";
import type {
  RecommendationBoard as RecommendationBoardData,
  RecommendationIdea,
  RecommendationLaneKey,
} from "@/lib/recommendations";

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function scoreClass(score: number) {
  if (score >= 75) return "text-blue-200 border-blue-500/30 bg-blue-500/12";
  if (score >= 60) return "text-indigo-200 border-indigo-500/30 bg-indigo-500/12";
  return "text-amber-200 border-amber-500/30 bg-amber-500/12";
}

function signalClass(signal: string | null) {
  if (signal === "BUY") return "text-blue-200 border-blue-500/30 bg-blue-500/12";
  if (signal === "HOLD") return "text-zinc-300 border-white/8 bg-white/[0.03]";
  if (signal === "REDUCE") return "text-amber-200 border-amber-500/30 bg-amber-500/12";
  if (signal === "SELL") return "text-sky-200 border-sky-500/30 bg-sky-500/12";
  return "text-zinc-400 border-white/8 bg-white/[0.03]";
}

function technicalBadgeLabel(signal: string | null, technicalScore: number | null) {
  if (signal && technicalScore != null) {
    return `기술 ${signal} · ${technicalScore}점`;
  }
  if (technicalScore != null) {
    return `기술 ${technicalScore}점`;
  }
  if (signal) {
    return `기술 ${signal}`;
  }
  return "기술 데이터 부족";
}

function formatShortDate(dateText: string) {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateText;
  return `${match[1].slice(2)}.${match[2]}.${match[3]}`;
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "금액 추정 대기";
  }

  return `${NUMBER_FORMATTER.format(value)}원`;
}

function getHeatClass(score: number | null | undefined) {
  if (typeof score !== "number") {
    return "border-white/8 bg-white/[0.03] text-zinc-400";
  }
  if (score >= 75) {
    return "border-blue-500/30 bg-blue-500/12 text-blue-200";
  }
  if (score >= 60) {
    return "border-indigo-500/30 bg-indigo-500/12 text-indigo-200";
  }
  if (score >= 45) {
    return "border-amber-500/30 bg-amber-500/12 text-amber-200";
  }
  return "border-rose-500/30 bg-rose-500/12 text-rose-200";
}

function resolveAccountKey(accountLabel: string | null | undefined) {
  if (accountLabel === "ISA") return "ISA";
  if (accountLabel === "연금저축") return "PENSION";
  if (accountLabel === "토스증권") return "TOSS";
  if (accountLabel === "한투 일반" || accountLabel === "KIS_MAIN") return "KIS_MAIN";
  return null;
}

function HeatCell({
  label,
  score,
  detail,
}: {
  label: string;
  score: number | null | undefined;
  detail: string;
}) {
  return (
    <div className={joinClasses("rounded-2xl border px-3 py-3", getHeatClass(score))}>
      <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums">
        {typeof score === "number" ? `${score}점` : "미반영"}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-zinc-400">{detail}</p>
    </div>
  );
}

function ThemeHeatmap({ board }: { board: RecommendationBoardData }) {
  if (board.themeSummary.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[1.1fr,0.9fr]">
      <div className="section-block">
        <div className="flex items-center gap-2">
          <Grid2X2 size={16} className="text-blue-300" />
          <h3 className="text-sm font-medium text-zinc-100">테마 히트맵</h3>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          최근 리포트에 많이 등장하고 강도가 높은 테마일수록 더 진하게 표시합니다.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {board.themeSummary.map((theme) => (
            <div
              key={theme.theme}
              className={joinClasses(
                "rounded-2xl border px-3 py-3",
                getHeatClass(theme.signalScore),
              )}
            >
              <p className="text-sm font-medium text-zinc-100">{theme.theme}</p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="text-xl font-semibold tabular-nums">{theme.signalScore}</p>
                <div className="text-right text-[11px] text-zinc-400">
                  <p>언급 {theme.mentions}회</p>
                  <p className="mt-1">
                    평균 {theme.avgSentiment > 0 ? "+" : ""}
                    {theme.avgSentiment.toFixed(2)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="section-block">
        <div className="flex items-center gap-2">
          <Radar size={16} className="text-indigo-300" />
          <h3 className="text-sm font-medium text-zinc-100">추천 컨텍스트</h3>
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          현재 추천은 아래 핵심 테마를 중심으로 정렬됩니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {board.highlightedThemes.map((theme) => (
            <span
              key={theme}
              className="rounded-full border border-blue-500/30 bg-blue-500/12 px-2.5 py-1 text-xs text-blue-200"
            >
              {theme}
            </span>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-4 text-sm text-zinc-300">
          테마 강도는 추천의 리포트 점수를 밀어주고, 기술 점수와 계좌 적합도가 최종 우선순위를 조정합니다.
        </div>
      </div>
    </div>
  );
}

function ScoreHeatmap({ item }: { item: RecommendationIdea }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
      <div className="flex items-center gap-2">
        <Activity size={15} className="text-blue-300" />
        <p className="text-sm font-medium text-zinc-100">점수 히트맵</p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <HeatCell
          label="기술"
          score={item.scoreBreakdown.technical}
          detail={item.signal ? `${item.signal} 신호 반영` : "기술 데이터 부족"}
        />
        <HeatCell
          label="리포트"
          score={item.scoreBreakdown.report}
          detail={
            item.xai.reportBasis === "theme"
              ? `테마 기반 ${item.scoreBreakdown.reportTheme}점`
              : item.xai.reportBasis === "mixed"
                ? `직접+테마 혼합`
                : `직접 리포트 기반`
          }
        />
        <HeatCell
          label="Stage 2"
          score={item.scoreBreakdown.stage2}
          detail={item.stage2Score != null ? "전략 후보 반영" : "전략 가중치 낮음"}
        />
        <HeatCell
          label="계좌 적합"
          score={item.scoreBreakdown.accountFit}
          detail={
            item.targetAccounts.length > 0
              ? item.targetAccounts.join(", ")
              : "직접 적합 계좌 약함"
          }
        />
      </div>
      {(item.scoreBreakdown.laneBonus > 0 || item.scoreBreakdown.signalPenalty > 0) && (
        <p className="mt-3 text-xs text-zinc-500">
          구조 보정: 레인 보너스 +{item.scoreBreakdown.laneBonus} / 신호 패널티 -
          {item.scoreBreakdown.signalPenalty}
        </p>
      )}
    </div>
  );
}

function ExplainabilityCard({ item }: { item: RecommendationIdea }) {
  const reportPathText =
    item.xai.reportBasis === "theme"
      ? `${item.dominantTheme} 테마 강도를 중심으로 리포트 점수를 계산했습니다.`
      : item.xai.reportBasis === "mixed"
        ? `직접 연결된 리포트 ${item.xai.directImpactCount}건과 테마 강도를 함께 반영했습니다.`
        : `직접 연결된 리포트 ${item.xai.directImpactCount}건이 핵심 근거입니다.`;

  const technicalPathText = item.xai.signalReason
    ? item.xai.signalReason
    : item.signal
      ? `${item.signal} 신호가 기술 축의 기본 판단을 만들었습니다.`
      : "기술 데이터가 부족해 리포트와 계좌 적합도 비중이 상대적으로 커졌습니다.";

  const stage2PathText = item.xai.stage2Thesis
    ? item.xai.stage2Thesis
    : "Stage 2 전략 후보 근거는 약하지만, 현재는 리포트와 기술 점수로 우선순위를 정했습니다.";

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
      <div className="flex items-center gap-2">
        <BrainCircuit size={15} className="text-blue-300" />
        <p className="text-sm font-medium text-zinc-100">AI 설명 경로</p>
      </div>

      <ul className="mt-3 space-y-2 text-sm text-zinc-200">
        <li className="flex gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-blue-300" />
          <span>{reportPathText}</span>
        </li>
        <li className="flex gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-blue-300" />
          <span>{technicalPathText}</span>
        </li>
        <li className="flex gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-blue-300" />
          <span>{stage2PathText}</span>
        </li>
        <li className="flex gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-blue-300" />
          <span>{item.xai.accountRationale}</span>
        </li>
      </ul>

      {item.xai.directImpactTitles.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-zinc-500">연결된 리포트</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {item.xai.directImpactTitles.map((title) => (
              <span
                key={`${item.code}-${title}`}
                className="rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1 text-[11px] text-zinc-300"
              >
                {title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecommendationBoard({
  board,
}: {
  board: RecommendationBoardData;
}) {
  const [selectedLaneKey, setSelectedLaneKey] = useState(board.lanes[0]?.key ?? "core");
  const [expandedIdeaKeys, setExpandedIdeaKeys] = useState<Record<string, boolean>>({});
  const activeLane =
    board.lanes.find((lane) => lane.key === selectedLaneKey) ?? board.lanes[0] ?? null;

  if (!activeLane) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            종목 추천
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            리포트 테마, 전략 후보, 계좌 적합도, 기술 신호를 함께 엮어서 우선순위를 만듭니다.
          </p>
        </div>
        {board.date && (
          <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
            종목추천 : 기준일 {formatShortDate(board.date)}
          </span>
        )}
      </div>

      <ThemeHeatmap board={board} />

      <HorizontalTabRail
        items={board.lanes}
        getKey={(lane) => lane.key}
        selectedKey={activeLane.key}
        onSelect={(key) => setSelectedLaneKey(key as RecommendationLaneKey)}
        sticky
        itemClassName="min-w-[150px]"
        selectedItemClassName="border-blue-500/60 bg-blue-500/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
        unselectedItemClassName="border-white/8 bg-white/[0.03]"
        renderItem={(lane) => (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-zinc-100">{lane.title}</p>
            <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">
              {lane.items.length}
            </span>
          </div>
        )}
      />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{activeLane.title}</h3>
          <p className="mt-1 text-sm text-zinc-500">{activeLane.description}</p>
        </div>
        <span className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-xs text-zinc-400">
          {activeLane.items.length}개
        </span>
      </div>

      {activeLane.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.025] px-4 py-6 text-sm text-zinc-500">
          현재 데이터 기준으로는 이 레인의 확신도 높은 후보가 아직 부족합니다. 리포트 영향도와 기술 점수가 더 쌓이면 자동으로 채워집니다.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {activeLane.items.map((item) => {
            const itemKey = `${activeLane.key}-${item.code}`;
            const isExpanded = expandedIdeaKeys[itemKey] ?? false;
            const change = formatSignedPercent(item.changePct);
            const primaryAccountKey = resolveAccountKey(item.targetAccounts[0] ?? null);
            const primaryExecutionTarget = item.executionTargets[0] ?? null;
            const themeAndAccountChips = [
              ...item.themes.map((theme) => ({
                key: `${item.code}-${theme}`,
                label: theme,
                className:
                  "rounded-full border border-white/8 bg-white/[0.025] px-2.5 py-1 text-xs text-zinc-300",
              })),
              ...item.targetAccounts.map((account) => ({
                key: `${item.code}-${account}`,
                label: account,
                className:
                  "rounded-full border border-blue-500/30 bg-blue-500/12 px-2.5 py-1 text-xs text-blue-200",
              })),
            ];

            return (
              <article
                key={itemKey}
                className="rounded-2xl border border-white/8 bg-white/[0.035] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-zinc-100">
                        {item.name}
                      </h4>
                      <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">
                        {item.code}
                      </span>
                      <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400">
                        {item.kind}
                      </span>
                      {item.held && (
                        <span className="rounded-full border border-blue-500/30 bg-blue-500/12 px-2 py-0.5 text-[11px] text-blue-200">
                          현재 보유
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-zinc-300">{item.rationale}</p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-xs text-zinc-500">종합 점수</p>
                    <p className="mt-1 whitespace-nowrap text-2xl font-semibold leading-none tabular-nums text-zinc-100 sm:text-3xl">
                      {item.score}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${scoreClass(item.score)}`}>
                    {item.tag}
                  </span>
                  <span className={`rounded-full border px-2.5 py-1 text-xs ${signalClass(item.signal)}`}>
                    {technicalBadgeLabel(item.signal, item.technicalScore)}
                  </span>
                  <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300">
                    리포트 {item.reportScore}점
                  </span>
                  {item.stage2Score != null && (
                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300">
                      전략 {item.stage2Score}점
                    </span>
                  )}
                  {change && (
                    <span className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300">
                      등락 {change}
                    </span>
                  )}
                </div>

                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                  <p className="text-xs text-zinc-500">핵심 한 줄</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-200">
                    {item.reasons[0] ?? item.rationale}
                  </p>
                  {primaryExecutionTarget && (
                    <p className="mt-2 text-xs text-blue-200">
                      오늘실행: {primaryExecutionTarget.accountLabel} ·{" "}
                      {formatCurrency(primaryExecutionTarget.suggestedAmount)}
                    </p>
                  )}
                  {item.risks[0] && (
                    <p className="mt-2 text-xs text-amber-200">
                      유의: {item.risks[0]}
                    </p>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedIdeaKeys((current) => ({
                        ...current,
                        [itemKey]: !current[itemKey],
                      }))
                    }
                    className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/[0.07]"
                  >
                    {isExpanded ? "상세 접기" : "상세 펼치기"}
                  </button>
                  <SectionJumpButton
                    targetId="strategy-overview"
                    focusAccountKey={primaryAccountKey}
                    clearSearchParams={["actionAccount", "actionCode", "preflight"]}
                    className="inline-flex items-center gap-2 rounded-full border border-indigo-500/25 bg-indigo-500/12 px-4 py-2 text-sm text-indigo-100 transition hover:bg-indigo-500/18"
                  >
                    운용 가이드 연결
                  </SectionJumpButton>
                  {primaryExecutionTarget && (
                    <SectionJumpButton
                      targetId="action-overview"
                      searchParams={{
                        actionAccount: primaryExecutionTarget.accountKey,
                        actionCode: item.code,
                        preflight: "1",
                      }}
                      eventName="ecoreport:open-preflight"
                      eventDetail={{
                        accountKey: primaryExecutionTarget.accountKey,
                        code: item.code,
                      }}
                    className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/12 px-4 py-2 text-sm text-amber-100 transition hover:bg-amber-500/18"
                  >
                    오늘실행 열기
                  </SectionJumpButton>
                  )}
                  <Link
                    href="/portfolio/update"
                    className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/12 px-4 py-2 text-sm text-blue-100 transition hover:bg-blue-500/18"
                  >
                    포트 업데이트
                  </Link>
                </div>

                {isExpanded && (
                  <>
                    <div className="mt-4 grid gap-3 xl:grid-cols-[0.9fr,1.1fr]">
                      <ScoreHeatmap item={item} />
                      <ExplainabilityCard item={item} />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                        <p className="text-xs text-zinc-500">추천 이유</p>
                        <ul className="mt-2 space-y-1.5 text-sm text-zinc-100">
                          {item.reasons.map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                        <p className="text-xs text-zinc-500">테마 · 적합 계좌</p>
                        <div className="mt-2 flex max-h-[5.25rem] flex-wrap gap-2 overflow-hidden">
                          {themeAndAccountChips.length > 0 ? (
                            themeAndAccountChips.map((chip) => (
                              <span key={chip.key} className={chip.className}>
                                {chip.label}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-zinc-500">계좌 적합성 데이터 부족</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {item.executionTargets.length > 0 && (
                      <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3">
                        <p className="text-xs text-zinc-500">오늘실행 연결</p>
                        <div className="mt-3 grid gap-2">
                          {item.executionTargets.map((target) => (
                            <div
                              key={`${item.code}-${target.accountKey}`}
                              className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-medium text-zinc-100">
                                    {target.accountLabel}
                                  </p>
                                  <p className="mt-1 text-xs text-zinc-500">
                                    {target.reason ?? "실행 계획 우선 후보로 연결된 종목입니다."}
                                  </p>
                                </div>
                                <p className="text-sm font-semibold tabular-nums text-zinc-100">
                                  {formatCurrency(target.suggestedAmount)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {item.risks.length > 0 && (
                      <div className="mt-4 rounded-xl border border-red-950/40 bg-red-950/20 px-3 py-3">
                        <p className="text-xs text-red-200/70">유의할 점</p>
                        <ul className="mt-2 space-y-1 text-sm text-red-100">
                          {item.risks.map((risk) => (
                            <li key={risk}>- {risk}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
