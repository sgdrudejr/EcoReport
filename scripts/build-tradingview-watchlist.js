#!/usr/bin/env node

import { parseDateArgs } from "./lib/pipeline-utils.js";
import { buildTradingViewWatchlistArtifacts } from "./lib/tradingview-watchlist.js";

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const result = await buildTradingViewWatchlistArtifacts({ date: args.date });
  console.log(
    `Built TradingView watchlist (${result.symbolCount} full, ${result.basicSymbolCount} basic): ${result.latestTxtPath}`,
  );
  console.log(`Built TradingView Basic watchlist: ${result.latestBasicTxtPath}`);
  console.log(
    `Built TradingView avg-price/buy-marker Pine script (${result.averagePriceSymbolCount} holdings, ${result.buyMarkerEventCount} buy markers): ${result.latestAvgPricePinePath}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
