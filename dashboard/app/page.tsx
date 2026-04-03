import fs from "fs";
import path from "path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import TriggerButton from "@/components/TriggerButton";

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

// ── 메인 페이지 ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const briefing = loadLatestBriefing();
  const market = loadLatestMarket();
  const strategy = loadStrategy();

  const indices = market?.indices ?? {};
  const hasMarket = Object.keys(indices).length > 0;

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

      {/* 분할매수 진행률 */}
      {strategy && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
            포트폴리오
          </h2>
          <StrategyProgress strategy={strategy} />
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
