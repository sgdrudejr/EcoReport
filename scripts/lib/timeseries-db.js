import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { ROOT_DIR } from "./pipeline-utils.js";

export const TIMESERIES_DB_PATH = path.join(ROOT_DIR, "data", "timeseries.db");

function ensureDatabasePath() {
  fs.mkdirSync(path.dirname(TIMESERIES_DB_PATH), { recursive: true });
}

function serializeJson(value) {
  return value == null ? null : JSON.stringify(value);
}

function openDatabase() {
  ensureDatabasePath();
  const db = new Database(TIMESERIES_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stage3_positions (
      date TEXT NOT NULL,
      run_date TEXT,
      effective_market_date TEXT,
      generated_at TEXT,
      position_key TEXT NOT NULL,
      account_key TEXT,
      account_label TEXT,
      code TEXT,
      name TEXT,
      category TEXT,
      market_value REAL,
      action_score INTEGER,
      signal TEXT,
      alpha_score INTEGER,
      execution_confidence INTEGER,
      tax_advantage REAL,
      cluster_penalty REAL,
      score_decomposition_json TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (date, position_key)
    );

    CREATE TABLE IF NOT EXISTS stage4_plans (
      date TEXT NOT NULL,
      run_date TEXT,
      effective_market_date TEXT,
      generated_at TEXT,
      account_key TEXT NOT NULL,
      account_label TEXT,
      total_score INTEGER,
      stage2_bias TEXT,
      deploy_budget REAL,
      reserve_cash REAL,
      buys_count INTEGER,
      trims_count INTEGER,
      holds_count INTEGER,
      watches_count INTEGER,
      confidence REAL,
      critic_review_json TEXT,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (date, account_key)
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      date TEXT NOT NULL PRIMARY KEY,
      run_date TEXT,
      effective_market_date TEXT,
      regime_name TEXT,
      stage3_portfolio_score INTEGER,
      stage4_portfolio_score INTEGER,
      account_count INTEGER,
      position_count INTEGER,
      plan_count INTEGER,
      stage3_generated_at TEXT,
      stage4_generated_at TEXT,
      stage3_payload_json TEXT,
      stage4_payload_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);
}

export function insertStage3(payload) {
  const db = openDatabase();

  try {
    const replacePosition = db.prepare(`
      INSERT OR REPLACE INTO stage3_positions (
        date, run_date, effective_market_date, generated_at, position_key,
        account_key, account_label, code, name, category, market_value,
        action_score, signal, alpha_score, execution_confidence, tax_advantage,
        cluster_penalty, score_decomposition_json, payload_json
      ) VALUES (
        @date, @run_date, @effective_market_date, @generated_at, @position_key,
        @account_key, @account_label, @code, @name, @category, @market_value,
        @action_score, @signal, @alpha_score, @execution_confidence, @tax_advantage,
        @cluster_penalty, @score_decomposition_json, @payload_json
      )
    `);
    const deletePositions = db.prepare(`DELETE FROM stage3_positions WHERE date = ?`);
    const existingSnapshot = db.prepare(`SELECT * FROM portfolio_snapshots WHERE date = ?`);
    const replaceSnapshot = db.prepare(`
      INSERT OR REPLACE INTO portfolio_snapshots (
        date, run_date, effective_market_date, regime_name,
        stage3_portfolio_score, stage4_portfolio_score,
        account_count, position_count, plan_count,
        stage3_generated_at, stage4_generated_at,
        stage3_payload_json, stage4_payload_json, updated_at
      ) VALUES (
        @date, @run_date, @effective_market_date, @regime_name,
        @stage3_portfolio_score, @stage4_portfolio_score,
        @account_count, @position_count, @plan_count,
        @stage3_generated_at, @stage4_generated_at,
        @stage3_payload_json, @stage4_payload_json, @updated_at
      )
    `);

    const transaction = db.transaction(() => {
      deletePositions.run(payload.date);

      for (const [positionKey, position] of Object.entries(payload.positions ?? {})) {
        replacePosition.run({
          date: payload.date,
          run_date: payload.runDate ?? null,
          effective_market_date: payload.effectiveMarketDate ?? null,
          generated_at: payload.generatedAt ?? null,
          position_key: positionKey,
          account_key: position.accountKey ?? null,
          account_label: position.accountLabel ?? null,
          code: position.code ?? null,
          name: position.name ?? null,
          category: position.category ?? null,
          market_value: position.marketValue ?? null,
          action_score: position.actionScore ?? null,
          signal: position.signal ?? null,
          alpha_score: position.scoreDecomposition?.alphaScore ?? null,
          execution_confidence: position.scoreDecomposition?.executionConfidence ?? null,
          tax_advantage: position.scoreDecomposition?.taxAdvantage ?? null,
          cluster_penalty: position.scoreDecomposition?.clusterPenalty ?? null,
          score_decomposition_json: serializeJson(position.scoreDecomposition),
          payload_json: serializeJson(position),
        });
      }

      const existing = existingSnapshot.get(payload.date);
      replaceSnapshot.run({
        date: payload.date,
        run_date: payload.runDate ?? existing?.run_date ?? null,
        effective_market_date: payload.effectiveMarketDate ?? existing?.effective_market_date ?? null,
        regime_name: payload.regime?.name ?? existing?.regime_name ?? null,
        stage3_portfolio_score: payload.portfolio?.totalScore ?? existing?.stage3_portfolio_score ?? null,
        stage4_portfolio_score: existing?.stage4_portfolio_score ?? null,
        account_count: Object.keys(payload.accounts ?? {}).length,
        position_count: Object.keys(payload.positions ?? {}).length,
        plan_count: existing?.plan_count ?? null,
        stage3_generated_at: payload.generatedAt ?? null,
        stage4_generated_at: existing?.stage4_generated_at ?? null,
        stage3_payload_json: serializeJson(payload),
        stage4_payload_json: existing?.stage4_payload_json ?? null,
        updated_at: new Date().toISOString(),
      });
    });

    transaction();
  } finally {
    db.close();
  }

  return TIMESERIES_DB_PATH;
}

export function insertStage4(payload) {
  const db = openDatabase();

  try {
    const replacePlan = db.prepare(`
      INSERT OR REPLACE INTO stage4_plans (
        date, run_date, effective_market_date, generated_at, account_key,
        account_label, total_score, stage2_bias, deploy_budget, reserve_cash,
        buys_count, trims_count, holds_count, watches_count, confidence,
        critic_review_json, payload_json
      ) VALUES (
        @date, @run_date, @effective_market_date, @generated_at, @account_key,
        @account_label, @total_score, @stage2_bias, @deploy_budget, @reserve_cash,
        @buys_count, @trims_count, @holds_count, @watches_count, @confidence,
        @critic_review_json, @payload_json
      )
    `);
    const deletePlans = db.prepare(`DELETE FROM stage4_plans WHERE date = ?`);
    const existingSnapshot = db.prepare(`SELECT * FROM portfolio_snapshots WHERE date = ?`);
    const replaceSnapshot = db.prepare(`
      INSERT OR REPLACE INTO portfolio_snapshots (
        date, run_date, effective_market_date, regime_name,
        stage3_portfolio_score, stage4_portfolio_score,
        account_count, position_count, plan_count,
        stage3_generated_at, stage4_generated_at,
        stage3_payload_json, stage4_payload_json, updated_at
      ) VALUES (
        @date, @run_date, @effective_market_date, @regime_name,
        @stage3_portfolio_score, @stage4_portfolio_score,
        @account_count, @position_count, @plan_count,
        @stage3_generated_at, @stage4_generated_at,
        @stage3_payload_json, @stage4_payload_json, @updated_at
      )
    `);

    const transaction = db.transaction(() => {
      deletePlans.run(payload.date);

      for (const plan of payload.accountPlans ?? []) {
        replacePlan.run({
          date: payload.date,
          run_date: payload.runDate ?? null,
          effective_market_date: payload.effectiveMarketDate ?? null,
          generated_at: payload.generatedAt ?? null,
          account_key: plan.key ?? null,
          account_label: plan.label ?? null,
          total_score: plan.totalScore ?? null,
          stage2_bias: plan.stage2Bias ?? null,
          deploy_budget: plan.deployBudget ?? null,
          reserve_cash: plan.reserveCash ?? null,
          buys_count: (plan.stagedBuys ?? []).length,
          trims_count: (plan.trims ?? []).length,
          holds_count: (plan.holds ?? []).length,
          watches_count: (plan.watches ?? []).length,
          confidence: plan.confidence ?? null,
          critic_review_json: serializeJson(plan.criticReview ?? null),
          payload_json: serializeJson(plan),
        });
      }

      const existing = existingSnapshot.get(payload.date);
      replaceSnapshot.run({
        date: payload.date,
        run_date: payload.runDate ?? existing?.run_date ?? null,
        effective_market_date: payload.effectiveMarketDate ?? existing?.effective_market_date ?? null,
        regime_name: payload.regime?.name ?? existing?.regime_name ?? null,
        stage3_portfolio_score: existing?.stage3_portfolio_score ?? null,
        stage4_portfolio_score: payload.portfolioScore ?? null,
        account_count: existing?.account_count ?? (payload.accountPlans ?? []).length,
        position_count: existing?.position_count ?? null,
        plan_count: (payload.accountPlans ?? []).length,
        stage3_generated_at: existing?.stage3_generated_at ?? null,
        stage4_generated_at: payload.generatedAt ?? null,
        stage3_payload_json: existing?.stage3_payload_json ?? null,
        stage4_payload_json: serializeJson(payload),
        updated_at: new Date().toISOString(),
      });
    });

    transaction();
  } finally {
    db.close();
  }

  return TIMESERIES_DB_PATH;
}
