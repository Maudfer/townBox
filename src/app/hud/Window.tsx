import { FC } from 'react';
import Draggable from 'react-draggable';

import { WindowProps } from 'types/HUD';

const Window: FC<WindowProps> = ({ game, title }) => {

  return (
    <Draggable>
        <div className="window">
            <div className="window-header">
                <h3>{title}</h3>
                <button>X</button>
            </div>
            <div className="window-body">
                <p>
                    Game size: {game.gridParams.width}x{game.gridParams.height}
                </p>
            </div>
            <div className="window-footer">
                <button>Ok</button>
            </div>
        </div>
    </Draggable>
  );
};

export default Window;