/**
 * A horizontal strip of clickable image thumbnails (models or wardrobe).
 * Picking one calls `onPick(item)`; the parent turns it into a File.
 */
export default function PresetPicker({
  title,
  items,
  selectedId,
  disabled = false,
  onPick,
}) {
  if (!items?.length) return null;

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm">
      <p className="mb-3 text-xs font-medium tracking-wide text-black/50 uppercase">
        {title}
      </p>
      <div className="flex flex-wrap gap-3">
        {items.map((item) => {
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              disabled={disabled}
              onClick={() => onPick(item)}
              aria-pressed={active}
              title={item.label}
              className={
                'group w-24 shrink-0 overflow-hidden rounded-xl border text-left transition disabled:opacity-40 ' +
                (active
                  ? 'border-black ring-2 ring-black'
                  : 'border-black/15 hover:border-black/40')
              }
            >
              <img
                src={item.src}
                alt={item.label}
                loading="lazy"
                className="aspect-square w-full bg-canvas object-cover"
              />
              <span className="block truncate px-2 py-1.5 text-[11px] text-black/60">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
