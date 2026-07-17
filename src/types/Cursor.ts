export enum Tool {
    Soil = 'soil',
    Road = 'road',
    House = 'house',
    Work = 'work',
    Select = 'select',
    Bulldoze = 'bulldoze',
    // The construction menu (task 108): not a placement tool — selecting it opens the building grid; the
    // menu then arms House/Work with an optional pinned blueprint + placeholder asset.
    Construction = 'construction',
    /*Building1 = 'building1',
    Building2 = 'building2',*/
}

export type Toolbelt = Record<Tool, string>;

interface CursorObject {
    tool: Tool;
    asset: Phaser.GameObjects.Image | null;
}

export type Cursor = CursorObject | null;



