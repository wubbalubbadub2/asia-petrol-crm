# AS-BUILT-INTEGRATIONS.md — Boundary-Crossing Behavior

## 1. 1C Document Imports (SNT & ESF)

### SNT (Сопровождающий Накладной Транспортный) Import

**Database Tables:**
- `snt_documents` (migration 00008_documents_attachments.sql)
- `shipment_registry` (created as secondary artifact)

**Expected Excel Columns (Header-Based Detection):**
The importer accepts flexible headers with Russian/English variants:
- `№ СНТ` / `snt_number` — SNT document number
- `Дата` / `date` — Shipment date (DATE)
- `Поставщик` / `supplier` — Supplier company name
- `Получатель` / `receiver` — Receiver company name
- `Товар` / `Наименование товара` / `goods` — Goods description
- `Количество` / `Кол-во` / `quantity` — Quantity in metric tons (DECIMAL(14,4))
- `Сумма` / `total` — Total amount (DECIMAL(14,4))
- `№ вагонов` / `wagon` — Railway wagon number (TEXT)
- `№ накладной` / `waybill` — Waybill number (TEXT)

**Parsing Logic (src/app/(dashboard)/import/page.tsx:156-154):**
```typescript
const docs = parsedData.map((row) => ({
  raw_data: row as Json,
  supplier_name: asString(row["Поставщик"] ?? row["supplier"]),
  receiver_name: asString(row["Получатель"] ?? row["receiver"]),
  goods_description: asString(row["Товар"] ?? row["Наименование товара"] ?? row["goods"]),
  quantity: parseFloat(String(row["Количество"] ?? row["quantity"] ?? 0)) || null,
  total_amount: parseFloat(String(row["Сумма"] ?? row["total"] ?? 0)) || null,
}));
```

**Structured Parser (src/lib/parsers/snt-parser.ts):**
For 1C-native Excel files, `parseSNT()` reads fixed cell addresses from the raw workbook:
- `A5`: snt_number
- `G5`: registration_number
- `A8`: shipment_date
- `G8`: registration_date/time
- `N28` / `B28` / `A28`: supplier_bin (multiple fallback columns)
- `N29` / `B29` / `N27`: supplier_name
- `BC28` / `AD28` / `AD40`: receiver_bin
- `BC29` / `AD29` / `AD41`: receiver_name
- `G70:G90`: goods descriptions
- `AB70:AB90`: quantities
- `Q70:Q90`: TNVED codes
- `W70:W90`: unit of measure
- `AI70:AI90`: price_per_unit
- `AK70:AK90`: total_without_tax
- `BA70:BA90`: tax_rate
- `BC70:BC90`: tax_amount
- `BE70:BE90`: total_with_tax

The parser ignores rows with "п/п", "Всего", or "Признак" headers.

**Shipment Registry Auto-Creation:**
When SNT is imported, a secondary `shipment_registry` row is **always** created:
```typescript
const registryRecords = parsedData.map((row) => ({
  registry_type: "KG",
  date: asString(row["Дата"] ?? row["дата"] ?? row["date"]),
  waybill_number: asString(row["№ накладной"] ?? row["№ СНТ"]),
  wagon_number: asString(row["№ вагонов"] ?? row["№ ВЦ"]),
  shipment_volume: volumeTarget === "ship" ? qty : null,
  loading_volume: volumeTarget === "load" ? qty : null,
  comment: `Импорт из СНТ`,
}));
```

**De-Duplication:**
- **No explicit duplicate check** — re-importing creates a new `snt_documents` row
- `raw_data` JSONB column enables manual audit
- Users must de-duplicate before re-importing

---

### ESF (Электронный Счет-Фактура) Import

**Database Tables:** `esf_documents`, `shipment_registry`

**Expected Excel Columns:**
- `№ ЭСФ` / `esf_number`
- `Дата` / `date`
- `Поставщик` / `supplier`
- `Получатель` / `receiver`
- `Наименование товара` / `goods`
- `Количество` / `quantity`
- `Сумма` / `total` — Amount before tax
- `НДС` — VAT amount
- `Итого` — Total with tax

**DB Column Mapping (esf_documents):**
| Excel Column | DB Column | Type |
|---|---|---|
| № ЭСФ | registration_number | TEXT |
| Дата | issue_date | DATE |
| Поставщик | supplier_name | TEXT |
| Получатель | receiver_name | TEXT |
| Наименование товара | goods_description | TEXT |
| Количество | quantity | DECIMAL(14,4) |
| Сумма | total_without_tax | DECIMAL(14,4) |
| НДС | tax_amount | DECIMAL(14,4) |
| Итого | total_with_tax | DECIMAL(14,4) |

**Deal Binding (Optional):**
- ESF import can optionally bind to a `deal_id` via dropdown
- If `deal_id` set: triggers `refresh_deal_esf_totals()` (migration 00024)
- Auto-aggregates: `invoice_volume` and `invoice_amount` on deals

**Shipment Registry Auto-Creation:** Same pattern as SNT.

---

## 2. Shipment-Registry Excel Import

**Database Table:** `shipment_registry` (migration 00005)

**Expected Columns (Case-Insensitive Russian):**
- `квартал` / `quarter`
- `месяц` / `month`
- `дата` / `date`
- `№ накладной` / `waybill`
- `№ вагонов` / `wagon`
- `объем отгрузки` — shipment_volume (explicit, prioritized)
- `месяц отгрузки`
- `Ж/Д тариф` / `тариф`
- `№ СФ` — invoice_number
- `коментарий` / `комент` — comment
- `Налив тонн` — loading_volume (explicit, prioritized)
- `месяц доп` / `доп месяц` — additional_month

**Volume Routing Logic (lines 128-133):**
When a row has both explicit shipment + loading columns, use them as-is:
```typescript
const shipExplicit = parseFloat(String(row["объем отгрузки"] ?? 0)) || null;
const loadExplicit = parseFloat(String(row["Налив тонн"] ?? 0)) || null;
const fallback = parseFloat(String(row["volume"] ?? row["налив"] ?? 0)) || null;

const shipFinal = shipExplicit ?? (loadExplicit == null && volumeTarget === "ship" ? fallback : null);
const loadFinal = loadExplicit ?? (shipExplicit == null && volumeTarget === "load" ? fallback : null);
```

If only one generic "volume" column exists, the **volumeTarget toggle** (`"ship"` or `"load"`) decides destination.

**Auto-Pricing Trigger (migration 00037):**
When `shipment_registry` row is inserted with `deal_id` set and `shipment_volume NOT NULL`:
- Creates **two** `deal_shipment_prices` rows (supplier + buyer)
- Uses deal's current `supplier_price` and `buyer_price`
- Volume = `shipment_volume`, Amount = volume × price

---

## 3. Excel Exports (Outbound)

### Deal Passport Export (src/lib/exports/passport-excel.ts)

**File Output:** `passport-{dealType}-{year}-{datestamp}.xlsx`

**Sheets:** Single sheet named "Паспорт KG" / "Паспорт KZ" / "Сделки"

**Structure:**
- **Row 1 (24pt height):** Merged title; dark background, light text
- **Row 2:** Band headers (Сделка, Поставщик, Группы, Покупатель, Логистика)
- **Row 3:** Column headers
- **Rows 4+:** Data rows; alternating zebra fill per band color
- **Last row:** Totals row (yellow background, bold)

**Frozen Panes:** `xSplit=1, ySplit=3`

**Column List (41 total, grouped by band):**

#### Band: Сделка
1. `deal_code` — №
2. `month` — Месяц
3. `factory` — Завод
4. `fuel` — ГСМ
5. `sulfur` — %S

#### Band: Поставщик
6. `supplier` — Поставщик
7. `supplier_contract` — Договор
8. `supplier_basis` — Базис
9. `supplier_volume` — Объем, т
10. `supplier_amount` — Сумма дог.
11. `supplier_quotation` — Котировка
12. `supplier_discount` — Скидка
13. `supplier_preliminary_price` — Цена предв.
14. `supplier_price` — Цена оконч.
15. `supplier_shipped_amount` — Отгр. сумма
16. `supplier_shipped_volume` — Отгр., т
17. `supplier_payment` — Оплата
18. `supplier_balance` — Баланс (RED if negative)

#### Band: Группы компании
19. `company_chain` — Цепочка
20. `company_avg_price` — Цена гр. (avg)

#### Band: Покупатель
21. `buyer` — Покупатель
22. `buyer_contract` — Договор
23. `buyer_basis` — Базис
24. `buyer_volume` — Объем, т
25. `buyer_amount` — Сумма дог.
26. `buyer_quotation` — Котировка
27. `buyer_discount` — Скидка
28. `buyer_preliminary_price` — Цена предв.
29. `buyer_price` — Цена оконч.
30. `buyer_ordered_volume` — Заявлено, т
31. `buyer_shipped_volume` — Отгр., т
32. `buyer_shipped_amount` — Отгр. сумма
33. `buyer_payment` — Оплата
34. `buyer_debt` — Долг (RED if negative)

#### Band: Логистика
35. `forwarder` — Экспедитор
36. `logistics_company_group` — Группа комп.
37. `preliminary_tonnage` — Объем план
38. `preliminary_amount` — Предв. сумма
39. `actual_shipped_volume` — Факт объем
40. `invoice_amount` — Сумма (логистика)
41. `supplier_manager` — Коммерция

**Number Formats:**
- Amount: `#,##0.00;[Red]-#,##0.00`
- Volume: `#,##0.000;[Red]-#,##0.000`
- Price: `#,##0.0000`

**Styling:**
- Title row: bold 13pt, dark background (#1C1917), light text
- Band headers: merged per band, per-band fill color (amber, purple, blue)
- Column headers: bold 10pt, dark background, golden border-bottom
- Data rows: Calibri 10pt, alternating zebra
- Autofilter on row 3

---

### Quotations Export (src/lib/exports/quotations-excel.ts)

**File Output:** `quotations-{productSlug}-{year}-{datestamp}.xlsx`

**Sheets:** One per calendar month (Январь 2026, …, Декабрь 2026)

**Per-Sheet Structure:**
- **Row 1:** Merged title (product name · month · row count)
- **Row 2:** Column headers (bold, dark bg, golden underline, frozen)
- **Rows 3+:** Data rows (date + quotation columns, zebra alternating)
- **Rows (month_length + 5):** Spacer (2 blank rows)
- **Following rows:** "Среднее" footer block (one row per numeric column, merged label A-C, average in column D)

**Frozen Panes:** `ySplit=2`

**Column Headers (Dynamic Per Product):**
- Date column: DD.MM.YYYY format
- Product columns per `getColumnsForProduct()`
- Comment column (optional)

**Number Format:** `#,##0.0000` for all price columns

**Среднее (Average) Block:**
- Starts 2 rows after last data row
- For each numeric column: label (merged A-C) + value (column D)
- Background: yellow (#FFFEF3C7), bold 11pt, amber color (#FF92400E)

---

### Quotations Summary (Свод) Export

**File Output:** `quotations-svod-{year}-{datestamp}.xlsx`

**Sheet Name:** `Свод КОТ {year}`

**Structure:**
- **Row 1:** Title with config details
- **Row 2:** Month band headers (merged 3 cells per month for 12 months + "Год")
- **Row 3:** Sub-headers: "Ср", "Фикс", "Тр" repeated 12× + "Год"
- **Rows 4+:** Data rows per product

**Columns:**
1. Product name (width 30)
2–37. 12 months × 3 sub-columns: Ср, Фикс, Тр
38. Year average (yellow background)

**Frozen Panes:** `xSplit=1, ySplit=3`

---

## 4. Email & Messaging

**Status:** No automated email ingester or outbound mailer.

**Buyer Application Inbox:**
- PDF applications uploaded manually via Supabase Storage (bucket: `deal-attachments`)
- No email extraction; no `source_email` field populated by automation
- Applications stored in `applications` table

**Notifications & Toasts:**
- Client-side toast notifications (sonner library) for import/export/upload success/error
- No SMTP / SendGrid / nodemailer integration
- Real-time messaging within deals via `deal_activity` table (chat comments only)

---

## 5. Scheduled Jobs & Cron

### Vercel Cron

**vercel.json:** Minimal config (regions only; no cron entries):
```json
{ "regions": ["fra1"] }
```

### /api/keepalive Route (src/app/api/keepalive/route.ts)

**Purpose:** Keep Supabase connection pool warm.

**Trigger:**
- **Vercel Pro cron:** Intended to fire **every 1 minute** (requires Pro tier)
- **Fallback (Hobby tier):** Dashboard layout fires same ping every 4 minutes client-side
- Route is **intentionally unauthenticated**

**Behavior:**
```typescript
const res = await fetch(`${SB_URL}/rest/v1/deals?select=id&limit=1`, {
  headers: { apikey: SB_ANON, Authorization: `Bearer ${SB_ANON}` },
  cache: "no-store",
});
return { ok: res.ok, elapsed_ms }
```

### Supabase Triggers (Migrations)

- **trg_shipment_refresh_deal** (00011): Recomputes deal totals on shipment changes
- **trg_esf_refresh_deal** (00024): Recomputes invoice totals on ESF changes
- **trg_autoprice_registry_insert** (00037): Creates pricing rows on shipment insert
- **trg_deal_payment_log** (00016/00087): Logs payment changes to activity
- **trg_deal_field_changes** (00088): Logs deal field changes to activity

---

## 6. External API Calls

**No third-party integrations found.**

No calls to:
- Currency APIs
- Geocoding services
- Payment gateways
- Tax/regulatory APIs
- 1C/GTD/Kazakh government endpoints

The app reads from 1C via manual Excel export + client upload; no direct API connection.

---

## 7. Environment Variables

### Supabase Configuration

**NEXT_PUBLIC_SUPABASE_URL**
- Purpose: Supabase project URL
- Example: `https://oteysqqohcgnwpsxmyjg.supabase.co`
- Files: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`

**NEXT_PUBLIC_SUPABASE_ANON_KEY**
- Purpose: Anonymous API key (safe to expose; RLS restricts)
- Files: `src/lib/supabase/client.ts`, `src/app/api/keepalive/route.ts`

**SUPABASE_SERVICE_ROLE_KEY**
- Purpose: Server-only role key (bypasses RLS)
- Used by: Server actions (`src/app/(dashboard)/settings/users/actions.ts`)
- **NEVER expose to browser**

### No Other Integration Variables

---

## 8. File Uploads (Deal Attachments)

**Supabase Storage Bucket:** `deal-attachments` (public bucket)

**Path Convention:**
```
deals/{dealId}/{section}/{category}/{timestamp}-{uuid}{ext}
```

Example: `deals/550e8400-e29b-41d4-a716-446655440000/documents/contract/1718817890000-a1b2c3d4-e5f6-4789-9abc-def012345678.pdf`

**Sections:**
- `documents` (Документы)
- `specifications` (Спецификации)
- `drawings` (Чертежи)
- `other` (Прочее)

**Categories (from ATTACHMENT_CATEGORIES):**
- `contract` — Договор / Приложение
- `snt` — СНТ
- `esf` — ЭСФ
- `waybill` — ЖД накладная
- `act_completed_works` — АКТ выполненных работ
- `invoice` — Счет на оплату
- `quality_cert` — Паспорт качества
- `reconciliation_act` — Акт сверки
- `application` — Заявка (PDF)
- `other` — Прочее

**Upload Flow (lines 1075–1119):**
1. Client creates unique path with `Date.now()` + `randomUUID()`
2. Resolves MIME type from file.type or fallback map
3. Uploads via `supabase.storage.from("deal-attachments").upload(filePath, file, { contentType, cacheControl: "3600", upsert: false })`
4. On success, inserts row into `deal_attachments` table
5. On storage error: hard fail; do NOT create DB row
6. On DB error: attempt cleanup `remove([filePath])`

**Download Flow (lines 1136–1154):**
- Public URL via `supabase.storage.from("deal-attachments").getPublicUrl(filePath)`
- Opens inline for PDFs
- Download option appends `?download={filename}` for Content-Disposition: attachment

**Delete Flow (lines 1121–1129):**
1. Delete row from `deal_attachments` table
2. **Storage cleanup is intentionally NOT automatic** — orphan files may remain

**Size Limits:**
- No explicit size cap in code (Supabase Storage default: 5 GB per file)
- MIME whitelist client-side (`accept=".pdf,.xlsx,.xls,.docx,.doc,.jpg,.jpeg,.png"`)

---

## 9. Realtime Channels

### Channel: `deal-activity-{dealId}`

**Table:** `deal_activity`
**Filter:** `deal_id=eq.{dealId}`
**Event:** INSERT only

**Payload Handling (src/lib/hooks/use-deal-activity.ts:56–72):**
```typescript
.on("postgres_changes", {
  event: "INSERT",
  schema: "public",
  table: "deal_activity",
  filter: `deal_id=eq.${dealId}`,
}, async (payload) => {
  const { data } = await sb.from("deal_activity")
    .select("*, user:profiles(full_name, role)")
    .eq("id", payload.new.id)
    .single();

  if (data) {
    setMessages((prev) => {
      if (prev.some((m) => m.id === data.id)) return prev;
      return [...prev, data];
    });
  }
})
```

**Client Behavior:**
1. Component mounts → load historical messages
2. Subscribe to channel
3. On new INSERT: fetch full record with user join, append to UI, dedup
4. Cleanup: unsubscribe on unmount

### Channel: `app-activity-{applicationId}`

**Table:** `deal_activity` (same table, different filter)
**Filter:** `application_id=eq.{applicationId}`
**Event:** INSERT only

### Realtime Publication

Table `deal_activity` added to Supabase realtime publication in migration 00016:
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE deal_activity;
```

---

## Summary: Integration Patterns

This CRM is **database-centric** with minimal external dependencies:

- **Inbound:** Excel imports (SNT, ESF, registry) → manual upload only; no email ingestion
- **Outbound:** Excel exports (passport, quotations, summary) → client-side generation + browser download
- **Scheduled:** Keepalive ping every 1–4 min (Vercel Pro or client fallback)
- **Realtime:** Supabase Postgres Changes on `deal_activity` (INSERT only) for chat comments
- **File Storage:** Supabase Storage bucket `deal-attachments` (public, 5GB limit per file)
- **Automation:** PostgreSQL triggers for deal total refresh, pricing auto-creation, activity logging
- **Auth:** Supabase Auth + RLS policies; no external SSO
- **No external APIs:** No currency, geocoding, payment, or regulatory integrations

All boundary-crossing logic operates at the database or Next.js server-action layer, with Supabase as the sole backend.
