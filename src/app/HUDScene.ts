import GameManager from 'app/GameManager';

import { SceneConfig } from 'types/Phaser';

type Graphics = Phaser.GameObjects.Graphics | null;
type Button = Phaser.GameObjects.Text;

export default class HUDScene extends Phaser.Scene {
    private gameManager: GameManager;
    private toolbar: Graphics;
    private buttons: Button[];

    constructor(gameManager: GameManager, sceneConfig: SceneConfig) {
        super(sceneConfig);

        this.gameManager = gameManager;
        this.toolbar = null;
        this.buttons = [];
    }
    
    create() {
        const toolbarHeight = 50;
        const screenWidth = this.cameras.main.width;
        const screenHeight = this.cameras.main.height;
    
        // Create a Graphics object for the toolbar background
        this.toolbar = this.add.graphics();
        this.toolbar.fillStyle(0x333333, 0.8); // dark grey background with some transparency
        this.toolbar.fillRect(0, screenHeight - toolbarHeight, screenWidth, toolbarHeight);
    
        // Define buttons
        const buttonTitles = ['Menu 1', 'Menu 2', 'Menu 3']; // Titles of your buttons
        this.buttons = buttonTitles.map((title, index) => this.createButton(title, index, screenWidth, screenHeight, toolbarHeight));
    }
    
    private createButton(title: string, index: number, screenWidth: number, screenHeight: number, toolbarHeight: number): Phaser.GameObjects.Text {
        const buttonWidth = 100;
        const buttonHeight = 30;
        const padding = 10;
        const totalButtonWidth = this.buttons.length * (buttonWidth + padding) - padding;
        const startX = (screenWidth - totalButtonWidth) / 2;
    
        // Create a text object for the button
        const button = this.add.text(startX + index * (buttonWidth + padding), screenHeight - toolbarHeight / 2 - buttonHeight / 2, title, {
            font: '16px Arial',
            backgroundColor: '#666666',
            color: '#ffffff',
            padding: { x: 10, y: 5 },
            fixedWidth: buttonWidth,
            fixedHeight: buttonHeight
        }).setInteractive();
    
        // Add a click event listener to the button
        button.on('pointerdown', () => {
            this.openMenu(title);
        });
    
        return button;
    }
    
    private openMenu(title: string) {
        console.log(`Open menu: ${title}`);
    }
}