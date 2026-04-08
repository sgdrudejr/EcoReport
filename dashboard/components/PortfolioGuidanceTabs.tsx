"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Radar,
  X,
} from "lucide-react";
import SectionJumpButton from "@/components/SectionJumpButton";
import type { AccountGuide } from "@/lib/portfolio-guidance";

const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");

type HoldingGuideItem = AccountGuide["holdingGuides"][number];
type RadarAxis = {
  key: string;
  label: string;
  value: number;
  tone: "emerald" | "sky" | "amber" | "rose" | "zinc";
  detail: string;
};

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function clampScore(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function formatSignedCurrency(value: number) {
  return `${value > 0 ? "+" : ""}${NUMBER_FORMATTER.format(value)}원`;
}

function formatSignedPercent(value: number | null) {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatPercent(value: number | null | undefined, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
}

function getStatusClass(status: AccountGuide["status"]) {
  if (status === "양호") return "border-blue-500/35 bg-blue-500/12 text-blue-300";
  if (status === "보강 필요") return "border-amber-500/35 bg-amber-500/12 text-amber-300";
  return "border-rose-500/35 bg-rose-500/12 text-rose-300";
}

function getHoldingScoreClass(score: number | null) {
  if (score == null) return "text-zinc-100";
  if (score >= 70) return "text-blue-400";
  if (score >= 55) return "text-amber-300";
  return "text-rose-400";
}

function getSignalClass(signal: string | null | undefined) {
  if (signal === "BUY") return "border-blue-500/35 bg-blue-500/12 text-blue-300";
  if (signal === "HOLD") return "border-indigo-500/35 bg-indigo-500/12 text-indigo-300";
  if (signal === "WATCH") return "border-amber-500/35 bg-amber-500/12 text-amber-300";
  if (signal === "REDUCE" || signal === "SELL") return "border-sky-500/35 bg-sky-500/12 text-sky-300";
  return "border-white/8 bg-white/[0.03] text-zinc-400";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatBarPercent(value: number) {
  return `${clampPercent(value).toFixed(1)}%`;
}

function normalizeFocusAccountKey(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim().toUpperCase();

  if (normalized === "ISA") return "ISA";
  if (normalized === "PENSION" || normalized === "연금저축".toUpperCase()) {
    return "PENSION";
  }
  if (normalized === "TOSS" || normalized === "토스증권".toUpperCase()) {
    return "TOSS";
  }
  if (
    normalized === "KIS_MAIN" ||
    normalized === "KIS" ||
    normalized === "한투 일반".toUpperCase() ||
    normalized === "한투증권".toUpperCase() ||
    normalized === "한국투자증권".toUpperCase()
  ) {
    return "KIS_MAIN";
  }

  return null;
}

function getHoldingKey(holding: HoldingGuideItem) {
  return holding.code ?? holding.name;
}

function getExecutionItems(account: AccountGuide) {
  return [
    ...account.executionBuys,
    ...account.executionTrims,
    ...account.executionHolds,
  ].sort((left, right) => (right.suggestedAmount ?? 0) - (left.suggestedAmount ?? 0));
}

function getExecutionKindLabel(kind: "buy" | "trim" | "hold") {
  if (kind === "trim") return "비중 축소";
  if (kind === "hold") return "유지";
  return "분할 매수";
}

function getExecutionKindClass(kind: "buy" | "trim" | "hold") {
  if (kind === "trim") {
    return "border-amber-500/35 bg-amber-500/12 text-amber-300";
  }
  if (kind === "hold") {
    return "border-white/8 bg-white/[0.03] text-zinc-300";
  }
  return "border-blue-500/35 bg-blue-500/12 text-blue-300";
}

function getDataQualityScore(account: AccountGuide) {
  const dataQualityPenalty = account.riskPenaltyBreakdown?.dataQuality?.total ?? 0;
  const incompletePenalty =
    account.riskPenaltyBreakdown?.dataQuality?.incompletePenalty ?? 0;
  const lowCoveragePenalty =
    typeof account.techCoverage === "number" ? (1 - account.techCoverage) * 12 : 0;
  const reportGapPenalty =
    account.reportStatus === "unavailable"
      ? 8
      : account.reportCoverageScore != null && account.reportCoverageScore < 40
        ? 4
        : 0;

  return clampScore(
    Math.round(
      95 - dataQualityPenalty * 10 - incompletePenalty * 6 - lowCoveragePenalty - reportGapPenalty,
    ),
    32,
    96,
  );
}

function getRadarAxes(account: AccountGuide): RadarAxis[] {
  const dataQualityScore = getDataQualityScore(account);

  return [
    {
      key: "allocation",
      label: "배분",
      value: clampScore(account.allocationScore),
      tone: "sky",
      detail: "목표 비중과 현재 비중 차이",
    },
    {
      key: "technical",
      label: "기술",
      value: clampScore(account.technicalScore ?? 35),
      tone: account.technicalScore != null && account.technicalScore >= 55 ? "emerald" : "amber",
      detail: "보유 종목 기술 신호 평균",
    },
    {
      key: "report",
      label: "리포트",
      value: clampScore(
        account.reportStatus === "available"
          ? account.reportScore ?? account.reportCoverageScore ?? 45
          : Math.max(32, Math.round((account.reportCoverageScore ?? 0) * 0.8)),
      ),
      tone: account.reportStatus === "available" ? "emerald" : "zinc",
      detail: "직접 연결된 리포트 강도",
    },
    {
      key: "regime",
      label: "레짐",
      value: clampScore(account.regimeFitScore ?? 50),
      tone: account.regimeFitScore != null && account.regimeFitScore >= 55 ? "emerald" : "amber",
      detail: "현재 장세와의 적합도",
    },
    {
      key: "data",
      label: "데이터",
      value: dataQualityScore,
      tone: dataQualityScore >= 75 ? "emerald" : dataQualityScore >= 55 ? "amber" : "rose",
      detail: "데이터 품질 패널티 역산",
    },
  ];
}

function getRadarToneClass(tone: RadarAxis["tone"]) {
  if (tone === "emerald") return "border-blue-500/25 bg-blue-500/10 text-blue-300";
  if (tone === "sky") return "border-indigo-500/25 bg-indigo-500/10 text-indigo-300";
  if (tone === "amber") return "border-amber-500/25 bg-amber-500/10 text-amber-300";
  if (tone === "rose") return "border-rose-500/25 bg-rose-500/10 text-rose-300";
  return "border-white/8 bg-white/[0.03] text-zinc-300";
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-rose-400"
      : tone === "bad"
        ? "text-sky-400"
        : "text-zinc-100";

  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-3 md:px-4">
      <p className="text-[11px] leading-4 text-zinc-500 md:text-xs">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums md:text-xl ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function CapitalOverviewCard({
  totalAssets,
  holdingsValue,
  recommendedDeploy,
  reserveCash,
}: {
  totalAssets: number;
  holdingsValue: number;
  recommendedDeploy: number;
  reserveCash: number;
}) {
  const investedPct = totalAssets > 0 ? (holdingsValue / totalAssets) * 100 : 0;
  const deployPct = totalAssets > 0 ? (recommendedDeploy / totalAssets) * 100 : 0;
  const reservePct = totalAssets > 0 ? (reserveCash / totalAssets) * 100 : 0;
  const investedWidth = clampPercent(investedPct);
  const deployWidth = clampPercent(deployPct);
  const reserveWidth = clampPercent(reservePct);

  return (
    <div className="section-block">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">자금 배치 요약</p>
          <p className="mt-1 text-xs text-zinc-500">
            총 자산을 현재 투입, 이번 단계 투입, 대기 자금으로 나눠서 한 줄로 봅니다.
          </p>
        </div>
        <p className="text-xs text-zinc-500">기준 {NUMBER_FORMATTER.format(totalAssets)}원</p>
      </div>

      <div className="mt-4 overflow-hidden rounded-full bg-zinc-800">
        <div className="flex h-4 w-full">
          <div
            className="bg-blue-400/90 transition-[width] duration-300"
            style={{ width: `${investedWidth}%` }}
            title={`현재 투입 ${formatBarPercent(investedPct)}`}
          />
          <div
            className="bg-sky-400/90 transition-[width] duration-300"
            style={{ width: `${deployWidth}%` }}
            title={`이번 단계 투입 ${formatBarPercent(deployPct)}`}
          />
          <div
            className="bg-amber-300/90 transition-[width] duration-300"
            style={{ width: `${reserveWidth}%` }}
            title={`대기 자금 ${formatBarPercent(reservePct)}`}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-blue-500/25 bg-blue-500/10 px-3 py-3 text-center">
          <p className="text-[11px] leading-4 text-blue-300/80 md:text-xs">현재 투입</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-blue-300 md:text-lg">
            {formatBarPercent(investedPct)}
          </p>
          <p className="mt-1 text-[11px] leading-4 tabular-nums text-zinc-400 md:text-xs">
            {NUMBER_FORMATTER.format(holdingsValue)}원
          </p>
        </div>
        <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/10 px-3 py-3 text-center">
          <p className="text-[11px] leading-4 text-indigo-300/80 md:text-xs">이번 단계 투입</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-indigo-300 md:text-lg">
            {formatBarPercent(deployPct)}
          </p>
          <p className="mt-1 text-[11px] leading-4 tabular-nums text-zinc-400 md:text-xs">
            {NUMBER_FORMATTER.format(recommendedDeploy)}원
          </p>
        </div>
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-3 py-3 text-center">
          <p className="text-[11px] leading-4 text-amber-300/80 md:text-xs">대기 자금</p>
          <p className="mt-1 text-base font-semibold tabular-nums text-amber-300 md:text-lg">
            {formatBarPercent(reservePct)}
          </p>
          <p className="mt-1 text-[11px] leading-4 tabular-nums text-zinc-400 md:text-xs">
            {NUMBER_FORMATTER.format(reserveCash)}원
          </p>
        </div>
      </div>
    </div>
  );
}

function RadarChartCard({
  account,
  compact = false,
}: {
  account: AccountGuide;
  compact?: boolean;
}) {
  const axes = useMemo(() => getRadarAxes(account), [account]);
  const weakestAxis = [...axes].sort((left, right) => left.value - right.value)[0];
  const strongestAxis = [...axes].sort((left, right) => right.value - left.value)[0];
  const size = compact ? 220 : 252;
  const center = size / 2;
  const radius = compact ? 68 : 82;
  const labelRadius = radius + (compact ? 20 : 26);

  const pointsForScale = (scale: number) =>
    axes
      .map((axis, index) => {
        const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / axes.length);
        const axisRadius = radius * scale;
        const x = center + Math.cos(angle) * axisRadius;
        const y = center + Math.sin(angle) * axisRadius;
        return `${x},${y}`;
      })
      .join(" ");

  const labelPositions = axes.map((axis, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / axes.length);
    return {
      axis,
      x: center + Math.cos(angle) * labelRadius,
      y: center + Math.sin(angle) * labelRadius,
    };
  });

  const dataPoints = axes
    .map((axis, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / axes.length);
      const axisRadius = radius * (axis.value / 100);
      const x = center + Math.cos(angle) * axisRadius;
      const y = center + Math.sin(angle) * axisRadius;
      return { x, y };
    });

  return (
    <div className="section-block">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Radar size={16} className="text-blue-300" />
            <h4 className="text-sm font-medium text-zinc-200">다축 진단 레이더</h4>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            배분, 기술, 리포트, 레짐, 데이터 품질을 한 번에 비교합니다.
          </p>
        </div>
        <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(account.status)}`}>
          {account.score}점
        </span>
      </div>

      <div className="mt-4 flex justify-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
          {[0.2, 0.4, 0.6, 0.8, 1].map((scale) => (
            <polygon
              key={scale}
              points={pointsForScale(scale)}
              fill="none"
              stroke="rgba(113,113,122,0.25)"
              strokeWidth="1"
            />
          ))}

          {axes.map((_, index) => {
            const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / axes.length);
            return (
              <line
                key={`axis-${index}`}
                x1={center}
                y1={center}
                x2={center + Math.cos(angle) * radius}
                y2={center + Math.sin(angle) * radius}
                stroke="rgba(113,113,122,0.32)"
                strokeWidth="1"
              />
            );
          })}

          <polygon
            points={dataPoints.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="rgba(56,189,248,0.16)"
            stroke="rgba(56,189,248,0.85)"
            strokeWidth="2"
          />

          {dataPoints.map((point, index) => (
            <circle
              key={`point-${axes[index]?.key ?? index}`}
              cx={point.x}
              cy={point.y}
              r="4"
              fill="rgb(56 189 248)"
            />
          ))}

          {labelPositions.map(({ axis, x, y }) => (
            <g key={axis.key}>
              <text
                x={x}
                y={y}
                textAnchor={x < center - 10 ? "end" : x > center + 10 ? "start" : "middle"}
                dominantBaseline={y < center - 10 ? "alphabetic" : y > center + 10 ? "hanging" : "middle"}
                fill="rgb(212 212 216)"
                fontSize={compact ? 10 : 11}
              >
                {axis.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      <div className={joinClasses("mt-4 grid gap-2", compact ? "grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-5")}>
        {axes.map((axis) => (
          <div
            key={axis.key}
            className={joinClasses(
              "rounded-2xl border px-3 py-3",
              getRadarToneClass(axis.tone),
            )}
          >
            <p className="text-[11px] uppercase tracking-wide">{axis.label}</p>
            <p className="mt-1 text-base font-semibold tabular-nums">{axis.value}점</p>
            <p className="mt-1 text-[11px] leading-4 text-zinc-400">{axis.detail}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-white/8 pt-3 text-sm text-zinc-300 md:pt-4">
        가장 약한 축은 <span className="font-medium text-zinc-100">{weakestAxis.label}</span>, 가장 강한 축은{" "}
        <span className="font-medium text-zinc-100">{strongestAxis.label}</span>입니다.
      </div>
    </div>
  );
}

function HoldingScoreCard({ account }: { account: AccountGuide }) {
  const [selectedHoldingKey, setSelectedHoldingKey] = useState(
    account.holdingGuides[0] ? getHoldingKey(account.holdingGuides[0]) : "",
  );

  const resolvedHoldingKey = account.holdingGuides.some(
    (holding) => getHoldingKey(holding) === selectedHoldingKey,
  )
    ? selectedHoldingKey
    : account.holdingGuides[0]
      ? getHoldingKey(account.holdingGuides[0])
      : "";

  const selectedHolding =
    account.holdingGuides.find((holding) => getHoldingKey(holding) === resolvedHoldingKey) ??
    account.holdingGuides[0] ??
    null;

  return (
    <div className="section-block">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-zinc-200">보유 종목별 점수</h4>
          <p className="mt-1 text-xs text-zinc-500">
            계좌 적합도, 기술 점수, 리포트 점수를 합친 종합 점수입니다.
          </p>
        </div>
      </div>

      <div className="mt-4">
        {account.holdingGuides.length > 0 && selectedHolding ? (
          <div className="grid gap-3 xl:grid-cols-[22rem,minmax(0,1fr)]">
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">종목 리스트</p>
                <p className="text-xs text-zinc-500">{account.holdingGuides.length}개</p>
              </div>
              <div className="space-y-2">
                {account.holdingGuides.map((holding) => {
                  const holdingKey = getHoldingKey(holding);
                  const isSelected = holdingKey === resolvedHoldingKey;
                  return (
                    <button
                      key={`${account.key}-${holdingKey}`}
                      type="button"
                      onClick={() => setSelectedHoldingKey(holdingKey)}
                      className={`grid w-full grid-cols-[minmax(0,1fr),auto] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition md:px-4 ${
                        isSelected
                          ? "border-blue-500/60 bg-blue-500/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
                          : "border-white/8 bg-white/[0.025] hover:border-white/15"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-100">
                          {holding.name}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">{holding.category}</p>
                      </div>
                      <p
                        className={`shrink-0 text-lg font-semibold tabular-nums ${getHoldingScoreClass(
                          holding.score,
                        )}`}
                      >
                        {holding.score != null ? `${holding.score}점` : "-"}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3 md:px-4 md:py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-zinc-100">{selectedHolding.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {selectedHolding.category} · 비중 {formatPercent(selectedHolding.weightPct)}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-2xl font-semibold tabular-nums ${getHoldingScoreClass(
                      selectedHolding.score,
                    )}`}
                  >
                    {selectedHolding.score != null ? `${selectedHolding.score}점` : "-"}
                  </p>
                  <span
                    className={`mt-2 inline-flex rounded-full border px-2 py-1 text-[11px] ${getSignalClass(
                      selectedHolding.signal ?? selectedHolding.technicalSignal,
                    )}`}
                  >
                    {selectedHolding.signal ?? selectedHolding.technicalSignal ?? "N/A"}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
                  <p className="text-zinc-500">계좌 적합도</p>
                  <p className="mt-1 font-medium text-zinc-100">
                    {selectedHolding.accountFitScore != null
                      ? `${selectedHolding.accountFitScore}점`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
                  <p className="text-zinc-500">기술 점수</p>
                  <p className="mt-1 font-medium text-zinc-100">
                    {selectedHolding.technicalScore != null
                      ? `${selectedHolding.technicalScore}점`
                      : "-"}
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
                  <p className="text-zinc-500">리포트 점수</p>
                  <p className="mt-1 font-medium text-zinc-100">
                    {selectedHolding.reportStatus === "available" &&
                    selectedHolding.reportScore != null
                      ? `${selectedHolding.reportScore}점`
                      : "미반영"}
                  </p>
                </div>
              </div>

              {selectedHolding.topDrivers.length > 0 && (
                <p className="mt-3 text-xs text-zinc-400">
                  핵심: {selectedHolding.topDrivers.slice(0, 2).join(" · ")}
                </p>
              )}
              {selectedHolding.warnings.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">
                  주의: {selectedHolding.warnings[0]}
                </p>
              )}
              {selectedHolding.reportStatus === "unavailable" && (
                <p className="mt-1 text-xs text-amber-300">
                  리포트 미반영
                  {selectedHolding.reportUnavailableReason === "no_report_input"
                    ? " · 기준 거래일 리포트 입력 없음"
                    : " · 직접 연결된 리포트 근거 부족"}
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">보유 종목 점수 데이터가 아직 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function InfoBlock({
  title,
  items,
}: {
  title: string;
  items: string[];
}) {
  return (
    <div className="section-block">
      <p className="text-xs text-zinc-500">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-zinc-100">
        {items.length > 0 ? items.map((item) => <li key={item}>- {item}</li>) : <li>- 내용 없음</li>}
      </ul>
    </div>
  );
}

function ExecutionDetailBlock({
  account,
  compact = false,
}: {
  account: AccountGuide;
  compact?: boolean;
}) {
  const executionItems = getExecutionItems(account);

  if (executionItems.length === 0) {
    return (
      <div className="section-block">
        <p className="text-xs text-zinc-500">집행 후보 상세</p>
        <p className="mt-3 text-sm leading-6 text-zinc-400">
          현재는 별도 집행 후보보다 계좌 전략과 비중 점검이 우선입니다.
        </p>
      </div>
    );
  }

  return (
    <div className="section-block">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500">집행 후보 상세</p>
          <p className="mt-1 text-sm text-zinc-300">
            계좌별 Stage 4 실행 계획 기준 금액과 이유를 바로 확인합니다.
          </p>
        </div>
        <span className="rounded-full border border-white/8 bg-white/[0.03] px-2 py-1 text-[11px] text-zinc-400">
          {executionItems.length}개
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {executionItems.slice(0, compact ? 2 : 4).map((item, index) => (
          <div
            key={`${account.key}-${item.kind}-${item.code ?? item.name}-${index}`}
            className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-zinc-100">
                    {item.name}
                  </p>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${getExecutionKindClass(item.kind)}`}>
                    {getExecutionKindLabel(item.kind)}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {item.reason ?? account.actionLine ?? account.note}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-zinc-100">
                {item.suggestedAmount != null ? `${NUMBER_FORMATTER.format(item.suggestedAmount)}원` : "금액 대기"}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <SectionJumpButton
                targetId="action-overview"
                searchParams={{
                  actionAccount: account.key,
                  actionCode: item.code ?? "",
                  preflight: "1",
                }}
                eventName="ecoreport:open-preflight"
                eventDetail={{
                  accountKey: account.key,
                  code: item.code,
                }}
                className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/12 px-3 py-1.5 text-xs text-blue-100 transition hover:bg-blue-500/18"
              >
                오늘실행 프리플로우
              </SectionJumpButton>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DesktopSelector({
  accounts,
  selectedKey,
  onSelect,
}: {
  accounts: AccountGuide[];
  selectedKey: string;
  onSelect: (key: string) => void;
}) {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const updateCompact = () => {
      setIsCompact(window.scrollY > 320);
    };

    updateCompact();
    window.addEventListener("scroll", updateCompact, { passive: true });

    return () => {
      window.removeEventListener("scroll", updateCompact);
    };
  }, []);

  return (
    <div className="hidden md:block sticky top-2 z-30 -mx-2 px-2">
      <div
        className={joinClasses(
          "rounded-2xl border border-slate-200 bg-white/92 shadow-[0_10px_30px_rgba(15,23,42,0.08)] backdrop-blur-md transition-all duration-200",
          isCompact ? "p-2.5" : "p-3",
        )}
      >
        <div
          className={joinClasses(
            "px-1 text-[11px] uppercase tracking-wide text-zinc-500 transition-all duration-200",
            isCompact ? "mb-1" : "mb-2",
          )}
        >
          계좌 전환
        </div>
        <div className={joinClasses("grid grid-cols-3", isCompact ? "gap-2" : "gap-3")}>
          {accounts.map((account) => {
            const isSelected = account.key === selectedKey;
            const toneClass =
              account.holdingsProfitLoss > 0
                ? "text-rose-400"
                : account.holdingsProfitLoss < 0
                  ? "text-sky-400"
                  : "text-zinc-300";

            return (
              <button
                key={account.key}
                type="button"
                onClick={() => onSelect(account.key)}
                className={joinClasses(
                  "rounded-2xl border text-left transition",
                  isSelected
                    ? "border-blue-500/60 bg-blue-500/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
                    : "border-white/8 bg-white/[0.03] hover:border-white/15",
                  isCompact ? "p-2.5" : "p-4",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className={joinClasses(
                        "font-semibold text-zinc-100",
                        isCompact ? "text-xs" : "text-sm",
                      )}
                    >
                      {account.label}
                    </p>
                    {!isCompact && (
                      <p className="mt-1 text-xs text-zinc-500">계좌별 운용 점수</p>
                    )}
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(account.status)}`}>
                    {isCompact ? `${account.score}점` : account.status}
                  </span>
                </div>

                {isCompact ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className={`truncate text-xs font-medium ${toneClass}`}>
                      {formatSignedCurrency(account.holdingsProfitLoss)}
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      투입 {NUMBER_FORMATTER.format(account.recommendedDeploy)}원
                    </p>
                  </div>
                ) : (
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <p className="text-3xl font-semibold tabular-nums text-zinc-100">{account.score}점</p>
                    <div className="text-right text-xs text-zinc-500">
                      <p>이번 단계 투입</p>
                      <p className="mt-1 font-medium text-zinc-300">
                        {NUMBER_FORMATTER.format(account.recommendedDeploy)}원
                      </p>
                    </div>
                  </div>
                )}

                {!isCompact && (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <p className="text-zinc-500">보유 손익</p>
                        <p className={`mt-1 font-medium ${toneClass}`}>
                          {formatSignedCurrency(account.holdingsProfitLoss)}
                        </p>
                      </div>
                      <div>
                        <p className="text-zinc-500">보유 수익률</p>
                        <p className={`mt-1 font-medium ${toneClass}`}>
                          {formatSignedPercent(account.holdingsProfitRate)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                      <span>배분 {account.allocationScore}점</span>
                      <span>기술 {account.technicalScore != null ? `${account.technicalScore}점` : "-"}</span>
                      {account.reportStatus === "available" && account.reportScore != null ? (
                        <span>리포트 {account.reportScore}점</span>
                      ) : (
                        <span>리포트 미반영</span>
                      )}
                      {account.riskPenaltyTotal != null && <span>패널티 {account.riskPenaltyTotal}점</span>}
                    </div>
                  </>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MobileSelector({
  accounts,
  selectedKey,
  onSelect,
  onOpenDetail,
}: {
  accounts: AccountGuide[];
  selectedKey: string;
  onSelect: (key: string) => void;
  onOpenDetail: (key: string) => void;
}) {
  return (
    <div className="md:hidden -mx-2.5 overflow-x-auto px-2.5">
      <div className="flex gap-3 pb-1">
        {accounts.map((account) => {
          const isSelected = account.key === selectedKey;
          const toneClass =
            account.holdingsProfitLoss > 0
              ? "text-rose-400"
              : account.holdingsProfitLoss < 0
                ? "text-sky-400"
                : "text-zinc-300";

          return (
            <button
              key={account.key}
              type="button"
              onClick={() => {
                onSelect(account.key);
                onOpenDetail(account.key);
              }}
              className={`min-w-[250px] rounded-2xl border p-4 text-left transition ${
                isSelected
                  ? "border-blue-500/60 bg-blue-500/12 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]"
                  : "border-white/8 bg-white/[0.03]"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{account.label}</p>
                  <p className="mt-1 text-xs text-zinc-500">탭하면 상세 바텀시트</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(account.status)}`}>
                    {account.score}점
                  </span>
                  <ChevronRight size={16} className="text-zinc-500" />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[11px] text-zinc-500">보유 손익</p>
                  <p className={`mt-1 text-sm font-medium ${toneClass}`}>
                    {formatSignedCurrency(account.holdingsProfitLoss)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-zinc-500">우선 액션</p>
                  <p className="mt-1 text-sm font-medium text-zinc-200">
                    {account.improvementActions[0] ?? account.note}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AccountBottomSheet({
  account,
  open,
  onClose,
}: {
  account: AccountGuide | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeydown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [onClose, open]);

  if (!open || !account) return null;

  const holdingsTone =
    account.holdingsProfitLoss > 0
      ? "good"
      : account.holdingsProfitLoss < 0
        ? "bad"
        : "default";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-slate-900/18 backdrop-blur-[6px] md:hidden"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-[1.8rem] border border-slate-200 bg-white/96 px-4 pb-8 pt-3 shadow-[0_-20px_60px_rgba(15,23,42,0.12)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-14 rounded-full bg-zinc-700" />
        <div className="mt-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold text-zinc-100">{account.label}</h3>
              <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(account.status)}`}>
                {account.status}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">{account.note}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/8 bg-white/[0.03] p-2 text-zinc-400"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <MetricCard label="운용 점수" value={`${account.score}점`} />
          <MetricCard label="이번 단계 투입" value={`${NUMBER_FORMATTER.format(account.recommendedDeploy)}원`} />
          <MetricCard
            label="보유 손익"
            value={formatSignedCurrency(account.holdingsProfitLoss)}
            tone={holdingsTone}
          />
          <MetricCard
            label="보유 수익률"
            value={formatSignedPercent(account.holdingsProfitRate)}
            tone={holdingsTone}
          />
        </div>

        <div className="mt-4">
          <RadarChartCard account={account} compact />
        </div>

        <div className="mt-4 grid gap-4">
          <ExecutionDetailBlock account={account} compact />
          <InfoBlock title="점수를 올리려면" items={account.improvementActions.slice(0, 3)} />
          <InfoBlock title="왜 이 점수인가" items={account.scoreDrivers.slice(0, 3)} />
          <InfoBlock title="액션 포인트" items={account.actionPoints.slice(0, 3)} />
        </div>
      </div>
    </div>
  );
}

export default function PortfolioGuidanceTabs({
  accounts,
  analysisDateLabel,
}: {
  accounts: AccountGuide[];
  analysisDateLabel?: string | null;
}) {
  const [selectedKey, setSelectedKey] = useState(accounts[0]?.key ?? "");
  const [mobileSheetKey, setMobileSheetKey] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.key === selectedKey) ?? accounts[0] ?? null,
    [accounts, selectedKey],
  );

  const mobileSheetAccount =
    accounts.find((account) => account.key === mobileSheetKey) ?? null;

  useEffect(() => {
    const applyFocusedAccount = (rawValue: string | null | undefined) => {
      const nextKey = normalizeFocusAccountKey(rawValue);
      if (!nextKey) return;
      if (!accounts.some((account) => account.key === nextKey)) return;
      setSelectedKey(nextKey);
    };

    const syncFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      applyFocusedAccount(params.get("account"));
    };

    const handleFocusAccount = (event: Event) => {
      const detail =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail
          : null;
      applyFocusedAccount(detail);
    };

    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener(
      "ecoreport:focus-account",
      handleFocusAccount as EventListener,
    );

    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener(
        "ecoreport:focus-account",
        handleFocusAccount as EventListener,
      );
    };
  }, [accounts]);

  if (!selectedAccount) return null;

  const holdingsTone =
    selectedAccount.holdingsProfitLoss > 0
      ? "good"
      : selectedAccount.holdingsProfitLoss < 0
        ? "bad"
        : "default";

  return (
    <>
      <div className="space-y-4">
        {analysisDateLabel && (
          <div className="rounded-2xl border border-blue-500/18 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
            {analysisDateLabel}
          </div>
        )}

        <DesktopSelector
          accounts={accounts}
          selectedKey={selectedAccount.key}
          onSelect={setSelectedKey}
        />
        <MobileSelector
          accounts={accounts}
          selectedKey={selectedAccount.key}
          onSelect={setSelectedKey}
          onOpenDetail={setMobileSheetKey}
        />

        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[1.3fr,0.7fr] md:items-start">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-zinc-100">{selectedAccount.label}</h3>
                <span className={`rounded-full border px-2 py-1 text-[11px] ${getStatusClass(selectedAccount.status)}`}>
                  {selectedAccount.status}
                </span>
              </div>
              <p className="text-sm text-zinc-400">{selectedAccount.note}</p>

              {(selectedAccount.macroSummary || selectedAccount.actionLine) && (
                <div className="rounded-2xl border border-blue-500/18 bg-blue-500/10 px-3 py-3 md:px-4 md:py-4">
                  <p className="text-xs uppercase tracking-wide text-blue-300">
                    매크로 → 자산군 → 계좌 액션
                  </p>
                  {selectedAccount.macroSummary && (
                    <p className="mt-2 text-sm leading-6 text-zinc-100">
                      {selectedAccount.macroSummary}
                    </p>
                  )}
                  {selectedAccount.assetFocus.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedAccount.assetFocus.map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-indigo-500/25 bg-indigo-500/12 px-2.5 py-1 text-xs text-indigo-200"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                  {selectedAccount.actionLine && (
                    <p className="mt-3 text-sm font-medium leading-6 text-zinc-100">
                      {selectedAccount.actionLine}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="운용 점수" value={`${selectedAccount.score}점`} />
              <MetricCard
                label="리스크 패널티"
                value={
                  selectedAccount.riskPenaltyTotal != null
                    ? `-${selectedAccount.riskPenaltyTotal}점`
                    : "-"
                }
                tone={
                  selectedAccount.riskPenaltyTotal &&
                  selectedAccount.riskPenaltyTotal > 0
                    ? "bad"
                    : "default"
                }
              />
              <MetricCard
                label="이번 단계 투입"
                value={`${NUMBER_FORMATTER.format(selectedAccount.recommendedDeploy)}원`}
              />
              <MetricCard
                label="대기 자금"
                value={`${NUMBER_FORMATTER.format(selectedAccount.reserveCash)}원`}
              />
              <MetricCard
                label="보유 손익"
                value={formatSignedCurrency(selectedAccount.holdingsProfitLoss)}
                tone={holdingsTone}
              />
              <MetricCard
                label="보유 수익률"
                value={formatSignedPercent(selectedAccount.holdingsProfitRate)}
                tone={holdingsTone}
              />
            </div>
          </div>

          <CapitalOverviewCard
            totalAssets={selectedAccount.totalAssets}
            holdingsValue={selectedAccount.holdingsValue}
            recommendedDeploy={selectedAccount.recommendedDeploy}
            reserveCash={selectedAccount.reserveCash}
          />

          <RadarChartCard account={selectedAccount} />

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            <MetricCard label="배분 점수" value={`${selectedAccount.allocationScore}점`} />
            <MetricCard
              label="기술 점수"
              value={
                selectedAccount.technicalScore != null
                  ? `${selectedAccount.technicalScore}점`
                  : "-"
              }
            />
            <MetricCard
              label="리포트 점수"
              value={
                selectedAccount.reportStatus === "available" &&
                selectedAccount.reportScore != null
                  ? `${selectedAccount.reportScore}점`
                  : "미반영"
              }
            />
            <MetricCard
              label="리포트 커버리지"
              value={
                selectedAccount.reportStatus === "available" &&
                selectedAccount.reportCoverageScore != null
                  ? `${selectedAccount.reportCoverageScore}%`
                  : "미반영"
              }
            />
            <MetricCard
              label="레짐 적합도"
              value={
                selectedAccount.regimeFitScore != null
                  ? `${selectedAccount.regimeFitScore}점`
                  : "-"
              }
            />
            <MetricCard label="Stage 2 bias" value={selectedAccount.stage2Bias ?? "-"} />
          </div>

          {selectedAccount.reportStatus === "unavailable" && (
            <div className="rounded-2xl border border-amber-900/50 bg-amber-950/20 px-3 py-3 md:px-4 text-sm text-amber-200">
              {selectedAccount.reportUnavailableReason === "no_report_input"
                ? "이번 실행은 기준 거래일 리포트 입력이 0건이라 리포트 점수가 총점에 반영되지 않았습니다."
                : "직접 연결된 리포트 근거가 부족해 이번 계좌 점수는 배분/기술/패널티 중심으로 계산되었습니다."}
            </div>
          )}

          <HoldingScoreCard account={selectedAccount} />

          <ExecutionDetailBlock account={selectedAccount} />

          <div className="grid gap-4 xl:grid-cols-[0.95fr,1.05fr]">
            <div className="space-y-4">
              <InfoBlock title="왜 이 점수인가" items={selectedAccount.scoreDrivers} />
              <InfoBlock title="점수를 올리려면" items={selectedAccount.improvementActions} />
            </div>

            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <InfoBlock title="거시 근거" items={selectedAccount.macroDrivers} />
                <InfoBlock title="액션 포인트" items={selectedAccount.actionPoints} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <InfoBlock
                  title="기술 상위 신호"
                  items={
                    selectedAccount.topSignals.length > 0
                      ? selectedAccount.topSignals
                      : ["보유 종목 기술 신호 데이터가 아직 부족합니다."]
                  }
                />
                <InfoBlock
                  title="리포트 근거"
                  items={
                    selectedAccount.evidenceNotes.length > 0
                      ? selectedAccount.evidenceNotes
                      : ["직접 연결된 리포트 근거가 아직 부족합니다."]
                  }
                />
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.035] px-3 py-3 md:px-4 md:py-4">
                <h4 className="text-sm font-medium text-zinc-200">실행 체크리스트</h4>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div>
                    <p className="text-xs text-zinc-500">우선 후보</p>
                    <p className="mt-1 text-sm text-zinc-100">
                      {selectedAccount.candidates.length > 0
                        ? selectedAccount.candidates.join(", ")
                        : "현재는 신규 보강보다 유지 우선"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">현금 비중</p>
                    <p className="mt-1 text-sm text-zinc-100">
                      현재 {formatPercent(selectedAccount.cashPct * 100)} / 목표{" "}
                      {formatPercent(selectedAccount.targetCashPct * 100)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">데이터 커버리지</p>
                    <p className="mt-1 text-sm text-zinc-100">
                      기술{" "}
                      {selectedAccount.techCoverage != null
                        ? formatPercent(selectedAccount.techCoverage * 100)
                        : "-"}{" "}
                      / 리포트{" "}
                      {selectedAccount.impactCoverage != null
                        ? formatPercent(selectedAccount.impactCoverage * 100)
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">점수 반영 비중</p>
                    <p className="mt-1 text-sm text-zinc-100">
                      {selectedAccount.effectiveWeights
                        ? `배분 ${formatPercent((selectedAccount.effectiveWeights.allocation ?? 0) * 100)} / 팩터 ${formatPercent((selectedAccount.effectiveWeights.factor ?? 0) * 100)} / 기술 ${formatPercent((selectedAccount.effectiveWeights.tech ?? 0) * 100)} / 리포트 ${formatPercent((selectedAccount.effectiveWeights.report ?? 0) * 100)} / 레짐 ${formatPercent((selectedAccount.effectiveWeights.regime ?? 0) * 100)} / Stage2 ${formatPercent((selectedAccount.effectiveWeights.stage2 ?? 0) * 100)}`
                        : "-"}
                    </p>
                  </div>
                </div>
                <div className="mt-4 rounded-xl border border-white/8 bg-black/10 px-3 py-3 text-sm text-zinc-300">
                  오늘 1차 진입 후 1~2거래일 안에 눌림목 또는 방향 확인 시 2차, 이후 재평가합니다.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <AccountBottomSheet
        account={mobileSheetAccount}
        open={mobileSheetAccount != null}
        onClose={() => setMobileSheetKey(null)}
      />
    </>
  );
}
