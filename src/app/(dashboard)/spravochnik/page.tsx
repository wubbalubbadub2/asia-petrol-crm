import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building2,
  ShoppingCart,
  Factory,
  Truck,
  MapPin,
  Fuel,
  Users,
  Briefcase,
} from "lucide-react";

const sections = [
  {
    title: "Поставщики",
    href: "/spravochnik/suppliers",
    icon: Building2,
    description: "Управление поставщиками ГСМ",
  },
  {
    title: "Покупатели",
    href: "/spravochnik/buyers",
    icon: ShoppingCart,
    description: "Управление покупателями",
  },
  {
    title: "Заводы",
    href: "/spravochnik/factories",
    icon: Factory,
    description: "Заводы-изготовители",
  },
  {
    title: "Экспедиторы",
    href: "/spravochnik/forwarders",
    icon: Truck,
    description: "Транспортные операторы",
  },
  {
    title: "Станции",
    href: "/spravochnik/stations",
    icon: MapPin,
    description: "Станции отправления и назначения",
  },
  {
    title: "Виды ГСМ",
    href: "/spravochnik/fuel-types",
    icon: Fuel,
    description: "Виды топлива с цветовой маркировкой",
  },
  {
    title: "Группы компании",
    href: "/spravochnik/company-groups",
    icon: Briefcase,
    description: "Группы компании для сделок",
  },
  {
    title: "Менеджеры",
    href: "/spravochnik/managers",
    icon: Users,
    description: "Менеджеры и сотрудники",
  },
];

export default function SpravochnikPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Справочник</h1>
        <p className="text-[13px] text-stone-500 mt-1">Управление справочными данными системы</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="group transition-all duration-200 hover:shadow-md hover:shadow-amber-100/50 hover:-translate-y-0.5 hover:border-amber-200 border-stone-200/80">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-50 to-amber-100 ring-1 ring-amber-200/50 group-hover:from-amber-100 group-hover:to-amber-200 transition-all">
                  <s.icon className="h-4 w-4 text-amber-600" />
                </div>
                <CardTitle className="text-[14px]">{s.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  {s.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
