import type { Category } from "./types";

export const PATH_SEPARATOR = " › ";

// Categories arrive as a flat list, each naming its parent; every screen that needs the tree
// (browsing, pickers, filters, roll-up counts) reads it through this one structure, so "an item
// in Earrings is also in Jewelry" means the same thing everywhere.
export interface CategoryTree {
  all: Category[];
  get(id: string): Category | undefined;
  /** Direct children, by name. `null` gives the top-level categories. */
  childrenOf(id: string | null): Category[];
  hasChildren(id: string): boolean;
  /** From the top-level ancestor down to the category itself. */
  path(id: string): Category[];
  /** "Jewelry › Earrings". Empty for an unknown id. */
  pathLabel(id: string): string;
  topLevel(id: string): Category | undefined;
  /** The category's own id plus every category beneath it — what "in Jewelry" means. */
  withDescendants(id: string): Set<string>;
  /** Categories with no children — the only ones an item can be filed under. By path. */
  leaves: Category[];
  /** Every category depth-first with its depth (0 = top level), for an indented dropdown. */
  nested: { category: Category; depth: number }[];
}

export function buildCategoryTree(categories: Category[]): CategoryTree {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map<string | null, Category[]>();
  for (const category of categories) {
    // A parent that isn't in the list (shouldn't happen) is treated as none, so the category
    // still shows up somewhere instead of vanishing.
    const key = category.parentId && byId.has(category.parentId) ? category.parentId : null;
    const siblings = children.get(key);
    if (siblings) siblings.push(category);
    else children.set(key, [category]);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name));

  const childrenOf = (id: string | null) => children.get(id) ?? [];

  const path = (id: string) => {
    const result: Category[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    // `seen` only matters for corrupted data; the server never lets a chain loop.
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      result.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return result;
  };
  const pathLabel = (id: string) => path(id).map((c) => c.name).join(PATH_SEPARATOR);

  const withDescendants = (id: string) => {
    const ids = new Set<string>();
    const visit = (current: string) => {
      if (ids.has(current)) return;
      ids.add(current);
      for (const child of childrenOf(current)) visit(child.id);
    };
    visit(id);
    return ids;
  };

  const nested: { category: Category; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const category of childrenOf(parent)) {
      nested.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);

  return {
    all: categories,
    get: (id) => byId.get(id),
    childrenOf,
    hasChildren: (id) => childrenOf(id).length > 0,
    path,
    pathLabel,
    topLevel: (id) => path(id)[0],
    withDescendants,
    leaves: nested.filter(({ category }) => childrenOf(category.id).length === 0).map(({ category }) => category),
    nested,
  };
}

/** Options for a "file this item under…" picker: leaves only, labelled with their full path. */
export function leafOptions(tree: CategoryTree): { value: string; label: string }[] {
  return tree.leaves.map((c) => ({ value: c.id, label: tree.pathLabel(c.id) }));
}

/** How many items sit in each category counting everything beneath it, and how many directly. */
export function countItems(tree: CategoryTree, items: { categoryId: string | null }[]) {
  const direct = new Map<string, number>();
  const total = new Map<string, number>();
  for (const item of items) {
    if (!item.categoryId) continue;
    direct.set(item.categoryId, (direct.get(item.categoryId) ?? 0) + 1);
    for (const ancestor of tree.path(item.categoryId)) total.set(ancestor.id, (total.get(ancestor.id) ?? 0) + 1);
  }
  return { direct: (id: string) => direct.get(id) ?? 0, total: (id: string) => total.get(id) ?? 0 };
}
