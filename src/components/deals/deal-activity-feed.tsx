"use client";

import { useState, useRef, useEffect } from "react";
import { Send, MessageSquare, DollarSign, Truck, FileText, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDealActivity, type ActivityMessage } from "@/lib/hooks/use-deal-activity";

const TYPE_CONFIG: Record<string, { icon: typeof MessageSquare; color: string; bg: string }> = {
  comment: { icon: MessageSquare, color: "text-amber-600", bg: "bg-amber-100" },
  system: { icon: Settings, color: "text-stone-500", bg: "bg-stone-100" },
  payment: { icon: DollarSign, color: "text-green-600", bg: "bg-green-100" },
  shipment: { icon: Truck, color: "text-blue-600", bg: "bg-blue-100" },
  attachment: { icon: FileText, color: "text-purple-600", bg: "bg-purple-100" },
  status_change: { icon: Settings, color: "text-orange-600", bg: "bg-orange-100" },
};

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "только что";
  if (diffMins < 60) return `${diffMins} мин назад`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} дн назад`;

  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ActivityItem({ msg }: { msg: ActivityMessage }) {
  const config = TYPE_CONFIG[msg.type] ?? TYPE_CONFIG.comment;
  const Icon = config.icon;
  const isComment = msg.type === "comment";

  return (
    <div className="flex gap-2.5 py-2">
      {/* Avatar or icon */}
      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
        isComment ? "bg-gradient-to-br from-amber-400 to-amber-600 text-white text-[10px] font-bold" : `${config.bg}`
      }`}>
        {isComment ? (
          msg.user?.full_name?.charAt(0)?.toUpperCase() ?? "?"
        ) : (
          <Icon className={`h-3.5 w-3.5 ${config.color}`} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {isComment && msg.user?.full_name && (
            <span className="text-[12px] font-medium text-stone-800">{msg.user.full_name}</span>
          )}
          <span className="text-[10px] text-stone-400">{formatTime(msg.created_at)}</span>
        </div>
        <p className={`text-[12px] leading-relaxed mt-0.5 ${isComment ? "text-stone-700" : "text-stone-500 italic"}`}>
          {msg.content}
        </p>
      </div>
    </div>
  );
}

export function DealActivityFeed({ dealId }: { dealId: string }) {
  const { messages, loading, sendMessage } = useDealActivity(dealId);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    setSending(true);
    const text = input;
    setInput(""); // Clear immediately
    await sendMessage(text);
    setSending(false);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-1 space-y-0.5">
        {loading ? (
          <p className="text-[12px] text-stone-400 py-4 text-center">Загрузка...</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-stone-400">
            <MessageSquare className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-[12px]">Нет сообщений</p>
            <p className="text-[10px]">Напишите первый комментарий</p>
          </div>
        ) : (
          messages.map((msg) => <ActivityItem key={msg.id} msg={msg} />)
        )}
      </div>

      {/* Input */}
      <div className="border-t border-stone-200 pt-2 mt-2 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="Написать комментарий..."
          className="flex-1 rounded-lg border border-stone-200 px-3 py-2 text-[13px] focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-200 transition-colors"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!input.trim() || sending}
          className="h-9 px-3"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
