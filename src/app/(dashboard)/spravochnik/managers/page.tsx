"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { Info } from "lucide-react";
import { CrudTable } from "@/components/shared/crud-table";
import { useSupabaseTable } from "@/lib/hooks/use-references";

type Profile = {
  id?: string;
  full_name?: string;
  role?: string;
  is_active?: boolean;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  operator: "Оператор",
  viewer: "Наблюдатель",
};

const columns: ColumnDef<Profile, unknown>[] = [
  {
    accessorKey: "full_name",
    header: "ФИО",
    cell: ({ row }) => row.original.full_name ?? "—",
  },
  {
    accessorKey: "role",
    header: "Роль",
    cell: ({ row }) => {
      const val = row.original.role;
      return val ? (ROLE_LABELS[val] ?? val) : "—";
    },
  },
  {
    accessorKey: "is_active",
    header: "Активен",
    cell: ({ row }) =>
      row.original.is_active !== false ? (
        <span className="text-green-600 font-medium">Да</span>
      ) : (
        <span className="text-muted-foreground">Нет</span>
      ),
  },
];

export default function ManagersPage() {
  const { data, loading } = useSupabaseTable<Profile>("profiles", "full_name");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Добавление и редактирование менеджеров доступно в разделе{" "}
          <Link
            href="/settings/users"
            className="font-semibold underline decoration-blue-400 hover:text-blue-900"
          >
            Настройки › Пользователи
          </Link>
          . Здесь отображается список менеджеров в режиме просмотра.
        </span>
      </div>

      <CrudTable<Profile>
        data={data}
        columns={columns}
        title="Менеджеры"
        searchPlaceholder="Поиск менеджера..."
        canEdit={false}
        onSave={async () => {}}
        renderForm={() => null}
      />
    </div>
  );
}
