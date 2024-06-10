import { FC, useEffect } from 'react';
import { Rnd } from 'react-rnd';

import { WindowProps } from 'types/HUD';

const Window: FC<WindowProps> = ({ game, title }) => {

    useEffect(() => {
        console.log("City:", game.city);
        console.log("City name:", game.city?.getName());
    }, [game.city]);

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
        >
            <div className="window">
                <div className="window-header glass">
                    <h3>{title}</h3>
                    <button>X</button>
                </div>

                <div className="window-body">
                    <p>
                        Game size: {game.gridParams.width}x{game.gridParams.height}
                    </p>
                    <p>
                        City: {game.city?.getName()}
                    </p>
                </div>

                <div className="window-footer glass">
                    <button>OK</button>
                </div>
            </div>
        </Rnd>
    );
};

export default Window;