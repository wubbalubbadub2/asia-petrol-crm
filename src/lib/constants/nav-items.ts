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
    children: [
      { label: "Поставщики", href: "/spravochnik/suppliers" },
      { label: "Покупатели", href: "/spravochnik/buyers" },
      { label: "Заводы", href: "/spravochnik/factories" },
      { label: "Экспедиторы", href: "/spravochnik/forwarders" },
      { label: "Станции", href: "/spravochnik/stations" },
      { label: "Виды ГСМ", href: "/spravochnik/fuel-types" },
      { label: "Группы компании", href: "/spravochnik/company-groups" },
      { label: "Менеджеры", href: "/spravochnik/managers" },
    ],
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
      { label: "Список сделок", href: "/deals" },
      { label: "Паспорт KG", href: "/deals/passport-kg" },
      { label: "Паспорт KZ", href: "/deals/passport-kz" },
      { label: "Новая сделка", href: "/deals/new" },
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
    children: [
      { label: "KG (Экспорт)", href: "/registry/kg" },
      { label: "KZ (Внутренний)", href: "/registry/kz" },
    ],
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
    children: [
      { label: "СНТ", href: "/import/snt" },
      { label: "ЭСФ", href: "/import/esf" },
      { label: "Реестр", href: "/import/registry" },
    ],
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
    children: [
      { label: "Пользователи", href: "/settings/users" },
    ],
  },
];
