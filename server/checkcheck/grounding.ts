/**
 * The evidence shape the validation pipeline reads. In Jinna this is filled from Gemini's grounding
 * metadata; here it is filled from OpenRouter's `url_citation` annotations (see openrouter.ts).
 *
 * What the OpenRouter + Exa configuration does NOT give, and what therefore stays empty here:
 *   - `supports`       no sentence-to-source mapping is returned (annotation offsets are 0-0)
 *   - `searchQueries`  the queries the model issued are not returned
 *   - `urlContext`     no "page read by the model" list
 * Nothing downstream is allowed to treat an empty list as a passed check (pipeline.ts reports
 * these as `checks_not_run`).
 */
export interface GroundingChunkInfo {
  index: number;
  uri: string;
  title: string | null;
}
export interface GroundingSupportInfo {
  text: string;
  startIndex: number | null;
  endIndex: number | null;
  chunkIndices: number[];
}
export interface UrlContextInfo {
  url: string;
  status: string | null;
}
export interface GroundedDetailedResult {
  text: string;
  model: string;
  finishReason: string | null;
  grounded: boolean;
  chunks: GroundingChunkInfo[];
  supports: GroundingSupportInfo[];
  urlContext: UrlContextInfo[];
  searchQueries: string[];
  /** url → the excerpt the search service returned for it (fragments of the page, not the page). */
  excerpts: Map<string, string>;
  usage: { promptTokens: number | null; outputTokens: number | null; totalTokens: number | null; reasoningTokens: number | null; searches: number | null; costUsd: number | null };
}

/** No redirect layer exists in this configuration: citation URLs are the pages themselves. */
export async function resolveRedirect(uri: string, _fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    new URL(uri);
    return uri;
  } catch {
    return null;
  }
}
