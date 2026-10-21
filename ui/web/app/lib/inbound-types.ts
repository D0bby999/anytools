/** Mirrors inbound.Address. */
export type InboundAddress = {
  email: string;
  kb_id?: string;
  confirm_code?: string;
  confirm_link?: string;
  confirm_at?: string;
  created_at: string;
};

/** Mirrors inbound.Received. */
export type InboundMessage = {
  subject: string;
  from: string;
  status: "imported" | "confirmation" | "empty" | "failed";
  documents: number;
  skipped: number;
  kb_id?: string;
  received_at: string;
};

/** Mirrors inboundapi's addressView. */
export type InboundView = { enabled: boolean; address: InboundAddress; recent: InboundMessage[] };
