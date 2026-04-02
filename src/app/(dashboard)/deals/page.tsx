"use client";

import { useState } from "react";
import Link from "next/link";
import { Construction, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const tabs = [
  { key: "list", label: "Все сделки" },
  { key: "passport-kg", label: "Паспорт KG" },
  { key: "passport-kz", label: "Паспорт KZ" },
] as const;

export default function DealsPage() {
  const [activeTab, setActiveTab] = useState<"list" | "passport-kg" | "passport-kz">("list");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Сделки</h1>
        <Link href="/deals/new">
          <Button size="sm">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Новая сделка
          </Button>
        </Link>
      </div>
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
          <span>
            {activeTab === "list" ? "Список сделок" : `Паспорт ${activeTab === "passport-kg" ? "KG" : "KZ"}`} — в разработке
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
