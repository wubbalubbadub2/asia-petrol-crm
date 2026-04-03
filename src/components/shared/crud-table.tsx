"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { Plus, Pencil, Trash2, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type CrudTableProps<T> = {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  title: string;
  searchPlaceholder?: string;
  renderForm: (props: {
    item: T | null;
    onSave: (item: Partial<T>) => Promise<void>;
    onClose: () => void;
  }) => React.ReactNode;
  onDelete?: (item: T) => Promise<void>;
  onSave: (item: Partial<T>, isEdit: boolean) => Promise<void>;
  canEdit?: boolean;
  getRowId?: (item: T) => string;
};

export function CrudTable<T extends { id?: string }>({
  data,
  columns,
  title,
  searchPlaceholder = "Поиск...",
  renderForm,
  onDelete,
  onSave,
  canEdit = true,
  getRowId,
}: CrudTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<T | null>(null);

  const allColumns: ColumnDef<T, unknown>[] = [
    ...columns,
    ...(canEdit
      ? [
          {
            id: "actions",
            header: "",
            size: 60,
            cell: ({ row }: { row: { original: T } }) => (
              <div className="flex gap-0.5">
                <button
                  onClick={() => { setEditItem(row.original); setDialogOpen(true); }}
                  className="rounded p-1 text-stone-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                {onDelete && (
                  <button
                    onClick={() => onDelete(row.original)}
                    className="rounded p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ),
          } satisfies ColumnDef<T, unknown>,
        ]
      : []),
  ];

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  async function handleSave(values: Partial<T>) {
    await onSave(values, editItem !== null);
    setDialogOpen(false);
    setEditItem(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        {canEdit && (
          <Button
            onClick={() => {
              setEditItem(null);
              setDialogOpen(true);
            }}
            size="sm"
          >
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        )}
      </div>

      <Input
        placeholder={searchPlaceholder}
        value={globalFilter}
        onChange={(e) => setGlobalFilter(e.target.value)}
        className="max-w-sm h-7 text-[12px]"
      />

      <div className="rounded-md border border-stone-200 bg-white overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="bg-stone-50">
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="text-[11px]">
                    {header.isPlaceholder ? null : (
                      <div
                        className={
                          header.column.getCanSort()
                            ? "flex cursor-pointer select-none items-center gap-1"
                            : ""
                        }
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getCanSort() && (
                          <ArrowUpDown className="h-3 w-3 text-stone-400" />
                        )}
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-amber-50/30">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="text-[12px]">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={allColumns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  Нет данных
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editItem ? "Редактировать" : "Добавить"}
            </DialogTitle>
          </DialogHeader>
          {renderForm({
            item: editItem,
            onSave: handleSave,
            onClose: () => {
              setDialogOpen(false);
              setEditItem(null);
            },
          })}
        </DialogContent>
      </Dialog>
    </div>
  );
}
