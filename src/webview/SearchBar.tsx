/**
 * Search box + filters toolbar (Phase 8): a free-text query (matched
 * against node title/summary/notes/tags and, via `search.ts`, each node's
 * source transcript) plus independent status/type/tag/highlight/branch
 * filters. Purely a controlled input - `App.tsx` owns the actual query and
 * filter state and derives which nodes match using `model/search.ts`, the
 * same logic unit-tested on the host side, so the Webview and extension
 * host never disagree about what "matches".
 */
import * as React from "react";
import { NodeStatus, NodeType } from "../model/types";
import { SearchFilters } from "../model/search";

const ALL_TYPES: NodeType[] = ["topic", "decision", "question", "task", "outcome", "blocker"];
const ALL_STATUSES: NodeStatus[] = ["open", "in-progress", "done", "blocked"];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function SearchBar(props: {
  query: string;
  onQueryChange: (query: string) => void;
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  matchCount: number;
  totalCount: number;
}): React.JSX.Element {
  const { query, onQueryChange, filters, onFiltersChange, matchCount, totalCount } = props;
  const tagsText = (filters.tags ?? []).join(", ");

  return (
    <div className="search-bar" role="search" aria-label="Search and filter the roadmap">
      <div className="search-primary-row">
        <input
          type="search"
          className="search-input"
          placeholder="Search titles, summaries, notes, tags, and transcript..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search roadmap and transcript"
        />
        <span className="search-count" aria-live="polite">
          {matchCount} / {totalCount} nodes match
        </span>
      </div>

      <div className="search-filter-row">
        <fieldset className="search-filters type-filters">
          <legend>Type</legend>
          {ALL_TYPES.map((type) => (
            <label key={type} className="filter-checkbox">
              <input
                type="checkbox"
                checked={(filters.types ?? []).includes(type)}
                onChange={() => onFiltersChange({ ...filters, types: toggle(filters.types ?? [], type) })}
              />
              {type}
            </label>
          ))}
        </fieldset>

        <fieldset className="search-filters status-filters">
          <legend>Status</legend>
          {ALL_STATUSES.map((status) => (
            <label key={status} className="filter-checkbox">
              <input
                type="checkbox"
                checked={(filters.statuses ?? []).includes(status)}
                onChange={() => onFiltersChange({ ...filters, statuses: toggle(filters.statuses ?? [], status) })}
              />
              {status}
            </label>
          ))}
        </fieldset>

        <fieldset className="search-filters tag-filters">
          <legend>Tags</legend>
          <input
            type="text"
            className="tags-filter-input"
            placeholder="Comma-separated tags"
            value={tagsText}
            onChange={(e) => {
              const tags = e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t.length > 0);
              onFiltersChange({ ...filters, tags: tags.length > 0 ? tags : undefined });
            }}
            aria-label="Filter by tags, comma-separated"
          />
        </fieldset>

        <fieldset className="search-filters display-filters">
          <legend>Show</legend>
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={Boolean(filters.highlightedOnly)}
              onChange={(e) => onFiltersChange({ ...filters, highlightedOnly: e.target.checked || undefined })}
            />
            Highlighted only
          </label>

          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={Boolean(filters.branchesOnly)}
              onChange={(e) => onFiltersChange({ ...filters, branchesOnly: e.target.checked || undefined })}
            />
            Resume branches only
          </label>
        </fieldset>
      </div>
    </div>
  );
}
