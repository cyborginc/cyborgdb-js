import type { QueryResultItem } from '../index';
import type { Results } from '../models/Results';

/** Extract flat array of QueryResultItem from query response results. */
export function flattenResults(
  results: Results | QueryResultItem[] | QueryResultItem[][]
): QueryResultItem[] {
  if (!results) return [];
  if (Array.isArray(results) && results.length > 0 && Array.isArray(results[0])) {
    return (results as QueryResultItem[][]).flat();
  }
  return results as QueryResultItem[];
}
