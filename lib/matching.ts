/** Each item is a left vertex; each participant is a right vertex. */
export type Edge = { itemId: string; participantId: string };
export type MatchingResult = {
  pairs: Edge[];
  steps: { itemId: string; assigned: boolean; pairs: Edge[] }[];
};

/** DFS augmenting paths (Kuhn). O(V * E) time, O(V + E) memory. */
export function maximumMatching(
  itemIds: string[],
  edges: Edge[],
): MatchingResult {
  const adjacency = new Map<string, string[]>();
  for (const id of itemIds) adjacency.set(id, []);
  for (const edge of edges) {
    const list = adjacency.get(edge.itemId);
    if (list && !list.includes(edge.participantId))
      list.push(edge.participantId);
  }
  const assigned = new Map<string, string>();
  const snapshot = () =>
    [...assigned].map(([participantId, itemId]) => ({ itemId, participantId }));
  const visit = (itemId: string, seen: Set<string>): boolean => {
    for (const person of adjacency.get(itemId) ?? []) {
      if (seen.has(person)) continue;
      seen.add(person);
      const previous = assigned.get(person);
      // Reassign only tentative pairs; confirmed pairs are excluded upstream.
      if (previous === undefined || visit(previous, seen)) {
        assigned.set(person, itemId);
        return true;
      }
    }
    return false;
  };
  const steps = [];
  for (const itemId of new Set(itemIds)) {
    const assignedItem = visit(itemId, new Set());
    steps.push({ itemId, assigned: assignedItem, pairs: snapshot() });
  }
  return { pairs: snapshot(), steps };
}

/** Comparison baseline: first eligible unused participant for each item. */
export function sequentialMatching(itemIds: string[], edges: Edge[]): Edge[] {
  const used = new Set<string>();
  const pairs: Edge[] = [];
  for (const itemId of new Set(itemIds)) {
    const edge = edges.find(
      (e) => e.itemId === itemId && !used.has(e.participantId),
    );
    if (edge) {
      pairs.push(edge);
      used.add(edge.participantId);
    }
  }
  return pairs;
}
