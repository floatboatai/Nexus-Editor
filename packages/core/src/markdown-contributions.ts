import { Facet, type EditorState, type Extension } from "@codemirror/state";
import type { Root } from "mdast";

import type {
  MarkdownTransformObserver,
  MarkdownTransformPerformanceSample,
  MarkdownTransformSnapshot,
  WidgetDefinitionContribution,
  WidgetDefinitionSnapshot,
} from "./types";

function validateSnapshotIdentity(registryId: string, version: number): void {
  if (registryId.trim().length === 0) {
    throw new TypeError("Markdown contribution registryId must not be empty");
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError("Markdown contribution version must be a non-negative safe integer");
  }
}

function newestByRegistry<T extends { readonly registryId: string; readonly version: number }>(
  snapshots: readonly T[],
): readonly T[] {
  const newest = new Map<string, T>();
  for (const snapshot of snapshots) {
    const previous = newest.get(snapshot.registryId);
    if (!previous || snapshot.version >= previous.version) {
      newest.set(snapshot.registryId, snapshot);
    }
  }
  return Array.from(newest.values()).sort((left, right) =>
    left.registryId.localeCompare(right.registryId),
  );
}

const markdownTransformSnapshots = Facet.define<
  MarkdownTransformSnapshot,
  readonly MarkdownTransformSnapshot[]
>({
  combine: newestByRegistry,
});

const widgetDefinitionSnapshots = Facet.define<
  WidgetDefinitionSnapshot,
  readonly WidgetDefinitionSnapshot[]
>({
  combine: newestByRegistry,
});

/** Always-present field so dynamic Widget facets can be added after editor creation. */
export const dynamicWidgetDefinitionExtension: Extension = widgetDefinitionSnapshots.of(
  Object.freeze({
    registryId: "nexus.core.dynamic-widget-anchor",
    version: 0,
    definitions: Object.freeze([]),
  }),
);

/** Install one immutable, versioned transform snapshot through CM6 configuration effects. */
export function markdownTransformSnapshotExtension(
  snapshot: MarkdownTransformSnapshot,
): Extension {
  validateSnapshotIdentity(snapshot.registryId, snapshot.version);
  return markdownTransformSnapshots.of(Object.freeze({ ...snapshot }));
}

/** Install one immutable, versioned Widget definition snapshot through CM6 configuration effects. */
export function widgetDefinitionSnapshotExtension(
  snapshot: WidgetDefinitionSnapshot,
): Extension {
  validateSnapshotIdentity(snapshot.registryId, snapshot.version);
  const seen = new Set<string>();
  const definitions = snapshot.definitions.map((item) => {
    if (item.id.trim().length === 0) {
      throw new TypeError("Widget contribution id must not be empty");
    }
    if (seen.has(item.id)) {
      throw new TypeError(`Widget contribution '${item.id}' is duplicated in one snapshot`);
    }
    seen.add(item.id);
    return Object.freeze({ ...item });
  });
  return widgetDefinitionSnapshots.of(Object.freeze({
    ...snapshot,
    definitions: Object.freeze(definitions),
  }));
}

/**
 * Single guarded path for delivering a performance sample to a host observer.
 * Observation is a side channel: a missing observer is a no-op, and a
 * throwing observer must never interrupt the transform pipeline or alter
 * editor semantics.
 */
export function notifyMarkdownTransformObserver(
  observer: MarkdownTransformObserver | undefined,
  sample: MarkdownTransformPerformanceSample,
): void {
  if (!observer) return;
  try {
    observer(sample);
  } catch {
    // Observation must not affect transform semantics.
  }
}

export function applyMarkdownTransformSnapshots(
  state: EditorState,
  tree: Root,
  onSample?: MarkdownTransformObserver,
): Root {
  let transformed = tree;
  for (const snapshot of state.facet(markdownTransformSnapshots)) {
    if (onSample) {
      const startedAt = performance.now();
      transformed = snapshot.transform(transformed);
      notifyMarkdownTransformObserver(onSample, {
        kind: "contribution",
        registryId: snapshot.registryId,
        version: snapshot.version,
        durationMs: performance.now() - startedAt,
      });
    } else {
      // Zero-instrumentation path: no observer, no timing overhead.
      transformed = snapshot.transform(transformed);
    }
  }
  return transformed;
}

export function getMarkdownTransformRevision(state: EditorState): string {
  return state.facet(markdownTransformSnapshots)
    .map((snapshot) => `${snapshot.registryId}@${snapshot.version}`)
    .join("|");
}

export function getWidgetDefinitionContributions(
  state: EditorState,
): readonly WidgetDefinitionContribution[] {
  return state.facet(widgetDefinitionSnapshots).flatMap((snapshot) => snapshot.definitions);
}

export function getWidgetDefinitionRevision(state: EditorState): string {
  return state.facet(widgetDefinitionSnapshots)
    .map((snapshot) => `${snapshot.registryId}@${snapshot.version}`)
    .join("|");
}
