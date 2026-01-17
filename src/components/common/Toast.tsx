interface ToastProps {
  message: string;
  visible: boolean;
  onClose?: () => void;
}

export function Toast({ message, visible, onClose }: ToastProps) {
  if (!visible) return null;

  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      {onClose ? (
        <button className="toast-close" type="button" onClick={onClose}>
          x
        </button>
      ) : null}
    </div>
  );
}
