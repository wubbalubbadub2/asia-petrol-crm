"use client";

import { useState } from "react";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const tabs = [
  { key: "kg", label: "KG (Экспорт)" },
  { key: "kz", label: "KZ (Внутренний)" },
] as const;

export default function RegistryPage() {
  const [activeTab, setActiveTab] = useState<"kg" | "kz">("kg");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Реестр отгрузки</h1>
      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <Construction className="h-5 w-5" />
          <span>Реестр {activeTab === "kg" ? "KG (Экспорт)" : "KZ (Внутренний)"} — в разработке</span>
        </CardContent>
      </Card>
    </div>
  );
}
