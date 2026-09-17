/**
 * Search box + filters toolbar (Phase 8): a free-text query (matched
 * against node title/summary/notes/tags and, via `search.ts`, each node's
 * source transcript) plus independent status/type/tag/highlight
 * filters. Purely a controlled input - `App.tsx` owns the actual query and
 * filter state and derives which nodes match using `model/search.ts`, the
 * same logic unit-tested on the host side, so the Webview and extension
 * host never disagree about what "matches".
 */
import * as React from "react";
import { NODE_STATUSES, NODE_TYPES } from "../model/types";
import { SearchFilters } from "../model/search";

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function SearchBar(props: {
  query: string;
  onQueryChange: (query: string) => void;
  filters: SearchFilters;
  onFiltersChange: (filters: SearchFilters) => void;
  availableTags: string[];
  matchCount: number;
  totalCount: number;
}): React.JSX.Element {
  const { query, onQueryChange, filters, onFiltersChange, availableTags, matchCount, totalCount } = props;
  const tagOptions = Array.from(new Set([...availableTags, ...(filters.tags ?? [])])).sort((a, b) =>
    a.localeCompare(b)
  );

  return (
    <div id="roadmap-search-filters" className="search-bar" role="search" aria-label="Search and filter the roadmap">
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
          {NODE_TYPES.map((type) => (
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
          {NODE_STATUSES.map((status) => (
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
          {tagOptions.length > 0 ? (
            tagOptions.map((tag) => {
              const selected = (filters.tags ?? []).includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  className={"tag-filter-chip" + (selected ? " selected" : "")}
                  aria-pressed={selected}
                  onClick={() => {
                    const tags = toggle(filters.tags ?? [], tag);
                    onFiltersChange({ ...filters, tags: tags.length > 0 ? tags : undefined });
                  }}
                >
                  {tag}
                </button>
              );
            })
          ) : (
            <span className="no-filter-options">No tags yet</span>
          )}
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
              checked={Boolean(filters.newOnly)}
              onChange={(e) => onFiltersChange({ ...filters, newOnly: e.target.checked || undefined })}
            />
            New nodes only
          </label>

        </fieldset>
      </div>
    </div>
  );
}
