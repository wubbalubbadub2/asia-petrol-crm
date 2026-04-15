"use client";

import { useState, useEffect } from "react";
import { Plus, Check, X, FileText, Upload, Link2, MessageSquare, Trash2 } from "lucide-react";
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
  toggleOrdered,
  type Application,
} from "@/lib/hooks/use-applications";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { useApplicationActivity } from "@/lib/hooks/use-deal-activity";

type RefOption = { id: string; name: string };
type ProfileOption = { id: string; full_name: string };

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
  const [fuelTypes, setFuelTypes] = useState<RefOption[]>([]);
  const [stations, setStations] = useState<RefOption[]>([]);
  const [managers, setManagers] = useState<ProfileOption[]>([]);
  const [saving, setSaving] = useState(false);

  const [appNumber, setAppNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [productName, setProductName] = useState("");
  const [tonnage, setTonnage] = useState("");
  const [stationId, setStationId] = useState("");
  const [stationCode, setStationCode] = useState("");
  const [consigneeName, setConsigneeName] = useState("");
  const [consigneeBin, setConsigneeBin] = useState("");
  const [consignor, setConsignor] = useState("");
  const [carrier, setCarrier] = useState("");
  const [managerId, setManagerId] = useState("");
  const [sourceEmail, setSourceEmail] = useState("");

  useEffect(() => {
    if (!open) return;
    Promise.all([
      supabase.from("fuel_types").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("stations").select("id, name").eq("is_active", true).order("name"),
      supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    ]).then(([ft, st, m]) => {
      setFuelTypes((ft.data ?? []) as RefOption[]);
      setStations((st.data ?? []) as RefOption[]);
      setManagers((m.data ?? []) as ProfileOption[]);
    });
  }, [open, supabase]);

  async function handleSave() {
    if (!date) { return; }
    setSaving(true);
    const result = await createApplication({
      application_number: appNumber || null,
      date,
      fuel_type_id: fuelTypeId || null,
      product_name: productName || null,
      tonnage: tonnage ? parseFloat(tonnage) : null,
      destination_station_id: stationId || null,
      station_code: stationCode || null,
      consignee_name: consigneeName || null,
      consignee_bin: consigneeBin || null,
      consignor: consignor || null,
      carrier: carrier || null,
      assigned_manager_id: managerId || null,
      source_email: sourceEmail || null,
    });
    setSaving(false);
    if (result) {
      onCreated();
      onClose();
    }
  }

  function SelectField({
    label, value, onChange, options,
  }: {
    label: string; value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) {
    return (
      <div>
        <Label className="text-[12px] text-stone-500">{label}</Label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
        >
          <option value="">Выберите...</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая заявка</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-[12px] text-stone-500">№ заявки</Label>
            <Input value={appNumber} onChange={(e) => setAppNumber(e.target.value)} placeholder="239" className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Дата</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <SelectField
            label="Вид ГСМ"
            value={fuelTypeId}
            onChange={setFuelTypeId}
            options={fuelTypes.map((f) => ({ value: f.id, label: f.name }))}
          />
          <div>
            <Label className="text-[12px] text-stone-500">Продукт (текст)</Label>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="АИ 92" className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Тоннаж</Label>
            <Input type="number" step="0.01" value={tonnage} onChange={(e) => setTonnage(e.target.value)} className="h-8 text-[13px] font-mono" />
          </div>
          <SelectField
            label="Станция назначения"
            value={stationId}
            onChange={setStationId}
            options={stations.map((s) => ({ value: s.id, label: s.name }))}
          />
          <div>
            <Label className="text-[12px] text-stone-500">Код станции</Label>
            <Input value={stationCode} onChange={(e) => setStationCode(e.target.value)} placeholder="700204" className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Грузополучатель</Label>
            <Input value={consigneeName} onChange={(e) => setConsigneeName(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">БИН грузополучателя</Label>
            <Input value={consigneeBin} onChange={(e) => setConsigneeBin(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Грузоотправитель</Label>
            <Input value={consignor} onChange={(e) => setConsignor(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <div>
            <Label className="text-[12px] text-stone-500">Перевозчик</Label>
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} className="h-8 text-[13px]" />
          </div>
          <SelectField
            label="Ответственный менеджер"
            value={managerId}
            onChange={setManagerId}
            options={managers.map((m) => ({ value: m.id, label: m.full_name }))}
          />
          <div className="col-span-2">
            <Label className="text-[12px] text-stone-500">Email источника</Label>
            <Input value={sourceEmail} onChange={(e) => setSourceEmail(e.target.value)} placeholder="buyer@company.com" className="h-8 text-[13px]" />
          </div>
          <div className="col-span-2">
            <Label className="text-[12px] text-stone-500">Файл заявки (PDF)</Label>
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.doc,.docx"
              className="w-full h-8 text-[12px] file:mr-2 file:rounded file:border-0 file:bg-amber-50 file:px-2 file:py-1 file:text-[11px] file:font-medium file:text-amber-700 hover:file:bg-amber-100 cursor-pointer"
            />
            <p className="text-[10px] text-stone-400 mt-0.5">PDF, Excel или Word файл от покупателя</p>
          </div>
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
  const [deals, setDeals] = useState<{ id: string; deal_code: string }[]>([]);
  const [dealId, setDealId] = useState("");
  const [volume, setVolume] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("deals")
      .select("id, deal_code")
      .eq("is_archived", false)
      .order("deal_code")
      .then(({ data }) => setDeals((data ?? []) as { id: string; deal_code: string }[]));
  }, [open, supabase]);

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
            <select
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              className="w-full h-8 rounded-md border border-stone-200 bg-white px-2 text-[13px] focus:border-amber-400 focus:outline-none cursor-pointer"
            >
              <option value="">Выберите сделку...</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>{d.deal_code}</option>
              ))}
            </select>
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

export default function ApplicationsPage() {
  const { data: applications, loading, reload } = useApplications();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [linkAppId, setLinkAppId] = useState<string | null>(null);

  const filtered = applications.filter((a) => {
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
                <TableHead className="text-[11px]">Менеджер</TableHead>
                <TableHead className="text-[11px] text-center">Статус</TableHead>
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
                    {new Date(app.date).toLocaleDateString("ru-RU")}
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
                    {app.tonnage?.toLocaleString("ru-RU") ?? ""}
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
                  <TableCell>
                    <div className="flex gap-1">
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

      <CreateApplicationDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={reload}
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

function AppChatWrapper({ applicationId }: { applicationId: string }) {
  const { messages, loading, sendMessage } = useApplicationActivity(applicationId);
  return <ActivityFeed messages={messages} loading={loading} sendMessage={sendMessage} />;
}
