"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  TransportRequestForm,
  valuesFromRow,
  type RequestFormValues,
  type PayerLine,
} from "@/components/transport/request-form";

export default function TransportRequestPage() {
  const params = useParams<{ id: string }>();
  const [values, setValues] = useState<RequestFormValues | null>(null);
  const [heading, setHeading] = useState("Заявка на перевозку");
  const [number, setNumber] = useState<number | null>(null);
  const [payers, setPayers] = useState<PayerLine[]>([]);
  const [missing, setMissing] = useState(false);
  const sbRef = useRef(createClient());

  useEffect(() => {
    const id = params?.id;
    if (!id) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = sbRef.current as any;
    sb.from("transport_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }: { data: Record<string, unknown> | null; error: { message: string } | null }) => {
        if (error) {
          toast.error(`Ошибка загрузки: ${error.message}`);
          setMissing(true);
          return;
        }
        if (!data) {
          setMissing(true);
          return;
        }
        setValues(valuesFromRow(data));
        setHeading(`Заявка № ${data.request_number}/${String(data.request_year).slice(2)}`);
        setNumber(Number(data.request_number));
        sb.from("transport_request_payers")
          .select("railway, payer_text")
          .eq("request_id", id)
          .order("position")
          .then(({ data: lines }: { data: { railway: string; payer_text: string | null }[] | null }) =>
            setPayers(
              (lines ?? []).map((l) => ({ railway: l.railway, text: l.payer_text ?? "" })),
            ),
          );
      });
  }, [params?.id]);

  if (missing) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Заявка не найдена
      </div>
    );
  }

  if (!values) {
    return (
      <div className="flex h-40 items-center justify-center text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  // Существующую заявку не перезаполняем чужими данными при смене
  // компании: поля уже введены, подстановка затёрла бы их.
  return (
    <TransportRequestForm
      initial={values}
      heading={heading}
      prefillFromLast={false}
      requestNumber={number}
      initialPayers={payers}
    />
  );
}
