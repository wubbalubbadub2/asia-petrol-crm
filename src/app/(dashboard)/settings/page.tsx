import Link from "next/link";
import { Users, Sliders, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const sections = [
  {
    href: "/settings/users",
    icon: Users,
    title: "Пользователи",
    description: "Учётные записи, роли, сброс пароля",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Настройки</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href} className="group">
            <Card className="transition-colors group-hover:border-amber-300">
              <CardContent className="flex items-center gap-3 py-4">
                <s.icon className="h-5 w-5 text-amber-600 shrink-0" />
                <div className="flex-1">
                  <div className="text-sm font-medium">{s.title}</div>
                  <div className="text-[12px] text-stone-500">{s.description}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-stone-400 group-hover:text-stone-600" />
              </CardContent>
            </Card>
          </Link>
        ))}
        <Card className="opacity-60">
          <CardContent className="flex items-center gap-3 py-4">
            <Sliders className="h-5 w-5 text-stone-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium">Общие</div>
              <div className="text-[12px] text-stone-500">В разработке</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
