# Design System — Asia Petrol CRM

## Product Context
- **What this is:** CRM/dashboard for petroleum trading. Replaces 86-column Excel spreadsheets for deal management, quotations, shipment registries, and logistics accounting.
- **Who it's for:** Managers, logistics staff, accountants, admins. All Russian-speaking, Kazakhstan-based. Power users who spend full workdays in this tool.
- **Space/industry:** Commodity/petroleum trading, energy sector.
- **Project type:** Data-heavy internal dashboard / CRM.

## Aesthetic Direction
- **Direction:** Industrial/Utilitarian
- **Decoration level:** Minimal. Typography and spacing do the work. No gradients, no decorative blobs, no rounded-everything.
- **Mood:** Precision instrument. A well-organized control room, not a marketing site. Bloomberg meets a clean office. The tool should feel serious, dense, and trustworthy.
- **Reference sites:** Techoil (inatech.com), Molecule (molecule.io), Trading Technologies (tradingtechnologies.com)

## Typography
- **Display/Hero:** Satoshi — clean geometric sans, professional with personality. Used for page titles and section headers.
- **Body/UI:** DM Sans — excellent Cyrillic support, highly readable at small sizes, works for labels, descriptions, navigation.
- **Data/Tables:** JetBrains Mono — tabular numerals, monospace alignment for 86-column deal passport tables. ALL numeric data in tables uses this font.
- **Code:** JetBrains Mono
- **Loading:** Google Fonts CDN
  - `https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&subset=cyrillic`
  - `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&subset=cyrillic`
  - Satoshi from `https://api.fontshare.com/v2/css?f=satoshi@400,500,700&display=swap`
- **Scale:**
  - xs: 11px / 0.6875rem (table cells, compact data)
  - sm: 12px / 0.75rem (table headers, secondary labels)
  - base: 13px / 0.8125rem (body text, form labels, sidebar items)
  - md: 14px / 0.875rem (primary UI text)
  - lg: 16px / 1rem (section headers)
  - xl: 20px / 1.25rem (page titles)
  - 2xl: 24px / 1.5rem (main headings)
  - 3xl: 30px / 1.875rem (hero display, dashboard numbers)

## Color
- **Approach:** Restrained. One strong accent + warm neutrals. Color is meaningful, not decorative.
- **Primary/Accent:** `#D97706` (Amber 600) — the color of refined petroleum. Warm, authoritative, stands out from generic SaaS blue.
- **Primary hover:** `#B45309` (Amber 700)
- **Primary foreground:** `#FFFFFF`
- **Secondary:** `#1E293B` (Slate 800) — dark sidebar, header accents
- **Background:** `#FAFAF9` (Stone 50) — warm off-white, easier on eyes than pure white
- **Surface/Card:** `#FFFFFF`
- **Border:** `#E7E5E4` (Stone 200)
- **Border strong:** `#D6D3D1` (Stone 300)
- **Text primary:** `#1C1917` (Stone 900)
- **Text secondary:** `#78716C` (Stone 500)
- **Text muted:** `#A8A29E` (Stone 400)
- **Sidebar bg:** `#1E293B` (Slate 800) — dark sidebar for contrast and focus on content
- **Sidebar text:** `#CBD5E1` (Slate 300)
- **Sidebar active:** `#D97706` (Amber 600)
- **Semantic:**
  - Success: `#16A34A` (Green 600) — paid, completed, ordered
  - Warning: `#D97706` (Amber 600) — pending, in progress
  - Error: `#DC2626` (Red 600) — debt, overdue, not ordered
  - Info: `#2563EB` (Blue 600) — informational badges
- **Dark mode:** Not in v1. Light theme optimized for all-day office use.

## Spacing
- **Base unit:** 4px
- **Density:** Compact. Users are replacing Excel, they expect data density.
- **Scale:** 2xs(2px) xs(4px) sm(8px) md(12px) lg(16px) xl(24px) 2xl(32px) 3xl(48px)
- **Table row height:** 28px (compact, Excel-like density)
- **Table cell padding:** 4px 8px
- **Form field height:** 32px
- **Sidebar item height:** 32px
- **Card padding:** 16px
- **Page padding:** 24px
- **Section gap:** 16px

## Layout
- **Approach:** Grid-disciplined. Maximize screen real estate for tables.
- **Grid:** Sidebar (240px fixed) + fluid content area
- **Max content width:** None. Tables should use full available width.
- **Border radius:**
  - sm: 4px (inputs, small badges)
  - md: 6px (cards, dialogs)
  - lg: 8px (large containers)
  - full: 9999px (avatar, status dots)
- **Table columns:** No max width. Horizontal scroll for wide tables (passport view). Frozen first 2-3 columns.

## Motion
- **Approach:** Minimal-functional. Only transitions that aid comprehension.
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50ms) short(150ms) medium(200ms)
- **Where to animate:** sidebar expand/collapse, dialog open/close, tab switches, toast notifications
- **Where NOT to animate:** table row hover, data updates, page transitions

## Component Patterns
- **Tables:** Monospace numerals (JetBrains Mono), compact rows (28px), alternating row shading on hover only, sticky headers, frozen identity columns
- **Status badges:** Pill-shaped, semantic colors on light tinted backgrounds (e.g., green text on green-50 bg)
- **Fuel type badges:** Small dot + name, dot color from fuel_types.color field
- **Forms:** Compact (32px inputs), labels above inputs, inline validation
- **Sidebar:** Dark background (#1E293B), amber active indicator, collapsible sections, compact items
- **Cards:** White surface, subtle border, 16px padding, no shadow
- **Buttons:** Primary (amber), Secondary (outlined), Ghost (no border), Destructive (red)
- **Numbers:** Always right-aligned in tables, always JetBrains Mono, always tabular-nums

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-02 | Initial design system created | Created by /design-consultation. Industrial/utilitarian direction based on competitive research of Techoil, Molecule, Trading Technologies. |
| 2026-04-02 | Amber primary accent (#D97706) | Energy sector identity. Stands out from generic blue SaaS. Color of refined petroleum. |
| 2026-04-02 | JetBrains Mono for table data | 86-column passport tables need monospace alignment. Tabular numerals critical for financial data scanning. |
| 2026-04-02 | Dark sidebar (#1E293B) | Creates visual hierarchy. Content area stays light for readability, sidebar frames without competing. |
| 2026-04-02 | 28px table rows | Users replacing Excel expect data density. 40px rows waste screen space on a tool with 86 columns. |
| 2026-04-02 | No dark mode in v1 | Target users work in lit offices during business hours. Light theme optimized for all-day use first. |
