import { useId, useRef, useState } from 'react';

/**
 * A labeled image picker with drag-and-drop, click-to-browse, and a preview.
 * Validation of the picked file is delegated to the parent via `onSelect`.
 */
export default function ImageUploader({
  title,
  hint,
  previewUrl,
  fileName,
  error,
  disabled = false,
  onSelect,
  onClear,
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(fileList) {
    const file = fileList?.[0];
    if (file) onSelect(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-black/50">{hint}</p>}
      </div>

      {previewUrl ? (
        <div className="space-y-3">
          <div className="flex items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-canvas">
            <img
              src={previewUrl}
              alt={`${title} preview`}
              className="max-h-72 w-full object-contain"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-xs text-black/50" title={fileName}>
              {fileName}
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 disabled:opacity-40"
              >
                Change
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={onClear}
                className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium transition hover:bg-black/5 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={
            'flex h-56 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 text-center transition ' +
            (dragging
              ? 'border-black bg-black/5'
              : 'border-black/15 hover:border-black/30 hover:bg-black/[0.02]') +
            (disabled ? ' pointer-events-none opacity-50' : '')
          }
        >
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mb-2 text-black/40"
            aria-hidden="true"
          >
            <path d="M12 16V4" />
            <path d="m6 10 6-6 6 6" />
            <path d="M4 20h16" />
          </svg>
          <span className="text-sm font-medium">Click to upload or drag &amp; drop</span>
          <span className="mt-1 text-xs text-black/45">PNG, JPG, WebP</span>
        </label>
      )}

      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {error && <p className="mt-3 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
