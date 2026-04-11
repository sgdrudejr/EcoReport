#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  ROOT_DIR,
  buildRunMetadata,
  enrichPortfolioWithSecurityCodes,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";

const CORRELATION_THRESHOLD = 0.7;

function pythonBin() {
  const venvPython = path.join(ROOT_DIR, ".venv", "bin", "python");
  return path.resolve(venvPython);
}

function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  const mx = xs.reduce((sum, value) => sum + value, 0) / n;
  const my = ys.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let dx2 = 0;
  let dy2 = 0;

  for (let index = 0; index < n; index += 1) {
    const dx = xs[index] - mx;
    const dy = ys[index] - my;
    numerator += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }

  const denominator = Math.sqrt(dx2 * dy2);
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}

function alignedReturns(leftSeries, rightSeries) {
  const rightByDate = new Map((rightSeries ?? []).map((item) => [item.date, item.return]));
  const left = [];
  const right = [];

  for (const item of leftSeries ?? []) {
    if (!rightByDate.has(item.date)) continue;
    left.push(item.return);
    right.push(rightByDate.get(item.date));
  }

  return { left, right };
}

class UnionFind {
  constructor(size) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(index) {
    if (this.parent[index] !== index) {
      this.parent[index] = this.find(this.parent[index]);
    }
    return this.parent[index];
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parent[rightRoot] = leftRoot;
    }
  }
}

function clusterWarning(holdings, avgCorrelation) {
  if (holdings.length >= 3) {
    return `⚠ 같은 클러스터에 ${holdings.length}종목 이상 집중`;
  }
  if (holdings.length >= 2 && avgCorrelation >= 0.85) {
    return `${holdings.length}개 계좌에 걸쳐 실질 동일 포지션`;
  }
  return `${holdings.length}개 종목이 높은 상관관계로 묶임`;
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const portfolio = await readJson(path.join(ROOT_DIR, "data", "portfolio", "latest.json"), {
    accounts: [],
  });
  const normalizedPortfolio = enrichPortfolioWithSecurityCodes(portfolio);
  const holdings = (normalizedPortfolio.accounts ?? []).flatMap((account) =>
    (account.holdings ?? [])
      .filter((holding) => holding.code)
      .map((holding) => ({
        code: holding.code,
        name: holding.name,
        accountKey: account.key,
        accountLabel: account.label,
      })),
  );

  const uniqueCodes = [...new Set(holdings.map((holding) => holding.code))];
  const raw = execFileSync(
    pythonBin(),
    [path.join(ROOT_DIR, "scripts", "fetch-historical-returns.py")],
    {
      input: JSON.stringify(uniqueCodes.map((code) => ({ code }))),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  const seriesByCode = new Map(
    JSON.parse(raw).map((item) => [item.code, item.series ?? []]),
  );

  const unionFind = new UnionFind(holdings.length);
  const edges = [];

  for (let leftIndex = 0; leftIndex < holdings.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < holdings.length; rightIndex += 1) {
      const leftHolding = holdings[leftIndex];
      const rightHolding = holdings[rightIndex];
      const aligned = alignedReturns(
        seriesByCode.get(leftHolding.code) ?? [],
        seriesByCode.get(rightHolding.code) ?? [],
      );
      const correlation = pearson(aligned.left, aligned.right);
      if (correlation == null || correlation <= CORRELATION_THRESHOLD) continue;

      unionFind.union(leftIndex, rightIndex);
      edges.push({
        leftIndex,
        rightIndex,
        correlation,
      });
    }
  }

  const groups = new Map();
  holdings.forEach((holding, index) => {
    const root = unionFind.find(index);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root).push({ ...holding, index });
  });

  const clusters = [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group, clusterIndex) => {
      const memberIndexes = new Set(group.map((item) => item.index));
      const clusterEdges = edges.filter(
        (edge) => memberIndexes.has(edge.leftIndex) && memberIndexes.has(edge.rightIndex),
      );
      const avgCorrelation =
        clusterEdges.length > 0
          ? Number(
              (
                clusterEdges.reduce((sum, edge) => sum + edge.correlation, 0) /
                clusterEdges.length
              ).toFixed(4),
            )
          : 1;

      const cleanedHoldings = group.map(({ index, ...holding }) => holding);
      return {
        id: clusterIndex + 1,
        holdings: cleanedHoldings,
        avgCorrelation,
        warning: clusterWarning(cleanedHoldings, avgCorrelation),
      };
    });

  const outputPath =
    args.output ??
    path.join(ROOT_DIR, "data", "analysis-state", args.date, "holding-clusters.json");

  await writeJson(outputPath, {
    ...buildRunMetadata(args),
    threshold: CORRELATION_THRESHOLD,
    clusters,
  });
  console.log(outputPath);
}

main().catch((error) => {
  console.error(`holding clusters 생성 실패: ${error.message}`);
  process.exit(1);
});
