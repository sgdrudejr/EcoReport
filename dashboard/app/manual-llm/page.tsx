import fs from "fs";
import path from "path";
import ManualLlmEditor from "@/components/ManualLlmEditor";

const REPO_ROOT = path.resolve(process.cwd(), "..");

type PromptSection = {
  label: string;
  kind: "synthesis" | "advisory";
  description: string;
  promptPath: string | null;
  targetPath: string | null;
  initialContent: string;
  commandHint: string;
};

type QueueItem = {
  id: string;
  rank: number;
  title: string;
  broker: string;
  date: string;
  category: string;
  priorityLabel: string;
  priorityScore: number;
  reasons: string[];
  promptPath: string;
  existingSummary: string;
};

function readTextIfExists(filePath: string | null) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  return fs.readFileSync(filePath, "utf-8");
}

function findLatestFile(dirPath: string, suffix: string) {
  if (!fs.existsSync(dirPath)) return null;

  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith(suffix))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return path.join(dirPath, files[0]);
}

function toRepoRelative(filePath: string | null) {
  if (!filePath) return null;
  return path.relative(REPO_ROOT, filePath);
}

function loadSynthesisSection(): PromptSection {
  const promptFile = findLatestFile(
    path.join(REPO_ROOT, "knowledge", "daily"),
    "-synthesis-prompt.md",
  );
  const targetFile = promptFile?.replace(
    /-synthesis-prompt\.md$/,
    "-synthesis.md",
  ) ?? null;

  return {
    label: "시황 종합",
    kind: "synthesis",
    description:
      "오늘 뉴스·리포트·트윗을 묶어서 GPT가 정리한 종합 시황을 저장합니다.",
    promptPath: toRepoRelative(promptFile),
    targetPath: toRepoRelative(targetFile),
    initialContent: readTextIfExists(targetFile),
    commandHint:
      "bash /Users/seo/Documents/Playground/EcoReport/scripts/open-chatgpt-web-prompt.sh synthesis",
  };
}

function loadAdvisorySection(): PromptSection {
  const promptFile = findLatestFile(
    path.join(REPO_ROOT, "reports", "daily"),
    "-advisory-prompt.md",
  );
  const targetFile =
    promptFile?.replace(/-advisory-prompt\.md$/, "-briefing.md") ?? null;

  return {
    label: "어드바이저 브리핑",
    kind: "advisory",
    description:
      "내 포트폴리오 기준 운용 지침, 매수/보류 판단, 계좌별 액션 가이드를 저장합니다.",
    promptPath: toRepoRelative(promptFile),
    targetPath: toRepoRelative(targetFile),
    initialContent: readTextIfExists(targetFile),
    commandHint:
      "bash /Users/seo/Documents/Playground/EcoReport/scripts/open-chatgpt-web-prompt.sh advisory",
  };
}

function loadQueueItems(): { date: string | null; items: QueueItem[] } {
  const queueFile = findLatestFile(
    path.join(REPO_ROOT, "knowledge", "daily"),
    "-report-summary-queue.json",
  );

  if (!queueFile) {
    return { date: null, items: [] };
  }

  try {
    const queue = JSON.parse(fs.readFileSync(queueFile, "utf-8")) as {
      date?: string;
      items?: Array<{
        id: string;
        rank: number;
        title: string;
        broker: string;
        date: string;
        category: string;
        priorityLabel: string;
        priorityScore: number;
        reasons?: string[];
        promptPath: string;
      }>;
    };

    const date = queue.date ?? null;
    const manualCompressedPath = date
      ? path.join(REPO_ROOT, "data", "reports", date, "manual-compressed.json")
      : null;
    const existingSummaries =
      manualCompressedPath && fs.existsSync(manualCompressedPath)
        ? (JSON.parse(fs.readFileSync(manualCompressedPath, "utf-8")) as Array<{
            id?: string;
          }>)
        : [];

    const existingMap = new Map(
      existingSummaries
        .filter((item) => item?.id)
        .map((item) => [item.id as string, JSON.stringify(item, null, 2)]),
    );

    return {
      date,
      items: (queue.items ?? []).map((item) => ({
        ...item,
        reasons: item.reasons ?? [],
        existingSummary: existingMap.get(item.id) ?? "",
      })),
    };
  } catch {
    return { date: null, items: [] };
  }
}

export default function ManualLlmPage() {
  const synthesis = loadSynthesisSection();
  const advisory = loadAdvisorySection();
  const queue = loadQueueItems();

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">수동 LLM 저장</h1>
        <p className="mt-1 text-sm text-zinc-500">
          GPT 웹에서 생성한 시황 종합, 브리핑, 개별 PDF 요약을 붙여넣고
          저장하면 EcoReport가 다음 사이클부터 바로 재사용합니다.
        </p>
        <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-xs text-zinc-400">
          추천 순서: <code>queue</code> 또는 <code>triage</code>로 오늘 읽을
          리포트를 고르고, <code>file ...</code>로 개별 PDF를 요약한 뒤,
          <code>synthesis</code>로 시황 종합, <code>coach</code> 또는{" "}
          <code>advisory</code>로 내 포트폴리오 운용 가이드를 만드세요.
        </div>
      </div>

      <ManualLlmEditor
        synthesis={synthesis}
        advisory={advisory}
        queueItems={queue.items}
        queueDate={queue.date}
      />
    </main>
  );
}
