import { FC } from 'react';
import { Rnd } from 'react-rnd';

import { WindowProps } from 'types/HUD';

// Windows open just below the clock (.clock-widget: left 20, top 20, ~38px tall) and left-aligned with it —
// no longer "directly behind the clock" (task 131 follow-up #3).
const ORIGIN_X = 20;
const ORIGIN_Y = 70;
// A window's stacking order rides above the clock/toasts (z-index 1000), so a focused window is never hidden
// behind the HUD chrome; the HUD's per-window z (from the focus system, #2) stacks windows among themselves.
const WINDOW_Z_BASE = 1001;
// No dialog may exceed this fraction of the viewport in either dimension (task 131 follow-up #3).
const MAX_SCREEN_FRACTION = 0.8;
const DEFAULT_WIDTH = 300;
const DEFAULT_HEIGHT = 250;

const Window: FC<WindowProps> = ({ children, game, index, title, testId, header, footer, initialSize, z, onFocus, onClose, onResize }) => {
    // Cap the opening size at 80% of the viewport in each dimension (task 131 follow-up #3).
    const maxWidth = Math.floor(window.innerWidth * MAX_SCREEN_FRACTION);
    const maxHeight = Math.floor(window.innerHeight * MAX_SCREEN_FRACTION);
    const openWidth = Math.min(initialSize?.width ?? DEFAULT_WIDTH, maxWidth);
    const openHeight = Math.min(initialSize?.height ?? DEFAULT_HEIGHT, maxHeight);

    function handleDragStart() {
        onFocus?.();
        game.emit("windowDragStart");
    }

    function handleDragStop() {
        game.emit("windowDragStop");
    }

    function handleClose() {
        if (onClose) {
            onClose(index);
        }
    }
    
    return (
        <Rnd
            default={{
                x: ORIGIN_X,
                y: ORIGIN_Y,
                width: openWidth,
                height: openHeight,
            }}
            minWidth={300}
            minHeight={250}
            maxWidth={maxWidth}
            maxHeight={maxHeight}
            bounds="window"
            dragHandleClassName="window-header"
            // Give the corner resize handles stable class hooks for the integration tests (task 008).
            resizeHandleClasses={{ bottomRight: 'window-resize-se', bottomLeft: 'window-resize-sw' }}
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
            onResize={onResize}
            style={{ zIndex: WINDOW_Z_BASE + (z ?? 0) }}
        >
            <div className="window" data-testid={testId ?? 'window'} onMouseDown={() => onFocus?.()}>
                <div className="window-header glass">
                    {!header && (
                        <>
                            <h3>{title}</h3>
                            <button data-testid="window-close" onClick={handleClose}>X</button>
                        </>
                    )}
                    {header}
                </div>

                <div className="window-body">
                    {children}
                </div>

                <div className="window-footer glass">
                    {!footer && (
                        <>
                            <button data-testid="window-ok" onClick={handleClose}>OK</button>
                        </>
                    )}
                    {footer}
                </div>
            </div>
        </Rnd>
    );
};

export default Window;