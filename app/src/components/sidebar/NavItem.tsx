// components/sidebar/NavItem.tsx -- Left-Nav Row Button
// ======================================================
// One clickable row inside a NavSection ("Outline", "Characters", ...).
// Extracted from App.tsx as part of the sidebar overhaul. The `hint` prop
// becomes the hover tooltip -- embedded UX hints are a first-class design
// feature in this app (see CLAUDE.md UI Design Direction).

export function NavItem({
  label,
  hint,
  active = false,
  onClick,
}: {
  label: string;
  hint: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`mb-0.5 w-full rounded px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-indigo-600/20 text-indigo-300" : "text-text-primary hover:bg-bg-surface"
      }`}
      title={hint}
    >
      {label}
    </button>
  );
}
