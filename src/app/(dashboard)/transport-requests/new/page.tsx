"use client";

import { TransportRequestForm, emptyValues } from "@/components/transport/request-form";

export default function NewTransportRequestPage() {
  return (
    <TransportRequestForm
      initial={emptyValues()}
      heading="Новая заявка на перевозку"
      prefillFromLast
    />
  );
}
