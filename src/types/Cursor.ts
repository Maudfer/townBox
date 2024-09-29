export enum Tool {
    Soil = 'soil',
    Road = 'road',
    House = 'house',
    Work = 'work',
    Select = 'select',
    Bulldoze = 'bulldoze',
    /*Building1 = 'building1',
    Building2 = 'building2',*/
}

export type Toolbelt = Record<Tool, string>;

interface CursorObject {
    tool: Tool;
    asset: Phaser.GameObjects.Image | null;
}

export type Cursor = CursorObject | null;



