import { FC } from 'react';

export type ToastType = 'success' | 'error';

export interface ToastItem {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastsProps {
    toasts: ToastItem[];
}

const Toasts: FC<ToastsProps> = ({ toasts }) => {
    return (
        <div className="toasts">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast-${toast.type}`}>
                    {toast.message}
                </div>
            ))}
        </div>
    );
};

export default Toasts;
