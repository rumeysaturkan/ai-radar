import "dotenv/config";
import { fetchWithTimeout } from "../util/http.js";

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

export type NewsResult = SearchResult & {
  publishedAt: string | null;
};

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  published_date?: string;
};

type TavilyResponse = {
  results: TavilyResult[];
};

async function tavily(body: Record<string, unknown>): Promise<TavilyResponse> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const response = await fetchWithTimeout(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, ...body }),
    },
    20_000,
  );

  if (!response.ok) {
    throw new Error(`Tavily search failed: ${response.status}`);
  }

  return (await response.json()) as TavilyResponse;
}

export async function searchWeb(query: string): Promise<SearchResult[]> {
  const data = await tavily({
    query,
    search_depth: "advanced",
    max_results: 5,
  });

  return data.results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content,
  }));
}

export async function searchNews(
  query: string,
  days: number,
): Promise<NewsResult[]> {
  const data = await tavily({
    query,
    topic: "news",
    days,
    search_depth: "basic",
    max_results: 8,
  });

  return data.results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content,
    publishedAt: result.published_date ?? null,
  }));
}
