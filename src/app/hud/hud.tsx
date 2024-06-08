import { FC } from 'react';

import { HUDProps } from 'types/HUD';

const HUD: FC<HUDProps> = ({ game }) => {
  console.log("HUD initialized", game);

  return (
    <div className="hud window">
      HUD
    </div>
  );
};

export default HUD;