import type { ReactNode } from "react";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function AuthorLink({ name, url }: { name: string; url?: string }) {
  if (!url) return <strong>{name}</strong>;
  return (
    <a className="author-link" href={url} target="_blank" rel="noreferrer">
      {name}
    </a>
  );
}

export function relativeDate(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round((date.getTime() - Date.now()) / 86_400_000),
    "day"
  );
}

export function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}
