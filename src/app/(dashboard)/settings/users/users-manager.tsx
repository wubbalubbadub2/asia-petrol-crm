"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Key, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  createUserAction,
  updateUserAction,
  resetPasswordAction,
  deleteUserAction,
  type UserRole,
} from "./actions";

type Row = {
  id: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
};

const ROLES: { value: UserRole; label: string }[] = [
  { value: "admin", label: "Администратор" },
  { value: "manager", label: "Менеджер" },
  { value: "logistics", label: "Логистика" },
  { value: "accounting", label: "Бухгалтерия" },
  { value: "readonly", label: "Только чтение" },
];

function roleLabel(r: UserRole) {
  return ROLES.find((x) => x.value === r)?.label ?? r;
}

export function UsersManager({ initialRows }: { initialRows: Row[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [pwdRow, setPwdRow] = useState<Row | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Пользователи системы</h2>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Добавить пользователя
        </Button>
      </div>

      <div className="rounded-md border border-stone-200 bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-stone-50">
              <TableHead className="text-[11px]">ФИО</TableHead>
              <TableHead className="text-[11px]">Email</TableHead>
              <TableHead className="text-[11px]">Роль</TableHead>
              <TableHead className="text-[11px]">Активен</TableHead>
              <TableHead className="text-[11px] w-[110px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  Нет пользователей
                </TableCell>
              </TableRow>
            ) : (
              initialRows.map((r) => (
                <TableRow key={r.id} className="hover:bg-amber-50/30">
                  <TableCell className="text-[12px]">{r.full_name}</TableCell>
                  <TableCell className="text-[12px] text-stone-500">{r.email ?? "—"}</TableCell>
                  <TableCell className="text-[12px]">{roleLabel(r.role)}</TableCell>
                  <TableCell className="text-[12px]">
                    {r.is_active ? (
                      <span className="text-green-600 font-medium">Да</span>
                    ) : (
                      <span className="text-muted-foreground">Нет</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <button
                        title="Редактировать"
                        onClick={() => setEditRow(r)}
                        className="rounded p-1 text-stone-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        title="Сбросить пароль"
                        onClick={() => setPwdRow(r)}
                        className="rounded p-1 text-stone-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        <Key className="h-3 w-3" />
                      </button>
                      <DeleteButton row={r} />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить пользователя</DialogTitle>
          </DialogHeader>
          <AddForm onDone={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editRow !== null} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать пользователя</DialogTitle>
          </DialogHeader>
          {editRow && <EditForm row={editRow} onDone={() => setEditRow(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={pwdRow !== null} onOpenChange={(o) => !o && setPwdRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сбросить пароль</DialogTitle>
          </DialogHeader>
          {pwdRow && <PasswordForm row={pwdRow} onDone={() => setPwdRow(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "manager" as UserRole,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.full_name || !form.password) {
      toast.error("Заполните все поля");
      return;
    }
    start(async () => {
      const res = await createUserAction(form);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Пользователь создан");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label>ФИО <span className="text-destructive">*</span></Label>
        <Input
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          placeholder="Иванов Иван Иванович"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Email <span className="text-destructive">*</span></Label>
        <Input
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="user@company.kz"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Пароль <span className="text-destructive">*</span></Label>
        <Input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder="Минимум 6 символов"
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Роль</Label>
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
          className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Создание..." : "Создать"}
        </Button>
      </div>
    </form>
  );
}

function EditForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    full_name: row.full_name,
    role: row.role,
    is_active: row.is_active,
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await updateUserAction({ id: row.id, ...form });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Сохранено");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-2">
      <div className="space-y-1.5">
        <Label>Email</Label>
        <Input value={row.email ?? ""} disabled />
        <p className="text-[11px] text-stone-500">Email изменить нельзя</p>
      </div>
      <div className="space-y-1.5">
        <Label>ФИО</Label>
        <Input
          value={form.full_name}
          onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Роль</Label>
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}
          className="h-8 w-full rounded-md border border-stone-200 bg-white px-2 text-[12px] focus:border-amber-400 focus:outline-none"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="edit_active"
          checked={form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          className="h-4 w-4 rounded border-input"
        />
        <Label htmlFor="edit_active">Активен</Label>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Сохранение..." : "Сохранить"}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({ row, onDone }: { row: Row; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Минимум 6 символов");
      return;
    }
    start(async () => {
      const res = await resetPasswordAction({ id: row.id, password });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Пароль обновлён");
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pt-2">
      <p className="text-[12px] text-stone-600">
        Новый пароль для <strong>{row.full_name}</strong> ({row.email ?? "—"})
      </p>
      <div className="space-y-1.5">
        <Label>Новый пароль</Label>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Отмена
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Обновление..." : "Обновить пароль"}
        </Button>
      </div>
    </form>
  );
}

function DeleteButton({ row }: { row: Row }) {
  const [pending, start] = useTransition();
  function handle() {
    if (!confirm(`Удалить пользователя ${row.full_name}?\n\nУчётная запись и профиль будут удалены безвозвратно.`)) return;
    start(async () => {
      const res = await deleteUserAction({ id: row.id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Удалено");
    });
  }
  return (
    <button
      title="Удалить"
      onClick={handle}
      disabled={pending}
      className="rounded p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
    >
      <Trash2 className="h-3 w-3" />
    </button>
  );
}
