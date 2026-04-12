/**
 * Groups a flat list of categories into parent/child hierarchy.
 *
 * Returns:
 *   groups: [{ parent: Category|null, children: Category[] }]
 *     - parent=null means "no parent" (top-level categories without children)
 *     - parent=Category means those are grouped under that parent
 *
 * Usage in a <select>:
 *   - groups where parent=null → flat <option> elements
 *   - groups where parent!=null → <optgroup label={parent.name}>…</optgroup>
 */
export function groupCategories(categories) {
  const byParent = {};   // parent_id → [child categories]
  const parentIds = new Set();

  for (const cat of categories) {
    if (cat.parent_id) {
      if (!byParent[cat.parent_id]) byParent[cat.parent_id] = [];
      byParent[cat.parent_id].push(cat);
      parentIds.add(cat.parent_id);
    }
  }

  // Categories that have children (they are parents)
  const parents = categories.filter(c => byParent[c.id]);

  // Top-level categories that have NO children and NO parent
  const orphans = categories.filter(c => !byParent[c.id] && !c.parent_id);

  const groups = [];

  // Grouped sections: parent + its children
  for (const parent of parents) {
    groups.push({ parent, children: byParent[parent.id] || [] });
  }

  // Ungrouped (no parent, no children) at the end
  if (orphans.length > 0) {
    groups.push({ parent: null, children: orphans });
  }

  return groups;
}

/**
 * Renders grouped categories as a list of <option> / <optgroup> JSX elements.
 * Accepts an optional `includeEmpty` label for the blank option.
 */
export function CategoryOptions({ categories, includeEmpty = false }) {
  const groups = groupCategories(categories);

  return (
    <>
      {includeEmpty && <option value="">— Uncategorised</option>}
      {groups.map((group, i) =>
        group.parent ? (
          <optgroup key={group.parent.id} label={group.parent.name}>
            {/* Parent itself is also selectable */}
            <option value={group.parent.id}>{group.parent.name} (general)</option>
            {group.children.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </optgroup>
        ) : (
          // Orphan top-level categories — no group wrapper needed if only one set
          group.children.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))
        )
      )}
    </>
  );
}
