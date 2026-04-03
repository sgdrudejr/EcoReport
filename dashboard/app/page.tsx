import fs from "fs";
import path from "path";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import TriggerButton from "@/components/TriggerButton";
import {
  buildPortfolioGuide,
  type AccountGuide,
} from "@/lib/portfolio-guidance";
import {
  getAccountHoldingCount,
  getAccountHoldingsProfitLoss,
  getPortfolioTotals,
  loadLatestPortfolio,
  type PortfolioAccount,
} from "@/lib/portfolio";

const REPO_ROOT = path.resolve(process.cwd(), "..");

// ── 데이터 로더 ────────────────────────────────────────────────────────

function loadLatestBriefing(): { date: string; content: string } | null {
  const dir = path.join(REPO_ROOT, "reports", "daily");
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith("-briefing.md"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const file = files[0];
  const date = file.slice(0, 10);
  const content = fs.readFileSync(path.join(dir, file), "utf-8");
  return { date, content };
}

interface MarketIndex {
  close: number;
  change_pct: number;
}
interface MarketData {
  date: string;
  indices?: Record<string, MarketIndex>;
}

function loadLatestMarket(): MarketData | null {
  const dir = path.join(REPO_ROOT, "data", "market");
  if (!fs.existsSync(dir)) return null;

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    return JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf-8"));
  } catch {
    return null;
  }
}

interface Tranche {
  filled: boolean;
}
interface Strategy {
  name?: string;
  target_price?: number;
  current_price?: number;
  tranches?: Tranche[];
}

function loadStrategy(): Strategy | null {
  const file = path.join(REPO_ROOT, "config", "strategy.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────

function MarketCard({
  label,
  close,
  changePct,
}: {
  label: string;
  close: number;
  changePct: number;
}) {
  const positive = changePct > 0;
  const neutral = changePct === 0;
  const Icon = neutral ? Minus : positive ? TrendingUp : TrendingDown;
  const color = neutral
    ? "text-zinc-400"
    : positive
    ? "text-emerald-400"
    : "text-red-400";

  return (
    <div className="bg-zinc-900 rounded-xl p-4 flex flex-col gap-1 border border-zinc-800">
      <span className="text-xs text-zinc-500 uppercase tracking-wide">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {close.toLocaleString()}
      </span>
      <span className={`flex items-center gap-1 text-sm font-medium ${color}`}>
        <Icon size={14} />
        {changePct > 0 ? "+" : ""}
        {changePct.toFixed(2)}%
      </span>
    </div>
  );
}

function StrategyProgress({ strategy }: { strategy: Strategy }) {
  const tranches = strategy.tranches ?? [];
  const total = tranches.length;
  const filled = tranches.filter((t) => t.filled).length;
  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-zinc-300">
          {strategy.name ?? "분할매수"} 진행률
        </span>
        <span className="text-sm tabular-nums text-zinc-400">
          {filled}/{total} 트랜치
        </span>
      </div>
      <div className="w-full bg-zinc-800 rounded-full h-2.5">
        <div
          className="bg-emerald-500 h-2.5 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-zinc-500">
        <span>0%</span>
        <span className="text-emerald-400 font-medium">{pct}%</span>
        <span>100%</span>
      </div>
      {strategy.target_price && strategy.current_price && (
        <div className="mt-2 text-xs text-zinc-500 flex gap-4">
          <span>목표가 {strategy.target_price.toLocaleString()}원</span>
          <span>현재가 {strategy.current_price.toLocaleString()}원</span>
        </div>
      )}
    </div>
  );
}

function PortfolioAccountCard({ account }: { account: PortfolioAccount }) {
  const profitPositive = (account.profitLoss ?? 0) > 0;
  const profitNegative = (account.profitLoss ?? 0) < 0;
  const profitClass = profitPositive
    ? "text-emerald-400"
    : profitNegative
      ? "text-red-400"
      : "text-zinc-400";

  const holdingsProfitLoss = getAccountHoldingsProfitLoss(account);
  const holdingsProfitClass =
    holdingsProfitLoss > 0
      ? "text-emerald-400"
      : holdingsProfitLoss < 0
        ? "text-red-400"
        : "text-zinc-400";

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">{account.label}</p>
          <p className="text-xs text-zinc-500 mt-1">
            {account.accountNumber || "계좌번호 미입력"}
          </p>
        </div>
        {account.incomplete && (
          <span className="rounded-full bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300 border border-amber-900/60">
            부분 캡처
          </span>
        )}
      </div>

      <div>
        <p className="text-xs text-zinc-500">총 평가금액</p>
        <p className="text-xl font-semibold tabular-nums">
          {(account.evaluationAmount ?? 0).toLocaleString()}원
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-zinc-500">예수금</p>
          <p className="tabular-nums text-zinc-200">
            {(account.cashAvailable ?? 0).toLocaleString()}원
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-500">손익</p>
          <p className={`tabular-nums ${profitClass}`}>
            {(account.profitLoss ?? 0) > 0 ? "+" : ""}
            {(account.profitLoss ?? 0).toLocaleString()}원
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500 pt-1">
        <span>보유 종목 {getAccountHoldingCount(account)}개</span>
        <span>
          수익률{" "}
          <span className={profitClass}>
            {account.profitRate != null
              ? `${account.profitRate > 0 ? "+" : ""}${account.profitRate.toFixed(2)}%`
              : "-"}
          </span>
        </span>
      </div>

      {account.holdings.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>보유 종목 합산 손익</span>
            <span className={`font-medium ${holdingsProfitClass}`}>
              {holdingsProfitLoss > 0 ? "+" : ""}
              {holdingsProfitLoss.toLocaleString()}원
            </span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {account.holdings.map((holding) => (
              <span
                key={`${account.key}-${holding.code ?? holding.name}`}
                className="rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-300"
              >
                {holding.name}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function categoryBarWidth(value: number) {
  return `${Math.max(0, Math.min(100, value * 100))}%`;
}

function GuidanceScoreCard({
  score,
  label,
}: {
  score: number;
  label: string;
}) {
  const color =
    score >= 75 ? "text-emerald-400" : score >= 55 ? "text-amber-300" : "text-red-400";

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>
        {score}점
      </p>
    </div>
  );
}

function GuidanceAccountCard({
  account,
}: {
  account: AccountGuide;
}) {
  const statusClass =
    account.status === "양호"
      ? "bg-emerald-950/40 text-emerald-300 border-emerald-900/50"
      : account.status === "보강 필요"
        ? "bg-amber-950/40 text-amber-300 border-amber-900/50"
        : "bg-red-950/40 text-red-300 border-red-900/50";

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-100">{account.label}</h3>
            <span className={`rounded-full border px-2 py-1 text-[11px] ${statusClass}`}>
              {account.status}
            </span>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{account.note}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-zinc-500">운용 점수</p>
          <p className="text-2xl font-semibold tabular-nums text-zinc-100">{account.score}점</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
          <p className="text-xs text-zinc-500">이번 단계 투입</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
            {account.recommendedDeploy.toLocaleString()}원
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
          <p className="text-xs text-zinc-500">대기 자금</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
            {account.reserveCash.toLocaleString()}원
          </p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
          <p className="text-xs text-zinc-500">보유 종목 손익</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              account.holdingsProfitLoss > 0
                ? "text-emerald-400"
                : account.holdingsProfitLoss < 0
                  ? "text-red-400"
                  : "text-zinc-100"
            }`}
          >
            {account.holdingsProfitLoss > 0 ? "+" : ""}
            {account.holdingsProfitLoss.toLocaleString()}원
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-zinc-200">현재 배분 vs 목표</h4>
          {account.categories.map((category) => (
            <div key={`${account.key}-${category.category}`} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-200">{category.category}</span>
                <span
                  className={
                    category.action === "보강 필요"
                      ? "text-amber-300"
                      : category.action === "비중 축소"
                        ? "text-red-300"
                        : "text-zinc-400"
                  }
                >
                  {category.action}
                </span>
              </div>
              <div className="rounded-full bg-zinc-800 h-2 overflow-hidden">
                <div
                  className="bg-zinc-500/80 h-2"
                  style={{ width: categoryBarWidth(category.currentPct) }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>현재 {(category.currentPct * 100).toFixed(1)}%</span>
                <span>목표 {(category.targetPct * 100).toFixed(1)}%</span>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-medium text-zinc-200">실행 가이드</h4>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
            <div>
              <p className="text-xs text-zinc-500">우선 후보</p>
              <p className="mt-1 text-sm text-zinc-100">
                {account.candidates.length > 0
                  ? account.candidates.join(", ")
                  : "현재는 신규 보강보다 유지 우선"}
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">현금 비중</p>
              <p className="mt-1 text-sm text-zinc-100">
                현재 {(account.cashPct * 100).toFixed(1)}% / 목표{" "}
                {(account.targetCashPct * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-zinc-500">실행 리듬</p>
              <p className="mt-1 text-sm text-zinc-100">
                오늘 1차 진입 후 1~2거래일 안에 눌림목 또는 방향 확인 시 2차, 이후 재평가합니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const briefing = loadLatestBriefing();
  const market = loadLatestMarket();
  const strategy = loadStrategy();
  const portfolio = loadLatestPortfolio();
  const portfolioGuide = portfolio ? buildPortfolioGuide(portfolio) : null;

  const indices = market?.indices ?? {};
  const hasMarket = Object.keys(indices).length > 0;
  const totals = portfolio ? getPortfolioTotals(portfolio) : null;

  return (
    <main className="max-w-4xl mx-auto w-full px-4 py-8 space-y-8">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">EcoReport</h1>
          {briefing && (
            <p className="text-sm text-zinc-500 mt-0.5">{briefing.date}</p>
          )}
        </div>
        <TriggerButton />
      </div>

      {/* 시장 지표 카드 */}
      {hasMarket && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            시장 지표
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Object.entries(indices).map(([key, val]) => (
              <MarketCard
                key={key}
                label={key}
                close={val.close}
                changePct={val.change_pct}
              />
            ))}
          </div>
        </section>
      )}

      {/* 포트폴리오 */}
      {(portfolio || strategy) && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            포트폴리오
          </h2>
          <div className="space-y-4">
            {portfolio ? (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-zinc-400">
                      최신 스냅샷 기준 총 평가금액
                    </p>
                    <p className="text-2xl font-semibold tabular-nums text-zinc-100">
                      {(totals?.totalEvaluationAmount ?? 0).toLocaleString()}원
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">
                      보유 종목 {totals?.totalHoldingCount ?? 0}개 · 합산 손익{" "}
                      <span
                        className={
                          (totals?.totalHoldingsProfitLoss ?? 0) > 0
                            ? "text-emerald-400"
                            : (totals?.totalHoldingsProfitLoss ?? 0) < 0
                              ? "text-red-400"
                              : "text-zinc-400"
                        }
                      >
                        {(totals?.totalHoldingsProfitLoss ?? 0) > 0 ? "+" : ""}
                        {(totals?.totalHoldingsProfitLoss ?? 0).toLocaleString()}원
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href="/portfolio"
                      className="inline-flex items-center rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:border-zinc-500"
                    >
                      상세 보기
                    </Link>
                    <Link
                      href="/portfolio/update"
                      className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                    >
                      캡처 업데이트
                    </Link>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {portfolio.accounts.map((account) => (
                    <PortfolioAccountCard
                      key={account.key}
                      account={account}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 text-sm text-zinc-400 flex items-center justify-between gap-4">
                <p>아직 저장된 포트폴리오 스냅샷이 없습니다.</p>
                <Link
                  href="/portfolio/update"
                  className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                >
                  첫 스냅샷 만들기
                </Link>
              </div>
            )}

            {strategy && <StrategyProgress strategy={strategy} />}
          </div>
        </section>
      )}

      {portfolioGuide && (
        <section>
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
                운용 가이드
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                점수보다 중요한 건 지금 어떤 계좌에서 무엇을 보강할지입니다.
                아래 가이드는 현재 스냅샷과 목표 배분 기준입니다.
              </p>
            </div>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mb-4">
            <GuidanceScoreCard
              score={portfolioGuide.score}
              label="포트폴리오 운용 점수"
            />
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">총 현금 비중</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
                {(portfolioGuide.totalCashPct * 100).toFixed(1)}%
              </p>
            </div>
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
              <p className="text-xs text-zinc-500">이번 단계 기준</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums text-zinc-100">
                {(portfolioGuide.nextTranchePct * 100).toFixed(0)}%
              </p>
              <p className="mt-1 text-xs text-zinc-500">다음 분할매수 비중</p>
            </div>
          </div>

          {portfolioGuide.incompleteCount > 0 && (
            <div className="mb-4 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
              부분 캡처 계좌가 {portfolioGuide.incompleteCount}개 있어 일부 가이드는
              참고용입니다. 누락 종목을 채우면 정밀도가 올라갑니다.
            </div>
          )}

          <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-sm font-medium text-zinc-100">오늘의 우선 지침</p>
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">
              {portfolioGuide.globalActions.length > 0 ? (
                portfolioGuide.globalActions.map((action) => (
                  <li key={action}>- {action}</li>
                ))
              ) : (
                <li>- 현재는 급한 보강보다 기존 비중 유지가 우선입니다.</li>
              )}
            </ul>
          </div>

          <div className="space-y-4">
            {portfolioGuide.accounts.map((account) => (
              <GuidanceAccountCard key={account.key} account={account} />
            ))}
          </div>
        </section>
      )}

      {/* 어드바이저 브리핑 */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
          어드바이저 브리핑
        </h2>
        {briefing ? (
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {briefing.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 text-zinc-500 text-sm">
            아직 브리핑이 없습니다. 분석을 실행하면 여기에 표시됩니다.
          </div>
        )}
      </section>
    </main>
  );
}
