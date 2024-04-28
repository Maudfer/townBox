export enum Tool {
    Road = 'road',
    Soil = 'soil',
    House = 'house',
    Building1 = 'building1',
    Building2 = 'building2',
}

export type Toolbelt = Record<Tool, string>;

interface CursorObject {
    tool: string;
    asset: Phaser.GameObjects.Image | null;
}

export type Cursor = CursorObject | null;



