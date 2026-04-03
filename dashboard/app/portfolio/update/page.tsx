import PortfolioEditor from "@/components/PortfolioEditor";
import {
  getDefaultPortfolioSnapshot,
  loadLatestPortfolio,
} from "@/lib/portfolio";

export default function PortfolioUpdatePage() {
  const snapshot = loadLatestPortfolio() ?? getDefaultPortfolioSnapshot();

  return (
    <main className="max-w-5xl mx-auto w-full px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">
          포트폴리오 업데이트
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          계좌 캡처를 참고해 숫자를 검토하고 저장하면
          <code className="mx-1 rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-300">
            data/portfolio/latest.json
          </code>
          이 갱신됩니다.
        </p>
      </div>

      <PortfolioEditor initialSnapshot={snapshot} />
    </main>
  );
}
