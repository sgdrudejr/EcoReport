#!/usr/bin/env node

import path from "node:path";

import {
  buildRunMetadata,
  parseDateArgs,
  readJson,
  writeJson,
} from "./lib/pipeline-utils.js";
import {
  buildEntityId,
  clamp,
  compactText,
  normalizedOutputPath,
  normalizeAccountKey,
} from "./lib/normalized-observations.js";

function graphOutputPath(date, rawPath = null) {
  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
  }
  return path.join(process.cwd(), "data", "evidence", date, "evidence-graph.json");
}

function entityCatalogOutputPath(date, rawPath = null) {
  if (rawPath) {
    return path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath);
  }
  return path.join(process.cwd(), "data", "evidence", date, "entity-catalog.json");
}

function addEntity(entityMap, entity) {
  if (!entity?.entityId || !entity?.entityType || !entity?.name) return;
  const existing = entityMap.get(entity.entityId);
  if (!existing) {
    entityMap.set(entity.entityId, {
      entityId: entity.entityId,
      entityType: entity.entityType,
      name: entity.name,
      aliases: entity.aliases ?? [],
      metadata: entity.metadata ?? {},
    });
    return;
  }
  existing.aliases = [...new Set([...(existing.aliases ?? []), ...(entity.aliases ?? [])])];
  existing.metadata = { ...(existing.metadata ?? {}), ...(entity.metadata ?? {}) };
}

function addEdge(edgeMap, edge) {
  if (!edge?.from || !edge?.to || !edge?.relation) return;
  const edgeId = edge.edgeId ?? [edge.from, edge.relation, edge.to].join("|");
  const existing = edgeMap.get(edgeId);
  if (!existing) {
    edgeMap.set(edgeId, {
      edgeId,
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      direction: edge.direction ?? null,
      weight: clamp(edge.weight ?? 0.5, 0, 1),
      confidence: clamp(edge.confidence ?? 0.5, 0, 1),
      sourceObservations: [...new Set(edge.sourceObservations ?? [])],
      qualityFlags: [...new Set(edge.qualityFlags ?? [])],
      metadata: edge.metadata ?? {},
    });
    return;
  }
  existing.weight = Math.max(existing.weight, clamp(edge.weight ?? 0.5, 0, 1));
  existing.confidence = Math.max(existing.confidence, clamp(edge.confidence ?? 0.5, 0, 1));
  existing.sourceObservations = [...new Set([...(existing.sourceObservations ?? []), ...(edge.sourceObservations ?? [])])];
  existing.qualityFlags = [...new Set([...(existing.qualityFlags ?? []), ...(edge.qualityFlags ?? [])])];
  existing.metadata = { ...(existing.metadata ?? {}), ...(edge.metadata ?? {}) };
}

function observationSourceEntityId(source) {
  return buildEntityId("strategy_rule", `source_${source}`);
}

function addSupportingContext({ entityMap, edgeMap, observation }) {
  addEntity(entityMap, {
    entityId: observation.entityId,
    entityType: observation.entityType,
    name: observation.entityName ?? observation.entityId,
  });

  const sourceEntityId = observationSourceEntityId(observation.metadata?.source ?? observation.metadata?.bundleSource ?? observation.bundleSource ?? "unknown");
  addEntity(entityMap, {
    entityId: sourceEntityId,
    entityType: "strategy_rule",
    name: compactText(observation.metadata?.source ?? observation.bundleSource ?? "source"),
  });
  addEdge(edgeMap, {
    from: sourceEntityId,
    to: observation.entityId,
    relation: "derived_from",
    direction: observation.direction ?? null,
    weight: observation.strength ?? 0.5,
    confidence: observation.confidence ?? 0.5,
    sourceObservations: [observation.observationId],
    qualityFlags: observation.qualityFlags ?? [],
  });

  for (const theme of observation.themes ?? []) {
    const themeEntityId = buildEntityId("theme", theme);
    addEntity(entityMap, {
      entityId: themeEntityId,
      entityType: "theme",
      name: theme,
    });
    addEdge(edgeMap, {
      from: observation.entityId,
      to: themeEntityId,
      relation: observation.entityType === "report" ? "supports" : "mentions",
      direction: observation.direction ?? null,
      weight: observation.strength ?? 0.5,
      confidence: observation.confidence ?? 0.5,
      sourceObservations: [observation.observationId],
      qualityFlags: observation.qualityFlags ?? [],
    });
  }

  if (observation.category) {
    const categoryEntityId = buildEntityId("category", observation.category);
    addEntity(entityMap, {
      entityId: categoryEntityId,
      entityType: "category",
      name: observation.category,
    });
    addEdge(edgeMap, {
      from: observation.entityId,
      to: categoryEntityId,
      relation: "mapped_to",
      direction: observation.direction ?? null,
      weight: observation.strength ?? 0.5,
      confidence: observation.confidence ?? 0.5,
      sourceObservations: [observation.observationId],
      qualityFlags: observation.qualityFlags ?? [],
    });
  }

  if (observation.accountKey) {
    const accountKey = normalizeAccountKey(observation.accountKey) ?? observation.accountKey;
    const accountEntityId = buildEntityId("account", accountKey);
    addEntity(entityMap, {
      entityId: accountEntityId,
      entityType: "account",
      name: accountKey,
      aliases: [observation.accountKey],
    });
    addEdge(edgeMap, {
      from: observation.entityId,
      to: accountEntityId,
      relation: observation.entityType === "security" ? "candidate_for" : "preferred_for",
      direction: observation.direction ?? null,
      weight: observation.strength ?? 0.5,
      confidence: observation.confidence ?? 0.5,
      sourceObservations: [observation.observationId],
      qualityFlags: observation.qualityFlags ?? [],
    });
  }

  const reportEntityId = observation.metadata?.reportId
    ? buildEntityId("report", observation.metadata.reportId)
    : null;
  if (reportEntityId && reportEntityId !== observation.entityId) {
    addEntity(entityMap, {
      entityId: reportEntityId,
      entityType: "report",
      name: observation.metadata?.reportTitle ?? observation.metadata.reportId,
    });
    addEdge(edgeMap, {
      from: reportEntityId,
      to: observation.entityId,
      relation: "supports",
      direction: observation.direction ?? null,
      weight: observation.strength ?? 0.5,
      confidence: observation.confidence ?? 0.5,
      sourceObservations: [observation.observationId],
      qualityFlags: observation.qualityFlags ?? [],
    });
  }

  const topicEntityId = observation.metadata?.topicEntityId ?? null;
  if (topicEntityId && topicEntityId !== observation.entityId) {
    addEntity(entityMap, {
      entityId: topicEntityId,
      entityType: "macro_event",
      name: observation.metadata?.topicTitle ?? topicEntityId,
    });
    addEdge(edgeMap, {
      from: topicEntityId,
      to: observation.entityId,
      relation: "raises_risk_for",
      direction: observation.direction ?? null,
      weight: observation.strength ?? 0.5,
      confidence: observation.confidence ?? 0.5,
      sourceObservations: [observation.observationId],
      qualityFlags: observation.qualityFlags ?? [],
    });
  }
}

async function main() {
  const args = parseDateArgs(process.argv.slice(2));
  const metadata = buildRunMetadata(args);
  const outputs = [
    normalizedOutputPath(args.date, "reports"),
    normalizedOutputPath(args.date, "stockeasy"),
    normalizedOutputPath(args.date, "marketvoice"),
  ];
  const bundles = (await Promise.all(outputs.map((file) => readJson(file, null)))).filter(Boolean);
  if (bundles.length === 0) {
    throw new Error(`normalized bundles가 없습니다: ${outputs.join(", ")}`);
  }

  const entityMap = new Map();
  const edgeMap = new Map();

  for (const bundle of bundles) {
    const sourceEntityId = observationSourceEntityId(bundle.source);
    addEntity(entityMap, {
      entityId: sourceEntityId,
      entityType: "strategy_rule",
      name: bundle.source,
    });

    for (const observation of bundle.observations ?? []) {
      addSupportingContext({
        entityMap,
        edgeMap,
        observation: {
          ...observation,
          bundleSource: bundle.source,
          metadata: {
            ...(observation.metadata ?? {}),
            source: bundle.source,
          },
        },
      });
    }
  }

  const graph = {
    date: args.date,
    graphId: `evidence-graph:${args.date}`,
    generatedAt: metadata.generatedAt,
    entities: [...entityMap.values()].sort((a, b) => a.entityId.localeCompare(b.entityId)),
    edges: [...edgeMap.values()].sort((a, b) => a.edgeId.localeCompare(b.edgeId)),
  };

  await writeJson(graphOutputPath(args.date, args.output), graph);
  await writeJson(entityCatalogOutputPath(args.date), {
    date: args.date,
    generatedAt: metadata.generatedAt,
    entityCount: graph.entities.length,
    entities: graph.entities,
  });

  console.log(`Wrote evidence graph with ${graph.entities.length} entities and ${graph.edges.length} edges`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
