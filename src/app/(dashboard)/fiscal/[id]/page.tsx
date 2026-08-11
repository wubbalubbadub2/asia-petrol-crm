"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { currencySymbol } from "@/lib/constants/currencies";
import { formatDMY, formatDMYTime, formatMoney } from "@/lib/format";
import { FiscalStateBadge } from "@/components/fiscal/fiscal-state-badge";
import { FiscalPositions } from "@/components/fiscal/fiscal-positions";
import {
  Field,
  FieldGrid,
  FiscalSection,
  Marks,
  RawTable,
} from "@/components/fiscal/fiscal-section";
import { useFiscalDocument, type FiscalLink } from "@/lib/hooks/use-fiscal-document";

/**
 * Карточка фискального документа — по разделам ПЕЧАТНОГО БЛАНКА СНТ.
 *
 * Подписи полей взяты из бланка вместе с номерами: клиент сверяет
 * экран с печатной формой, и «13. ИИН/БИН» он там найдёт. Названий от
 * себя здесь нет. Прежняя подпись «Наша сторона» была придумана нами и
 * убрана: в документе есть поставщик (раздел B) и получатель (раздел
 * C), а own_party — абстракция обработки 1С, зависящая от направления.
 *
 * Маршрут — по `id` (UUID). Учётный номер в маршруте не участвует:
 * он не уникален, «225» встречается у трёх разных СНТ за 2023–2025.
 */
export default function FiscalDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { doc, lines, corrects, correctedBy, relatedSnt, loading, error } = useFiscalDocument(id);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Регистрационный номер скопирован");
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  if (loading) return <div className="px-4 py-6 text-[13px] text-stone-500">Загрузка…</div>;
  if (error || !doc) {
    return (
      <div className="px-4 py-6">
        <div className="mb-3 text-[13px] text-red-600">{error ?? "Документ не найден"}</div>
        <Link href="/fiscal" className="text-[13px] text-amber-700 hover:underline">
          ← к реестру
        </Link>
      </div>
    );
  }

  const sym = currencySymbol(doc.currency_code, doc.currency_code);
  const isSnt = doc.doc_kind === "snt";
  const kindLabel = isSnt ? "СНТ" : "ЭСФ";
  const country = (c: string | null) => c || null;
  const extra = doc.extra_tables ?? {};

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Шапка */}
      <div className="border-b border-stone-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Тот же компонент и то же поведение, что на карточке сделки:
              возврат через историю сохраняет ?filters списка (nuqs). */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (typeof window !== "undefined" && window.history.length > 1) router.back();
              else router.push("/fiscal");
            }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-bold font-mono">
            {kindLabel} № {doc.doc_number_display || "—"}
          </h1>
          <FiscalStateBadge code={doc.state_code} label={doc.state_label} />
          {doc.is_void && (
            <span className="rounded-sm bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 ring-1 ring-inset ring-red-600/20">
              гашеный
            </span>
          )}
          {doc.is_superseded && (
            <span className="rounded-sm bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 ring-1 ring-inset ring-stone-500/20">
              исправлен более поздним
            </span>
          )}
          <span className="ml-auto font-mono text-[13px] font-semibold tabular-nums text-stone-900">
            {formatMoney(doc.total_amount)} {sym}
          </span>
        </div>

        <div className="mt-1 flex items-center gap-1">
          <span className="font-mono text-[11px] tabular-nums text-stone-500">
            {doc.registration_number}
          </span>
          <button
            type="button"
            onClick={() => void copy(doc.registration_number)}
            aria-label="Скопировать регистрационный номер"
            className="rounded p-0.5 text-stone-300 hover:bg-stone-100 hover:text-stone-600"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>

        {(corrects || correctedBy || relatedSnt) && (
          <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
            {corrects && <LinkRow label="Исправляет" link={corrects} />}
            {correctedBy && <LinkRow label="Исправлен документом" link={correctedBy} />}
            {relatedSnt && <LinkRow label="СНТ" link={relatedSnt} />}
          </div>
        )}
      </div>

      {/* Раздел A */}
      <FiscalSection title="Раздел A. Общий раздел">
        <FieldGrid>
          <Field label="1. Номер СНТ учетной системы" value={doc.doc_number_display} mono always />
          <Field label="3.1. Дата и время регистрации" value={formatDMYTime(doc.registration_date)} mono />
          <Field label="2. Дата отгрузки товара" value={formatDMY(doc.shipment_date)} mono />
          <Field label="Дата выписки" value={formatDMY(doc.issue_date)} mono />
          <Field label="5. Тип" value={doc.doc_type_label ?? doc.doc_type_code} />
          <Field label="Направление" value={doc.direction_code} />
          <Field label="Статус" value={doc.status_label ?? doc.status_code} />
          <Field label="Состояние" value={doc.state_label ?? doc.state_code} />
          <Field label="Вид операции" value={doc.operation_kind_label ?? doc.operation_kind_code} />
          <Field label="7. Ввоз товаров на территорию РК" value={doc.import_kind} />
          <Field label="8. Вывоз товаров с территории РК" value={doc.export_kind} />
          <Field label="9. Перемещение товаров" value={doc.movement_kind} />
          <Field label="49. Код валюты" value={doc.currency_code} mono />
          <Field
            label="50. Курс валюты"
            value={doc.fx_rate === 1 ? null : String(doc.fx_rate)}
            hint="пересчёт не выполняется"
            mono
          />
        </FieldGrid>
        <Marks
          items={[
            ["10.1. Этиловый спирт", doc.has_ethyl_alcohol],
            ["10.2. Вино наливом", doc.has_wine_material],
            ["10.3. Пивоваренная продукция", doc.has_beer],
            ["10.4. Алкогольная продукция", doc.has_alcohol],
            ["10.5. Нефтепродукты", doc.has_oil_products],
            ["10.6. Биотопливо", doc.has_biofuel],
            ["10.7. Табачные изделия", doc.has_tobacco],
            ["12. Подлежащие маркировке", doc.has_marked_goods],
            ["11. Экспортный контроль", doc.has_export_control],
          ]}
        />
      </FiscalSection>

      {/* Разделы B и C */}
      <FiscalSection title="Раздел B. Реквизиты поставщика">
        <FieldGrid>
          <Field label="13. ИИН/БИН" value={doc.supplier_identifier} mono always />
          <Field label="14. Наименование поставщика/отправителя" value={doc.supplier_name} always />
          <Field label="13.1. Нерезидент" value={doc.supplier_is_nonresident ? "☑ да" : null} />
          <Field label="15. БИН структурного подразделения" value={doc.supplier_branch_bin} mono />
          <Field label="18. Код страны регистрации" value={country(doc.supplier_country_code)} mono />
          <Field label="19. Код страны отправки/отгрузки" value={country(doc.supplier_ship_country_code)} mono />
          <Field label="20. Фактический адрес отправки" value={doc.supplier_address} />
          <Field label="21. Идентификационный номер (ID) склада" value={doc.supplier_warehouse_id} mono hint={doc.supplier_warehouse_name} />
        </FieldGrid>
      </FiscalSection>

      <FiscalSection title="Раздел C. Реквизиты получателя">
        <FieldGrid>
          <Field label="22. ИИН/БИН" value={doc.recipient_identifier} mono always />
          <Field label="23. Наименование получателя" value={doc.recipient_name} always />
          <Field label="22.1. Нерезидент" value={doc.recipient_is_nonresident ? "☑ да" : null} />
          <Field label="24. БИН структурного подразделения" value={doc.recipient_branch_bin} mono />
          <Field label="27. Код страны регистрации" value={country(doc.recipient_country_code)} mono />
          <Field label="28. Код страны доставки/поставки" value={country(doc.recipient_delivery_country_code)} mono />
          <Field label="29. Фактический адрес доставки" value={doc.recipient_address} />
          <Field label="30. Идентификационный номер (ID) склада" value={doc.recipient_warehouse_id} mono hint={doc.recipient_warehouse_name} />
          <Field label="Розничный реализатор" value={doc.recipient_is_retailer ? "☑ да" : null} />
        </FieldGrid>
      </FiscalSection>

      {/* Раздел D */}
      {(doc.shipper_identifier || doc.shipper_name || doc.consignee_identifier || doc.consignee_name) && (
        <FiscalSection title="Раздел D. Грузоотправитель и грузополучатель">
          <FieldGrid>
            <Field label="31. ИИН/БИН грузоотправителя" value={doc.shipper_identifier} mono />
            <Field label="34. ИИН/БИН грузополучателя" value={doc.consignee_identifier} mono />
            <Field label="32. Наименование грузоотправителя" value={doc.shipper_name} />
            <Field label="35. Наименование грузополучателя" value={doc.consignee_name} />
            <Field label="33. Код страны отправки" value={country(doc.shipper_country_code)} mono />
            <Field label="36. Код страны доставки" value={country(doc.consignee_country_code)} mono />
            <Field label="31.1. Нерезидент" value={doc.shipper_is_nonresident ? "☑ да" : null} />
            <Field label="34.1. Нерезидент" value={doc.consignee_is_nonresident ? "☑ да" : null} />
            <Field label="D1a. Дополнительные сведения" value={doc.shipper_note} />
            <Field label="D1b. Дополнительные сведения" value={doc.consignee_note} />
          </FieldGrid>
        </FiscalSection>
      )}

      {/* Раздел E */}
      {(doc.carrier_name || doc.wagon_number || doc.vehicle_number || doc.transport_rail || doc.transport_pipeline) && (
        <FiscalSection title="Раздел E. Сведения по перевозке">
          <FieldGrid>
            <Field label="37. Наименование перевозчика" value={doc.carrier_name} />
            <Field label="38. ИИН/БИН перевозчика" value={doc.carrier_identifier} mono />
            <Field label="39.b.1 Номер вагона" value={doc.wagon_number} mono />
            <Field label="39.a.1 Государственный номер АТС" value={doc.vehicle_number} mono />
            <Field label="39.a.2 Государственный номер прицепа" value={doc.trailer_number} mono />
            <Field label="Номер оттиска пломбы" value={doc.seal_number} mono />
          </FieldGrid>
          <Marks
            items={[
              ["39.a автомобильный", doc.transport_road],
              ["39.b железнодорожный", doc.transport_rail],
              ["39.c воздушный", doc.transport_air],
              ["39.d морской или внутренний водный", doc.transport_sea],
              ["39.e трубопровод", doc.transport_pipeline],
              ["39.f мультимодальный", doc.transport_other],
            ]}
          />
        </FiscalSection>
      )}

      {/* Раздел F */}
      <FiscalSection title="Раздел F. Договор (контракт) на поставку товара">
        <FieldGrid>
          <Field
            label="41. Номер"
            value={doc.contract_number}
            hint="договор либо приложение — по бланку это одно поле"
            mono
            always
          />
          <Field label="42. Дата договора (контракта)" value={formatDMY(doc.contract_date)} mono />
          <Field label="42.1. Учетный номер" value={doc.contract_registry_number} mono />
          <Field label="43. Условия оплаты по договору" value={doc.payment_terms} />
          <Field label="44. Условия поставки (ИНКОТЕРМС)" value={doc.delivery_terms} />
          <Field label="40.b Без договора (контракта)" value={doc.without_contract ? "☑ да" : null} />
          <Field label="Полный текст договора в 1С" value={doc.contract_text} />
        </FieldGrid>
      </FiscalSection>

      {/* Раздел G1 */}
      <FiscalSection title="Раздел G1. Данные по товарам" count={lines.length}>
        <FiscalPositions
          lines={lines}
          currency={doc.currency_code}
          onLotClick={(lot) => {
            // Партия ищется по всему реестру: приход её создаёт,
            // расход списывает — так видно происхождение товара.
            router.push(`/fiscal?q=${encodeURIComponent(lot)}&chain=1`);
          }}
        />
      </FiscalSection>

      {/* Разделы L, M, N */}
      <FiscalSection title="Разделы L, M, N. Отпуск, приёмка, отметки ОГД" defaultOpen={false}>
        <FieldGrid>
          <Field label="82. Ф.И.О. лица, оформившего СНТ" value={doc.issued_by_name} />
          <Field label="86. Ф.И.О. лица, принявшего товар" value={doc.accepted_by_name} />
          <Field label="80. Тип подписи" value={doc.signature_type} />
          <Field label="85. Дата приема/отклонения товара" value={formatDMYTime(doc.accepted_at)} mono />
          <Field label="Прием произвел (ИИН/БИН)" value={doc.accepted_by_identifier} mono />
          <Field label="Дата отзыва" value={formatDMYTime(doc.revoked_at)} mono />
          <Field label="83.1. Номер доверенности на отпуск" value={doc.proxy_release_number} mono hint={formatDMY(doc.proxy_release_date) || null} />
          <Field label="86.2. Номер доверенности на приёмку" value={doc.proxy_receipt_number} mono hint={formatDMY(doc.proxy_receipt_date) || null} />
          <Field label="90.3. Ф.И.О. водителя" value={doc.driver_name} />
          <Field label="90.4. ИИН водителя" value={doc.driver_iin} mono />
          <Field label="Код ОГД отправки" value={doc.ogd_code_dispatch} mono />
          <Field label="Код ОГД доставки" value={doc.ogd_code_delivery} mono />
        </FieldGrid>
      </FiscalSection>

      {/* Прочие табличные части документа */}
      {Object.entries(extra).map(([name, rows]) => (
        <FiscalSection key={name} title={`Табличная часть: ${name}`} defaultOpen={false} count={rows.length}>
          <RawTable rows={rows} />
        </FiscalSection>
      ))}

      {/* Служебное 1С — в бланке не печатается */}
      <FiscalSection title="Служебные поля 1С" defaultOpen={false}>
        <FieldGrid>
          <Field label="Организация" value={doc.source_organization} />
          <Field label="Документ-основание" value={doc.source_doc_basis} />
          <Field label="Номер документа в 1С" value={doc.source_doc_number} mono />
          <Field label="Пояснение к состоянию" value={doc.status_note} />
          <Field label="Статус сопоставления" value={doc.matching_status} />
          <Field label="Идентификатор ИС ЭСФ" value={doc.source_identifier} mono />
          <Field label="Ссылка 1С" value={doc.source_ref} mono />
          <Field label="Автор" value={doc.author} />
          <Field label="Строк в документе" value={String(doc.line_count)} mono />
        </FieldGrid>
      </FiscalSection>
    </div>
  );
}

function LinkRow({ label, link }: { label: string; link: NonNullable<FiscalLink> }) {
  return (
    <span>
      <span className="text-stone-400">{label} </span>
      <Link
        href={`/fiscal/${link.id}`}
        className="font-mono tabular-nums text-amber-700 hover:underline"
        title={link.registration_number}
      >
        № {link.doc_number_display || link.registration_number}
      </Link>
    </span>
  );
}
