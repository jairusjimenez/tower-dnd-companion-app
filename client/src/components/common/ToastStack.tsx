import { useVtt } from '../../context/VttContext';

export function ToastStack() {
  const { toasts, dismissToast } = useVtt();
  return (
    <div id="toast-stack" className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast-card ${toast.category || 'info'}`}>
          <div>
            <div className="toast-title">[{toast.title || 'SYSTEM NOTICE'}]</div>
            <div className="toast-body">{toast.message}</div>
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
