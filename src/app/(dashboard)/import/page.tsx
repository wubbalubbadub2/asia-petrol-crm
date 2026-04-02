"use client";

import { useState } from "react";
import { Construction, FileSpreadsheet, Receipt, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const tabs = [
  { key: "snt", label: "СНТ", icon: FileSpreadsheet },
  { key: "esf", label: "ЭСФ", icon: Receipt },
  { key: "registry", label: "Реестр отгрузки", icon: Truck },
] as const;

export default function ImportPage() {
  const [activeTab, setActiveTab] = useState<"snt" | "esf" | "registry">("snt");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Импорт данных</h1>
      <div className="flex gap-1 border-b border-stone-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-amber-500 text-amber-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <Construction className="h-5 w-5" />
          <span>Импорт {tabs.find(t => t.key === activeTab)?.label} — в разработке</span>
        </CardContent>
      </Card>
    </div>
  );
}
