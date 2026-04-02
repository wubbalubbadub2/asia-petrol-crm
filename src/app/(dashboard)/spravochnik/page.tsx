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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Справочник</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="transition-all hover:border-amber-300 hover:shadow-sm">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <s.icon className="h-5 w-5 text-stone-400" />
                <CardTitle className="text-base">{s.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
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
