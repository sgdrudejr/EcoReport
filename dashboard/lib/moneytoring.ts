const MONEYTORING_API_URL = "https://api.moneytoring.ai/graphql";
const MONEYTORING_REVALIDATE_SECONDS = 300;

const GET_MAVO_TOPIC_PAGINATION_QUERY = `
  query getMavoTopicPaginationQuery(
    $sortBy: MarketVoiceSortBy!
    $sourceTypeList: [MarketVoiceSourceTypeEnum]
    $keywordIdList: [ID!]
    $cursorPaginationInput: CursorPaginationInputType!
  ) {
    mavoTopicPagination(
      sortBy: $sortBy
      sourceTypeList: $sourceTypeList
      keywordIdList: $keywordIdList
      cursorPaginationInput: $cursorPaginationInput
    ) {
      topicList {
        id
        title
        summary
        displayUpdatedAt
        quoteCount
        imageUrlList
        mainSource {
          type
          name
          author
        }
        uniqueSourceTypeList
        keywordList {
          id
          name
          logo
          type
          code
          country
          fluctuationRate
        }
        topicDocumentSize
      }
      pagination {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const GET_MARKET_VOICE_TOPIC_DETAIL_QUERY = `
  query getMarketVoiceTopicDetailQuery(
    $topicId: ID!
    $sortDirection: SortDirection!
  ) {
    marketVoiceTopicDetail(topicId: $topicId, sortDirection: $sortDirection) {
      id
      title
      displaySourceInfo {
        type
        count
      }
      subTopicList {
        id
        title
        summary
        displayCreatedAt
        displayUpdatedAt
        sourceOriginList {
          id
          title
          type
          author
          url
          displayCreatedAt
        }
      }
    }
  }
`;

const DEFAULT_SOURCE_TYPE_LIST = [
  "DISCLOSURE",
  "COMPANY_NEWS",
  "TELEGRAM",
  "YOUTUBE",
  "IR",
] as const;

export type MoneytoringKeyword = {
  id: string;
  name: string;
  logo: string | null;
  type: string;
  code: string;
  country: string;
  fluctuationRate: number | null;
};

export type MoneytoringTopic = {
  id: string;
  title: string;
  summary: string;
  displayUpdatedAt: string;
  quoteCount: number;
  imageUrlList: string[];
  mainSource: {
    type: string | null;
    name: string | null;
    author: string | null;
  } | null;
  uniqueSourceTypeList: string[];
  keywordList: MoneytoringKeyword[];
  topicDocumentSize: number;
};

export type MoneytoringTopicDetail = {
  id: string;
  title: string;
  displaySourceInfo: Array<{
    type: string;
    count: number;
  }>;
  subTopicList: Array<{
    id: string;
    title: string;
    summary: string;
    displayCreatedAt: string;
    displayUpdatedAt: string;
    sourceOriginList: Array<{
      id: string;
      title: string;
      type: string;
      author: string;
      url: string;
      displayCreatedAt: string;
    }>;
  }>;
};

type MoneytoringTopicPaginationResponse = {
  mavoTopicPagination: {
    topicList: MoneytoringTopic[];
    pagination: {
      hasNextPage: boolean;
      hasPreviousPage: boolean;
      startCursor: string | null;
      endCursor: string | null;
    };
  };
};

type MoneytoringTopicDetailResponse = {
  marketVoiceTopicDetail: MoneytoringTopicDetail;
};

export type MoneytoringNewsSnapshot = {
  topics: MoneytoringTopic[];
  pagination: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  featuredTopic: MoneytoringTopic | null;
  featuredDetails: MoneytoringTopicDetail | null;
  insightTopics: MoneytoringTopicDetail[];
};

async function requestMoneytoringGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(MONEYTORING_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    next: { revalidate: MONEYTORING_REVALIDATE_SECONDS },
  });

  if (!response.ok) {
    throw new Error(`Moneytoring GraphQL request failed: ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as { data?: T; errors?: unknown[] };

  if (payload.errors?.length) {
    throw new Error(`Moneytoring GraphQL error: ${JSON.stringify(payload.errors)}`);
  }

  if (!payload.data) {
    throw new Error("Moneytoring GraphQL returned an empty payload.");
  }

  return payload.data;
}

export function decodeMoneytoringNumericId(globalId: string) {
  try {
    const decoded = Buffer.from(globalId, "base64").toString("utf8");
    const match = decoded.match(/:(\d+)$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function buildMoneytoringTopicUrl(globalId: string) {
  const numericId = decodeMoneytoringNumericId(globalId);
  return numericId ? `https://www.moneytoring.ai/mv/${numericId}` : "https://www.moneytoring.ai/mv";
}

function normalizeTopicId(topicId: string) {
  if (topicId.startsWith("TWF")) {
    return topicId;
  }

  return Buffer.from(`MarketVoiceTopicType:${topicId}`).toString("base64");
}

export async function getLatestMoneytoringTopics(limit = 12) {
  const data = await requestMoneytoringGraphQL<MoneytoringTopicPaginationResponse>(
    GET_MAVO_TOPIC_PAGINATION_QUERY,
    {
      sortBy: "LATEST",
      sourceTypeList: [...DEFAULT_SOURCE_TYPE_LIST],
      keywordIdList: [],
      cursorPaginationInput: {
        first: limit,
        after: null,
      },
    },
  );

  return data.mavoTopicPagination;
}

export async function getMoneytoringTopicDetail(topicId: string) {
  const data = await requestMoneytoringGraphQL<MoneytoringTopicDetailResponse>(
    GET_MARKET_VOICE_TOPIC_DETAIL_QUERY,
    {
      topicId: normalizeTopicId(topicId),
      sortDirection: "DESC",
    },
  );

  return data.marketVoiceTopicDetail;
}

export async function getMoneytoringNewsSnapshot(
  options?: {
    limit?: number;
    insightCount?: number;
  },
): Promise<MoneytoringNewsSnapshot> {
  const limit = options?.limit ?? 10;
  const insightCount = options?.insightCount ?? 3;
  const paginationResult = await getLatestMoneytoringTopics(limit);
  const topics = paginationResult.topicList;
  const featuredTopic = topics[0] ?? null;
  const insightTargets = topics.slice(0, insightCount);
  const insightTopics = await Promise.all(
    insightTargets.map((topic) => getMoneytoringTopicDetail(topic.id)),
  );

  return {
    topics,
    pagination: paginationResult.pagination,
    featuredTopic,
    featuredDetails: insightTopics[0] ?? null,
    insightTopics,
  };
}
