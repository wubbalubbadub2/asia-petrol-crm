import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Настройки</h1>
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-muted-foreground">
          <Construction className="h-5 w-5" />
          <span>Раздел в разработке</span>
        </CardContent>
      </Card>
    </div>
  );
}
