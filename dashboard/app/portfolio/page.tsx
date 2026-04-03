import Link from "next/link";
import { loadLatestPortfolio } from "@/lib/portfolio";

export default function PortfolioPage() {
  const snapshot = loadLatestPortfolio();

  return (
    <main className="max-w-4xl mx-auto w-full px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">포트폴리오</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {snapshot
              ? `${snapshot.date} 기준 · ${snapshot.updatedAt}`
              : "아직 저장된 포트폴리오 스냅샷이 없습니다."}
          </p>
        </div>
        <Link
          href="/portfolio/update"
          className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          포트폴리오 업데이트
        </Link>
      </div>

      {!snapshot ? (
        <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800 text-sm text-zinc-500">
          아직 저장된 데이터가 없습니다. 먼저 포트폴리오 업데이트 페이지에서
          계좌 캡처를 검토하고 저장하세요.
        </div>
      ) : (
        <div className="space-y-4">
          {snapshot.accounts.map((account) => (
            <section
              key={account.key}
              className="bg-zinc-900 rounded-xl border border-zinc-800 p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">
                    {account.label}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-1">
                    {account.accountNumber || "계좌번호 미입력"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-zinc-500">총 평가금액</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {(account.evaluationAmount ?? 0).toLocaleString()}원
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    예수금 {(account.cashAvailable ?? 0).toLocaleString()}원
                  </p>
                </div>
              </div>

              {account.incomplete && (
                <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
                  이 계좌는 부분 캡처 기준이라 일부 종목이 누락되었을 수 있습니다.
                </div>
              )}

              {account.holdings.length === 0 ? (
                <div className="text-sm text-zinc-500">
                  입력된 보유 종목이 없습니다.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-zinc-500 border-b border-zinc-800">
                      <tr>
                        <th className="text-left py-2 pr-4">종목</th>
                        <th className="text-right py-2 pr-4">수량</th>
                        <th className="text-right py-2 pr-4">평균단가</th>
                        <th className="text-right py-2 pr-4">현재가</th>
                        <th className="text-right py-2 pr-4">평가금액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {account.holdings.map((holding, index) => (
                        <tr key={`${account.key}-${holding.name}-${index}`} className="border-b border-zinc-900">
                          <td className="py-3 pr-4">
                            <div className="text-zinc-100 font-medium">
                              {holding.name}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {holding.code || "-"}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {holding.quantity ?? "-"}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {holding.avgPrice != null
                              ? `${holding.avgPrice.toLocaleString()}`
                              : "-"}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {holding.currentPrice != null
                              ? `${holding.currentPrice.toLocaleString()}`
                              : "-"}
                          </td>
                          <td className="py-3 pr-4 text-right tabular-nums">
                            {holding.marketValue != null
                              ? `${holding.marketValue.toLocaleString()}원`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
