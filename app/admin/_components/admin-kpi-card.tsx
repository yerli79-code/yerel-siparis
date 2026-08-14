import styles from "./admin.module.css";

export type AdminKpiIcon =
  | "business"
  | "active"
  | "inactive"
  | "recent"
  | "subscription"
  | "expiring";

type AdminKpiCardProps = {
  icon: AdminKpiIcon;
  label: string;
  value: number;
  description: string;
};

function KpiIcon({ name }: { name: AdminKpiIcon }) {
  if (name === "business") {
    return <path d="M4 20V7l8-4 8 4v13M8 10h.01M12 10h.01M16 10h.01M8 14h.01M16 14h.01M10 20v-4h4v4" />;
  }
  if (name === "active") {
    return <path d="M20 6 9 17l-5-5" />;
  }
  if (name === "inactive") {
    return <path d="M5 5l14 14M8.5 8.5A5 5 0 0 0 15.5 15.5M9 4.6A8 8 0 0 1 19.4 15M4.6 9A8 8 0 0 0 15 19.4" />;
  }
  if (name === "recent") {
    return <path d="M12 7v5l3 2M5 3v4H1M4.1 17A9 9 0 1 0 3 8" />;
  }
  if (name === "subscription") {
    return <path d="M6 3h12a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2Zm2 5h8M8 12h5" />;
  }
  return <path d="M12 8v4l2.5 2.5M6.5 3.5 4 6M17.5 3.5 20 6M5 13a7 7 0 1 0 14 0 7 7 0 0 0-14 0Z" />;
}

export default function AdminKpiCard({
  icon,
  label,
  value,
  description,
}: AdminKpiCardProps) {
  return (
    <article className={styles.kpiCard}>
      <span className={styles.kpiIcon} aria-hidden="true">
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
          <KpiIcon name={icon} />
        </svg>
      </span>
      <div className={styles.kpiCopy}>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{description}</small>
      </div>
    </article>
  );
}
