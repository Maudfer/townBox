import { FC, useEffect } from 'react';
import { Rnd } from 'react-rnd';

import { WindowProps } from 'types/HUD';

const Window: FC<WindowProps> = ({ children, game, index, title, header, footer, onClose }) => {

    function handleDragStart() {
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
                x: 10,
                y: 10,
                width: 300,
                height: 250,
            }}
            minWidth={300}
            minHeight={250}
            bounds="window"
            dragHandleClassName="window-header"
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
        >
            <div className="window">
                <div className="window-header glass">
                    {!header && (
                        <>
                            <h3>{title}</h3>
                            <button onClick={handleClose}>X</button>
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
                            <button onClick={handleClose}>OK</button>
                        </>
                    )}
                    {footer}
                </div>
            </div>
        </Rnd>
    );
};

export default Window;