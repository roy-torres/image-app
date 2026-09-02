export default function Spinner({ className = '' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={
        'inline-block h-6 w-6 rounded-full border-2 border-black/15 ' +
        'border-t-black [animation:spin_0.7s_linear_infinite] ' +
        className
      }
    />
  );
}
