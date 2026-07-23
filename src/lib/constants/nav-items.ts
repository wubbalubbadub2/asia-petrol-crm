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
  BarChart3,
  Table2,
  type LucideIcon,
} from "lucide-react";

// Сайдбар группирует пункты по `section`: «Навигация» / «Операции» /
// «Отчёты». Порядок внутри секции = порядок в этом массиве.
export type NavSection = "nav" | "ops" | "reports";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  section: NavSection;
  children?: { label: string; href: string }[];
  adminOnly?: boolean;
};

export const navItems: NavItem[] = [
  // ── Навигация ──
  {
    label: "Главная",
    href: "/",
    icon: LayoutDashboard,
    section: "nav",
  },
  {
    label: "Справочник",
    href: "/spravochnik",
    icon: BookOpen,
    section: "nav",
  },
  {
    label: "Котировки",
    href: "/quotations",
    icon: TrendingUp,
    section: "nav",
  },
  {
    label: "Сделки",
    href: "/deals",
    icon: FileText,
    section: "nav",
  },
  // ── Операции ──
  {
    label: "Заявки",
    href: "/applications",
    icon: ClipboardList,
    section: "ops",
  },
  {
    label: "Реестр отгрузки",
    href: "/registry",
    icon: Truck,
    section: "ops",
  },
  {
    label: "ДТ-КТ Логистика",
    href: "/dt-kt",
    icon: Calculator,
    section: "ops",
  },
  {
    label: "Тарифы",
    href: "/tariffs",
    icon: DollarSign,
    section: "ops",
  },
  {
    label: "Сверхнормативы",
    href: "/surcharges",
    icon: AlertTriangle,
    section: "ops",
  },
  {
    label: "Импорт",
    href: "/import",
    icon: Upload,
    section: "ops",
  },
  // ── Отчёты ── (по пункту на каждый отчёт)
  {
    label: "Сбор по валюте",
    href: "/reports/collection",
    icon: Table2,
    section: "reports",
  },
  {
    label: "Анализ по валюте",
    href: "/reports",
    icon: BarChart3,
    section: "reports",
  },
  // ── Админ (не показывается в сайдбаре — доступ по URL) ──
  {
    label: "Архив",
    href: "/archive",
    icon: Archive,
    section: "ops",
    adminOnly: true,
  },
  {
    label: "Настройки",
    href: "/settings",
    icon: Settings,
    section: "ops",
    adminOnly: true,
  },
];
