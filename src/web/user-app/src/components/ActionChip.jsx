export default function ActionChip({ action, label, onAction }) {
  return (
    <button className="action-chip" onClick={() => onAction(action)}>
      {label}
    </button>
  );
}
