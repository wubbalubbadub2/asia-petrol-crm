import {
  LayoutDashboard,
  BookOpen,
  TrendingUp,
  FileText,
  ClipboardList,
  Truck,
  Calculator,
  DollarSign,
  AlertTriangle,
  Upload,
  Archive,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: { label: string; href: string }[];
  adminOnly?: boolean;
};

export const navItems: NavItem[] = [
  {
    label: "Главная",
    href: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Справочник",
    href: "/spravochnik",
    icon: BookOpen,
  },
  {
    label: "Котировки",
    href: "/quotations",
    icon: TrendingUp,
  },
  {
    label: "Сделки",
    href: "/deals",
    icon: FileText,
    children: [
      { label: "Паспорт KG", href: "/deals/passport-kg" },
      { label: "Паспорт KZ", href: "/deals/passport-kz" },
    ],
  },
  {
    label: "Заявки",
    href: "/applications",
    icon: ClipboardList,
  },
  {
    label: "Реестр отгрузки",
    href: "/registry",
    icon: Truck,
  },
  {
    label: "ДТ-КТ Логистика",
    href: "/dt-kt",
    icon: Calculator,
  },
  {
    label: "Тарифы",
    href: "/tariffs",
    icon: DollarSign,
  },
  {
    label: "Сверхнормативы",
    href: "/surcharges",
    icon: AlertTriangle,
  },
  {
    label: "Импорт",
    href: "/import",
    icon: Upload,
  },
  {
    label: "Архив",
    href: "/archive",
    icon: Archive,
    adminOnly: true,
  },
  {
    label: "Настройки",
    href: "/settings",
    icon: Settings,
    adminOnly: true,
  },
];
