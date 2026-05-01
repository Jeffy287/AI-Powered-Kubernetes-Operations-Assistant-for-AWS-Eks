import type { ReactNode } from "react";

export function DescribeSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="describe-section">
      <h4 className="describe-section__title">{title}</h4>
      <div className="describe-section__body">{children}</div>
    </section>
  );
}

export function DlRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="describe-dl__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function KeyValueList({
  data,
}: {
  data: Record<string, string | number | boolean | null | undefined>;
}) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return null;
  return (
    <dl className="describe-dl">
      {entries.map(([k, v]) => (
        <DlRow key={k} label={k} value={String(v ?? "—")} />
      ))}
    </dl>
  );
}
