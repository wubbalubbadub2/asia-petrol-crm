---
paths:
  - "src/app/**"
  - "src/components/**"
---

# UI rules

- Read `DESIGN.md` before visual changes.
- Preserve compact, data-heavy, Russian-language workflows and existing component patterns.
- Numeric table data is right-aligned, tabular, and monospaced.
- Do not introduce decorative gradients, oversized cards, excessive whitespace, or rounded-everything styling.
- Preserve keyboard use, horizontal-table behavior, sticky/frozen columns, loading, empty, error, and permission-denied states.
- Test responsive behavior only where the feature scope includes mobile; do not degrade desktop density.
- For user-visible changes, verify the real rendered state rather than relying only on component code.
