import { Icon, type IconName } from "./icons";

export function IconButton({ icon, label, onClick, active }: { icon: IconName; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button className={`icon-btn ${active ? "on" : ""}`} onClick={onClick} title={label} aria-label={label} aria-pressed={active}>
      <Icon name={icon} />
    </button>
  );
}
