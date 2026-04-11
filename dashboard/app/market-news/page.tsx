import type { Metadata } from "next";
import { Clock3, ExternalLink, Layers3, RadioTower, Sparkles, TrendingUp } from "lucide-react";

import {
  buildMoneytoringTopicUrl,
  decodeMoneytoringNumericId,
  getMoneytoringNewsSnapshot,
  type MoneytoringKeyword,
  type MoneytoringTopic,
  type MoneytoringTopicDetail,
} from "@/lib/moneytoring";

export const metadata: Metadata = {
  title: "시황 뉴스 | EcoReport",
  description: "머니토링 시황/마켓보이스 최신 뉴스를 EcoReport 대시보드에서 바로 확인합니다.",
};

export const revalidate = 300;

const BODY_COPY_CLASS = "text-[14.5px] leading-[1.72] [word-break:keep-all] [text-wrap:pretty]";
const DATETIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});
const NUMBER_FORMATTER = new Intl.NumberFormat("ko-KR");

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "업데이트 정보 없음";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return DATETIME_FORMATTER.format(parsed);
}

function keywordTone(keyword: MoneytoringKeyword) {
  if (keyword.type === "COMPANY") {
    return "bg-indigo-50 text-indigo-700 ring-indigo-100";
  }
  if (keyword.type === "INFLUENCER") {
    return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  }
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

function FeatureStats({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.15rem] border border-slate-200/90 bg-white/90 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</p>
      <p className="mt-2 text-[1.15rem] font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

function TopicCard({ topic, featured = false }: { topic: MoneytoringTopic; featured?: boolean }) {
  const topicUrl = buildMoneytoringTopicUrl(topic.id);
  const topicId = decodeMoneytoringNumericId(topic.id);

  return (
    <article
      className={joinClasses(
        "rounded-[1.5rem] border border-slate-200/80 bg-white/95 shadow-[0_10px_28px_rgba(15,23,42,0.05)]",
        featured ? "p-6" : "p-5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 ring-1 ring-inset ring-slate-200">
          {topic.mainSource?.author ?? topic.mainSource?.name ?? "머니토링"}
        </span>
        <span className="flex items-center gap-1">
          <Clock3 size={12} />
          {formatDateTime(topic.displayUpdatedAt)}
        </span>
        <span>{NUMBER_FORMATTER.format(topic.topicDocumentSize)}건 소스 묶음</span>
        {topicId ? <span>ID {topicId}</span> : null}
      </div>

      <h2
        className={joinClasses(
          "mt-4 font-semibold tracking-tight text-slate-950",
          featured ? "text-[1.7rem] leading-[1.25]" : "text-lg leading-7",
        )}
      >
        {topic.title}
      </h2>

      <p className={joinClasses("mt-3 text-slate-600", BODY_COPY_CLASS)}>{topic.summary}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {topic.keywordList.slice(0, featured ? 6 : 4).map((keyword) => (
          <span
            key={`${topic.id}-${keyword.id}`}
            className={joinClasses(
              "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
              keywordTone(keyword),
            )}
          >
            {keyword.name}
            {keyword.code ? ` · ${keyword.code}` : ""}
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <a
          href={topicUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          원문 묶음 보기
          <ExternalLink size={14} />
        </a>
        <p className="text-sm text-slate-500">
          머니토링 요약과 연결된 원문 채널을 바로 따라갈 수 있습니다.
        </p>
      </div>
    </article>
  );
}

function InsightCard({ detail }: { detail: MoneytoringTopicDetail }) {
  const subTopic = detail.subTopicList[0];
  const topicUrl = buildMoneytoringTopicUrl(detail.id);

  if (!subTopic) {
    return null;
  }

  return (
    <article className="rounded-[1.35rem] border border-slate-200/85 bg-white px-5 py-5 shadow-[0_8px_24px_rgba(15,23,42,0.045)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-100">
          핵심 인사이트
        </span>
        <span className="text-[11px] font-medium text-slate-500">
          {formatDateTime(subTopic.displayUpdatedAt)}
        </span>
      </div>

      <h3 className="mt-3 text-lg font-semibold leading-7 tracking-tight text-slate-950">
        {subTopic.title}
      </h3>
      <p className={joinClasses("mt-3 text-slate-600", BODY_COPY_CLASS)}>{subTopic.summary}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {subTopic.sourceOriginList.slice(0, 4).map((source) => (
          <a
            key={source.id}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-200 transition hover:bg-slate-200/80"
          >
            <RadioTower size={11} />
            {source.author}
          </a>
        ))}
      </div>

      <a
        href={topicUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-700 underline-offset-4 hover:text-slate-950 hover:underline"
      >
        머니토링 상세 열기
        <ExternalLink size={14} />
      </a>
    </article>
  );
}

export default async function MarketNewsPage() {
  let snapshot: Awaited<ReturnType<typeof getMoneytoringNewsSnapshot>> | null = null;
  let loadError: string | null = null;

  try {
    snapshot = await getMoneytoringNewsSnapshot({ limit: 10, insightCount: 3 });
  } catch (error) {
    loadError = error instanceof Error ? error.message : "시황 뉴스를 불러오지 못했습니다.";
  }

  const featuredTopic = snapshot?.featuredTopic ?? null;
  const remainingTopics = snapshot?.topics.slice(1) ?? [];
  const featureSourceCount =
    snapshot?.featuredDetails?.displaySourceInfo.reduce((count, item) => count + item.count, 0) ??
    featuredTopic?.topicDocumentSize ??
    0;
  const latestTimestamp =
    snapshot?.topics
      .map((topic) => topic.displayUpdatedAt)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pb-28 pt-8 sm:px-6 md:pt-10">
      <section className="glass-panel rounded-[2rem] px-5 py-6 sm:px-6 md:px-8 md:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="section-kicker">Market Voice Feed</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 md:text-[2.4rem]">
              시황 뉴스
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-7 text-slate-600">
              머니토링 마켓보이스에서 올라오는 최신 시황 묶음을 EcoReport 대시보드 안에서
              바로 읽을 수 있게 연결했습니다. 핵심 뉴스는 빠르게 훑고, 깊게 볼 이슈는 원문
              채널까지 이어서 확인할 수 있습니다.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FeatureStats
              title="최신 피드"
              value={snapshot ? `${NUMBER_FORMATTER.format(snapshot.topics.length)}건` : "-"}
              detail={loadError ? "로딩 실패" : "페이지 진입 시 최신순 묶음"}
            />
            <FeatureStats
              title="소스 커버리지"
              value={`${NUMBER_FORMATTER.format(featureSourceCount)}건`}
              detail="대표 이슈 기준 연동된 원문 채널 수"
            />
            <FeatureStats
              title="마지막 업데이트"
              value={formatDateTime(latestTimestamp)}
              detail="머니토링 GraphQL 기준 KST"
            />
          </div>
        </div>
      </section>

      {loadError ? (
        <section className="section-block mt-8">
          <div className="glass-panel rounded-[1.75rem] px-6 py-7">
            <p className="section-kicker">Fallback</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
              시황 뉴스 연결은 되어 있지만 이번 요청은 실패했습니다
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">{loadError}</p>
            <a
              href="https://www.moneytoring.ai/mv"
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              머니토링 열기
              <ExternalLink size={14} />
            </a>
          </div>
        </section>
      ) : null}

      {featuredTopic ? (
        <section className="section-block mt-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
            <TopicCard topic={featuredTopic} featured />

            <div className="space-y-4">
              <div className="glass-panel-soft rounded-[1.5rem] px-5 py-5">
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl bg-indigo-50 p-2 text-indigo-700">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      핵심 포인트
                    </p>
                    <p className="mt-1 text-sm text-slate-500">지금 첫 화면에서 봐야 하는 해석</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {snapshot?.featuredDetails?.subTopicList[0] ? (
                    <>
                      <p className="text-sm font-semibold text-slate-900">
                        {snapshot.featuredDetails.subTopicList[0].title}
                      </p>
                      <p className={joinClasses("text-slate-600", BODY_COPY_CLASS)}>
                        {snapshot.featuredDetails.subTopicList[0].summary}
                      </p>
                    </>
                  ) : (
                    <p className={joinClasses("text-slate-600", BODY_COPY_CLASS)}>
                      대표 이슈의 세부 인사이트를 아직 불러오지 못했습니다.
                    </p>
                  )}
                </div>
              </div>

              <div className="glass-panel-soft rounded-[1.5rem] px-5 py-5">
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl bg-emerald-50 p-2 text-emerald-700">
                    <TrendingUp size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                      태그 흐름
                    </p>
                    <p className="mt-1 text-sm text-slate-500">현재 피드에서 같이 묶이는 키워드</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {featuredTopic.keywordList.slice(0, 8).map((keyword) => (
                    <span
                      key={`${featuredTopic.id}-${keyword.id}`}
                      className={joinClasses(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset",
                        keywordTone(keyword),
                      )}
                    >
                      {keyword.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="section-block mt-8">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="glass-panel rounded-[1.8rem] px-5 py-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="section-kicker">Latest Stream</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  최신 시황 묶음
                </h2>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600">
                {NUMBER_FORMATTER.format(remainingTopics.length)}건
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {remainingTopics.map((topic) => (
                <TopicCard key={topic.id} topic={topic} />
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-[1.8rem] px-5 py-6 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-slate-900/5 p-2.5 text-slate-700">
                <Layers3 size={18} />
              </div>
              <div>
                <p className="section-kicker">Roundup</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  핵심 뉴스 인사이트
                </h2>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {(snapshot?.insightTopics ?? []).map((detail) => (
                <InsightCard key={detail.id} detail={detail} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
