import { Component, ReactNode } from 'react';

// Per-window error boundary (W0 / proposal simulation-aliveness-3 P0-5): a window component that throws
// used to unmount the ENTIRE HUD — toolbar, clock, feed, everything — for the rest of the session (React
// unwinds to the root when nothing catches). A crashed window now becomes a closed window: the boundary
// swallows the error, reports it, and asks the window manager to drop the entry.
interface WindowErrorBoundaryProps {
    children: ReactNode;
    // Called once when the wrapped window throws — the HUD removes the window entry (and shows a toast).
    onWindowCrash: () => void;
}

interface WindowErrorBoundaryState {
    crashed: boolean;
}

class WindowErrorBoundary extends Component<WindowErrorBoundaryProps, WindowErrorBoundaryState> {
    constructor(props: WindowErrorBoundaryProps) {
        super(props);
        this.state = { crashed: false };
    }

    static getDerivedStateFromError(): WindowErrorBoundaryState {
        return { crashed: true };
    }

    componentDidCatch(error: unknown): void {
        console.error('HUD window crashed; closing it:', error);
        this.props.onWindowCrash();
    }

    render(): ReactNode {
        if (this.state.crashed) {
            return null;
        }
        return this.props.children;
    }
}

export default WindowErrorBoundary;
