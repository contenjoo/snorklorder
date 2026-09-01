export const ACCOUNT_REQUEST_CHANNELS = [
  { value: "company", label: "회사몰", icon: "🏢" },
  { value: "school_store", label: "학교장터", icon: "🏫" },
  { value: "partner", label: "협력사", icon: "🤝" },
] as const;

export type AccountRequestChannel = (typeof ACCOUNT_REQUEST_CHANNELS)[number]["value"];

export const ACCOUNT_REQUEST_CHANNEL_VALUES = ACCOUNT_REQUEST_CHANNELS.map(
  ({ value }) => value,
);

export function isAccountRequestChannel(value: unknown): value is AccountRequestChannel {
  return typeof value === "string"
    && ACCOUNT_REQUEST_CHANNEL_VALUES.some((channel) => channel === value);
}
