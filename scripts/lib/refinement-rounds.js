import path from "node:path";

import { ROOT_DIR, parseDateArgs } from "./pipeline-utils.js";

export const REFINEMENT_ROUND_SPECS = {
  2: {
    round: 2,
    stageKey: "stage1.7",
    label: "2차 재인덱싱",
    purpose: "1차 딥리서치 이후 남은 빈틈을 메우는 정밀 follow-up",
    topicLimit: 10,
    mapJsonName: "stage1-followup-research-map.json",
    mapMarkdownName: "11-stage1-7-followup-research-map.md",
    promptName: "12-stage1-7-gemini-follow-up-prompt.md",
    responseName: "13-stage1-7-gemini-follow-up-response.md",
  },
  3: {
    round: 3,
    stageKey: "stage1.8",
    label: "3차 세부화",
    purpose: "전략과 위키 메모리 반영 뒤 남은 실행 디테일을 최종 정제",
    topicLimit: 6,
    mapJsonName: "stage1-final-refinement-map.json",
    mapMarkdownName: "14-stage1-8-final-refinement-map.md",
    promptName: "15-stage1-8-gemini-final-refinement-prompt.md",
    responseName: "16-stage1-8-gemini-final-refinement-response.md",
  },
};

export const DEFAULT_REFINEMENT_ROUND = 2;

export function supportedRefinementRounds() {
  return Object.keys(REFINEMENT_ROUND_SPECS)
    .map((value) => Number.parseInt(value, 10))
    .sort((left, right) => left - right);
}

export function refinementRoundSpec(round = DEFAULT_REFINEMENT_ROUND) {
  const normalized = Number.parseInt(String(round), 10);
  const spec = REFINEMENT_ROUND_SPECS[normalized];
  if (!spec) {
    throw new Error(`지원하지 않는 refinement round입니다: ${round}`);
  }
  return spec;
}

export function previousRefinementRound(round = DEFAULT_REFINEMENT_ROUND) {
  const rounds = supportedRefinementRounds();
  const target = Number.parseInt(String(round), 10);
  const eligible = rounds.filter((candidate) => candidate < target);
  return eligible.length > 0 ? eligible[eligible.length - 1] : null;
}

export function parseRefinementArgs(argv, defaultRound = DEFAULT_REFINEMENT_ROUND) {
  const base = parseDateArgs(argv);
  const args = {
    ...base,
    round: defaultRound,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--round" && argv[index + 1]) {
      args.round = Number.parseInt(argv[index + 1], 10) || args.round;
      index += 1;
    }
  }

  args.round = refinementRoundSpec(args.round).round;
  return args;
}

export function refinementArtifactPaths({
  date,
  round = DEFAULT_REFINEMENT_ROUND,
  rootDir = ROOT_DIR,
}) {
  const spec = refinementRoundSpec(round);
  const analysisDir = path.join(rootDir, "data", "analysis-state", date);
  const manualKitDir = path.join(rootDir, "knowledge", "daily", "manual-kit", date);

  return {
    spec,
    analysisDir,
    manualKitDir,
    mapJson: path.join(analysisDir, spec.mapJsonName),
    mapMarkdown: path.join(manualKitDir, spec.mapMarkdownName),
    prompt: path.join(manualKitDir, spec.promptName),
    response: path.join(manualKitDir, spec.responseName),
  };
}

export function allRefinementArtifactPaths({
  date,
  rootDir = ROOT_DIR,
}) {
  return supportedRefinementRounds().map((round) =>
    refinementArtifactPaths({ date, round, rootDir }),
  );
}
