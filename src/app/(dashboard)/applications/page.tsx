"use client";

import { useState, useEffect } from "react";
import { Plus, Check, X, FileText, Upload, Link2, MessageSquare, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useApplications,
  createApplication,
  updateApplication,
  toggleOrdered,
  type Application,
} from "@/lib/hooks/use-applications";
import { createClient } from "@/lib/supabase/client";
import { formatDMY } from "@/lib/format";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { useApplicationActivity } from "@/lib/hooks/use-deal-activity";
import { useRole } from "@/lib/role-context";
import {
  ApplicationForm, applicationPayload, emptyApplicationValues, resolvedManagerId,
  useApplicationRefs, valuesFromApplication, type ApplicationFormValues, type ApplicationRefs,
} from "@/components/applications/application-form";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { dealLinkStatus, loadDealOptions, localToday, type DealOption } from "@/lib/applications/deal-link";
import Link from "next/link";


function StatusBadge({ ordered }: { ordered: boolean }) {
  return ordered ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 border border-green-200">
      <Check className="h-3 w-3" />
      Заявлено
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 border border-red-200">
      <X className="h-3 w-3" />
      Не заявлено
    </span>
  );
}

function CreateApplicationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const supabase = createClient();
  const refs = useApplicationRefs(open);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<ApplicationFormValues>(() => emptyApplicationValues());
  // Сделку можно выбрать сразу; по умолчанию — «Сделка не создана»
  // (клиент 2026-10-05: «добавить выбор существующей сделки»).
  const [dealId, setDealId] = useState("");
  const dealOptions = useDealOptions(open);
  const { profile } = useRole();

  async function handleSave() {
    if (!values.date) { return; }
    setSaving(true);
    const result = await createApplication(
      applicationPayload(values, refs, resolvedManagerId(values, profile?.id, refs)),
    );
    if (result && dealId) {
      const { error } = await supabase.from("application_deals").insert({
        application_id: result.id,
        deal_id: dealId,
        allocated_volume: null,
      });
      if (error) toast.error(`Заявка создана, но сделка не привязалась: ${error.message}`);
    }
    setSaving(false);
    if (result) {
      setValues(emptyApplicationValues());
      setDealId("");
      onCreated();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая заявка</DialogTitle>
        </DialogHeader>
        <ApplicationForm values={values} onChange={setValues} refs={refs} currentUserId={profile?.id}>
          <div className="col-span-2">
            <Label className="text-[12px] text-stone-500">Сделка</Label>
            <SearchableSelect
              options={[{ value: "", label: "Сделка не создана" }, ...dealOptions.options]}
              value={dealId}
              onChange={setDealId}
              placeholder={dealOptions.loading ? "Загрузка сделок…" : "Сделка не создана"}
              searchPlaceholder="Номер сделки"
              emptyMessage={dealOptions.loading ? "Загрузка сделок…" : "Сделка не найдена"}
              triggerClassName="h-8 text-[13px]"
            />
          </div>
        </ApplicationForm>
        <div className="mt-3">
          <Label className="text-[12px] text-stone-500">Файл заявки (PDF)</Label>
          <input
            type="file"
            accept=".pdf,.xlsx,.xls,.doc,.docx"
            className="w-full h-8 text-[12px] file:mr-2 file:rounded file:border-0 file:bg-amber-50 file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-amber-700 hover:file:bg-amber-100 cursor-pointer"
          />
          <p className="text-[10px] text-stone-400 mt-0.5">PDF, Excel или Word файл от покупателя</p>
        </div>
        <div className="flex gap-2 mt-2">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? "Создание..." : "Создать заявку"}
          </Button>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditApplicationDialog({
  open,
  onClose,
  onSaved,
  application,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  application: Application | null;
}) {
  const refs = useApplicationRefs(open);
  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Редактировать заявку</DialogTitle></DialogHeader>
        {/* key — форма заново берёт значения из заявки при смене строки,
            без setState в эффекте. */}
        {application && (
          <EditApplicationBody key={application.id} application={application} refs={refs} onClose={onClose} onSaved={onSaved} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditApplicationBody({ application, refs, onClose, onSaved }: {
  application: Application;
  refs: ApplicationRefs;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<ApplicationFormValues>(() => valuesFromApplication(application));

  async function handleSave() {
    setSaving(true);
    const payload = applicationPayload(values, refs, values.managerId ?? "");
    const ok = await updateApplication(application.id, { ...payload, date: payload.date || undefined });
    setSaving(false);
    if (ok) { onSaved(); onClose(); }
  }

  return (
    <>
      <ApplicationForm values={values} onChange={setValues} refs={refs} />
      <div className="flex gap-2 mt-2">
        <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? "Сохранение..." : "Сохранить"}</Button>
        <Button variant="outline" onClick={onClose}>Отмена</Button>
      </div>
    </>
  );
}

/**
 * Сделки для выбора — все неархивные, постранично (сделок больше 1000,
 * а PostgREST отдаёт не больше 1000 за раз). Пока грузятся — «Загрузка
 * сделок…», а не «Сделка не найдена».
 */
function useDealOptions(open: boolean): { options: { value: string; label: string }[]; loading: boolean } {
  const [deals, setDeals] = useState<DealOption[] | null>(null);
  useEffect(() => {
    if (!open || deals) return;
    let cancelled = false;
    loadDealOptions()
      .then((rows) => { if (!cancelled) setDeals(rows); })
      .catch((e: { message?: string }) => {
        if (!cancelled) { toast.error(`Сделки не загрузились: ${e.message ?? e}`); setDeals([]); }
      });
    return () => { cancelled = true; };
  }, [open, deals]);
  return {
    options: (deals ?? []).map((d) => ({ value: d.id, label: d.deal_code })),
    loading: deals == null,
  };
}

function LinkDealDialog({
  open,
  onClose,
  applicationId,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  applicationId: string;
  onLinked: () => void;
}) {
  const supabase = createClient();
  const dealOptions = useDealOptions(open);
  const [dealId, setDealId] = useState("");
  const [volume, setVolume] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleLink() {
    if (!dealId) return;
    setSaving(true);
    const { error } = await supabase.from("application_deals").insert({
      application_id: applicationId,
      deal_id: dealId,
      allocated_volume: volume ? parseFloat(volume) : null,
    });
    setSaving(false);
    if (error) {
      toast.error(`Ошибка: ${error.message}`);
    } else {
      toast.success("Заявка привязана к сделке");
      onLinked();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Привязать к сделке</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-[12px] text-stone-500">Сделка</Label>
            <SearchableSelect
              options={dealOptions.options}
              value={dealId}
              onChange={setDealId}
              placeholder={dealOptions.loading ? "Загрузка сделок…" : "Выберите сделку..."}
              searchPlaceholder="Номер сделки"
              emptyMessage={dealOptions.loading ? "Загрузка сделок…" : "Сделка не найдена"}
              triggerClassName="h-8 text-[13px]"
            />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Выделенный объем (тонн)</Label>
            <Input type="number" step="0.01" value={volume} onChange={(e) => setVolume(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <Button onClick={handleLink} disabled={saving || !dealId} className="w-full">
            {saving ? "Привязка..." : "Привязать"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Объявлены на уровне модуля, а не внутри диалогов: компонент,
// созданный во время рендера, пересоздаётся на каждой перерисовке и
// теряет состояние вместе с фокусом. Оба берут всё из пропсов.
export default function ApplicationsPage() {
  const { data: applications, loading, reload } = useApplications();
  const [search, setSearch] = useState("");
  // «Без сделки» — заявки, к которым ещё не привязана ни одна сделка.
  const [dealFilter, setDealFilter] = useState<"all" | "unlinked" | "linked">("all");
  const [today] = useState(() => localToday());
  const [showCreate, setShowCreate] = useState(false);
  const [linkAppId, setLinkAppId] = useState<string | null>(null);

  const filtered = applications.filter((a) => {
    const linked = (a.deal_links?.length ?? 0) > 0;
    if (dealFilter === "unlinked" && linked) return false;
    if (dealFilter === "linked" && !linked) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.application_number?.toLowerCase().includes(q) ||
      a.product_name?.toLowerCase().includes(q) ||
      a.consignee_name?.toLowerCase().includes(q) ||
      a.fuel_type?.name?.toLowerCase().includes(q)
    );
  });

  async function handleToggle(app: Application) {
    const ok = await toggleOrdered(app.id, app.is_ordered);
    if (ok) reload();
  }

  const [chatAppId, setChatAppId] = useState<string | null>(null);
  const [editApp, setEditApp] = useState<Application | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Заявки</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Новая заявка
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Поиск по номеру, продукту, грузополучателю..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm h-7 text-[12px]"
        />
        <select
          value={dealFilter}
          onChange={(e) => setDealFilter(e.target.value as typeof dealFilter)}
          className="h-7 rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none cursor-pointer"
        >
          <option value="all">Все заявки</option>
          <option value="unlinked">Без сделки</option>
          <option value="linked">Со сделкой</option>
        </select>
        <span className="text-[11px] text-stone-400 ml-auto">{filtered.length} заявок</span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white py-12 text-center">
          <FileText className="h-8 w-8 text-stone-300 mx-auto mb-2" />
          <p className="text-sm text-stone-500">Нет заявок</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Создать первую заявку
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow className="bg-stone-50">
                <TableHead className="text-[11px] w-[70px]">№</TableHead>
                <TableHead className="text-[11px]">Дата</TableHead>
                <TableHead className="text-[11px]">ГСМ</TableHead>
                <TableHead className="text-right text-[11px]">Тоннаж</TableHead>
                <TableHead className="text-[11px]">Ст. назначения</TableHead>
                <TableHead className="text-[11px]">Грузополучатель</TableHead>
                <TableHead className="text-[11px]">Коммерция</TableHead>
                <TableHead className="text-[11px] text-center">Статус</TableHead>
                <TableHead className="text-[11px]">Привязка</TableHead>
                <TableHead className="text-[11px]">Сделка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((app) => (
                <TableRow key={app.id} className="hover:bg-amber-50/30">
                  <TableCell className="font-mono text-[12px] text-stone-600">
                    {app.application_number ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600">
                    {formatDMY(app.date)}
                  </TableCell>
                  <TableCell className="text-[12px]">
                    {app.fuel_type ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: app.fuel_type.color }} />
                        {app.fuel_type.name}
                      </span>
                    ) : app.product_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums">
                    {app.tonnage != null ? app.tonnage.toLocaleString("ru-RU", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : ""}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600">
                    {app.destination_station?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-600 max-w-[140px] truncate">
                    {app.consignee_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-[12px] text-stone-500">
                    {app.assigned_manager?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="text-center">
                    <button onClick={() => handleToggle(app)} className="cursor-pointer">
                      <StatusBadge ordered={app.is_ordered} />
                    </button>
                  </TableCell>
                  <TableCell className="text-[11px]">
                    <DealLinkCell app={app} today={today} />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <button onClick={() => setEditApp(app)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-stone-600 hover:bg-stone-50 border border-stone-200">
                        <Pencil className="h-3 w-3" /> Ред.
                      </button>
                      <button onClick={() => setLinkAppId(app.id)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-amber-600 hover:bg-amber-50 border border-amber-200">
                        <Link2 className="h-3 w-3" /> Сделка
                      </button>
                      <button onClick={() => setChatAppId(app.id)}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-blue-600 hover:bg-blue-50 border border-blue-200">
                        <MessageSquare className="h-3 w-3" /> Чат
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <button onClick={async () => {
                      if (!confirm("Удалить заявку?")) return;
                      const sb = createClient();
                      const { error } = await sb.from("applications").delete().eq("id", app.id);
                      if (error) toast.error(error.message); else { toast.success("Удалено"); reload(); }
                    }} className="rounded p-1 text-stone-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Монтируем только открытым: иначе поля (и выбранная сделка)
          прошлой заявки оставались в форме следующей. */}
      {showCreate && (
        <CreateApplicationDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={reload}
        />
      )}

      <EditApplicationDialog
        open={editApp != null}
        onClose={() => setEditApp(null)}
        onSaved={reload}
        application={editApp}
      />

      {linkAppId && (
        <LinkDealDialog
          open={!!linkAppId}
          onClose={() => setLinkAppId(null)}
          applicationId={linkAppId}
          onLinked={reload}
        />
      )}

      {chatAppId && (
        <Dialog open={!!chatAppId} onOpenChange={() => setChatAppId(null)}>
          <DialogContent className="max-w-lg h-[500px] flex flex-col">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-[14px]">Чат по заявке</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-hidden">
              <AppChatWrapper applicationId={chatAppId} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Привязанные сделки или «Сделка не создана · N дн.» (с 8-го дня — красным). */
function DealLinkCell({ app, today }: { app: Application; today: string }) {
  const links = app.deal_links ?? [];
  const st = dealLinkStatus(app.date, links.length, today);
  if (st.kind === "linked") {
    return (
      <span className="flex flex-wrap gap-1">
        {links.map((l) => (
          <Link key={l.deal_id} href={`/deals/${l.deal_id}`} className="font-mono text-amber-700 hover:underline">
            {l.deal?.deal_code ?? "сделка"}
          </Link>
        ))}
      </span>
    );
  }
  return st.kind === "overdue" ? (
    <span className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700" title="Заявка без сделки 8 дней и дольше">
      Не привязана · {st.days} дн.
    </span>
  ) : (
    <span className="whitespace-nowrap text-stone-500">Сделка не создана · {st.days} дн.</span>
  );
}

function AppChatWrapper({ applicationId }: { applicationId: string }) {
  const { messages, loading, sendMessage } = useApplicationActivity(applicationId);
  return <ActivityFeed messages={messages} loading={loading} sendMessage={sendMessage} />;
}
