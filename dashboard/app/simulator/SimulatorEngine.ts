export type SimulatorPosition = {
  code: string;
  name: string;
  category: string | null;
  actionScore: number;
  factorScore: number | null;
  technicalScore: number | null;
  reportScore: number | null;
  executionConfidence: number | null;
  clusterPenalty: number | null;
};

export type SimulatorControls = {
  riskTolerance: number;
  factorTilt: number;
  reportTilt: number;
};

export function simulatePositions(
  positions: SimulatorPosition[],
  controls: SimulatorControls,
) {
  return positions
    .map((position) => {
      const factorLift = ((position.factorScore ?? 50) - 50) * (controls.factorTilt / 100) * 0.35;
      const reportLift = ((position.reportScore ?? 50) - 50) * (controls.reportTilt / 100) * 0.3;
      const riskLift =
        ((controls.riskTolerance - 50) / 50) *
        (((position.executionConfidence ?? 50) - 50) * 0.2 - (position.clusterPenalty ?? 0) * 1.4);

      const simulatedScore = Math.round(
        Math.max(0, Math.min(100, position.actionScore + factorLift + reportLift + riskLift)),
      );

      return {
        ...position,
        simulatedScore,
        delta: simulatedScore - position.actionScore,
      };
    })
    .sort((left, right) => right.simulatedScore - left.simulatedScore);
}
