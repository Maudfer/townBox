import Phaser from 'phaser';

export default class TitleScene extends Phaser.Scene {
    constructor() {
        super({ key: 'TitleScene' });
    }

    create(): void {
        const width  = this.cameras.main.width;
        const height = this.cameras.main.height;

        const cx = width  / 2;
        const cy = height / 2;

        // ── Background ──────────────────────────────────────────────────────
        this.add.rectangle(cx, cy, width, height, 0x2a5318);

        // Subtle isometric grid decoration
        this._drawGrid(width, height);

        // ── Title ───────────────────────────────────────────────────────────
        // Drop shadow
        this.add.text(cx + 4, cy - 115 + 4, 'TownBox', {
            fontSize: '84px',
            fontFamily: 'system-ui, sans-serif',
            color: '#071d04',
        }).setOrigin(0.5).setAlpha(0.45);

        // Main title
        const titleText = this.add.text(cx, cy - 115, 'TownBox', {
            fontSize: '84px',
            fontFamily: 'system-ui, sans-serif',
            fontStyle: 'bold',
            color: '#f0f7ee',
            stroke: '#0f353b',
            strokeThickness: 6,
        }).setOrigin(0.5).setAlpha(0);

        // Subtitle
        const subtitleText = this.add.text(cx, cy - 22, 'C I T Y   B U I L D E R', {
            fontSize: '18px',
            fontFamily: 'system-ui, sans-serif',
            color: '#9ecf92',
        }).setOrigin(0.5).setAlpha(0);

        // ── Start button ─────────────────────────────────────────────────────
        const btnY = cy + 80;

        // Outer glow (decorative, not interactive)
        const glow = this.add.rectangle(cx, btnY, 232, 62, 0x3a8f99, 0)
            .setStrokeStyle(1, 0x3a8f99, 0.35)
            .setAlpha(0);

        // Button body
        const btnBg = this.add.rectangle(cx, btnY, 220, 56, 0x092327)
            .setStrokeStyle(2, 0x3a8f99)
            .setInteractive({ useHandCursor: true })
            .setAlpha(0);

        // Button label
        const btnText = this.add.text(cx, btnY, 'Start Game', {
            fontSize: '22px',
            fontFamily: 'system-ui, sans-serif',
            fontStyle: 'bold',
            color: '#e8f5e9',
        }).setOrigin(0.5).setAlpha(0);

        // ── Version ──────────────────────────────────────────────────────────
        this.add.text(width - 10, height - 10, 'v0.1.0', {
            fontSize: '13px',
            fontFamily: 'system-ui, sans-serif',
            color: '#4a7a42',
        }).setOrigin(1, 1);

        // ── Fade-in sequence ─────────────────────────────────────────────────
        this.cameras.main.fadeIn(400, 0, 0, 0);

        this.tweens.add({
            targets: [titleText, subtitleText],
            alpha: 1,
            duration: 700,
            ease: 'Power2',
            delay: 300,
        });

        this.tweens.add({
            targets: [glow, btnBg, btnText],
            alpha: 1,
            duration: 600,
            ease: 'Power2',
            delay: 700,
            onComplete: () => this._addButtonPulse(btnBg),
        });

        // ── Button interactions ───────────────────────────────────────────────
        btnBg.on('pointerover', () => {
            btnBg.setFillStyle(0x0f353b);
            btnBg.setStrokeStyle(2, 0x5cb8c4);
            this.tweens.add({
                targets: [btnBg, btnText, glow],
                scaleX: 1.05,
                scaleY: 1.05,
                duration: 120,
                ease: 'Power2',
            });
        });

        btnBg.on('pointerout', () => {
            btnBg.setFillStyle(0x092327);
            btnBg.setStrokeStyle(2, 0x3a8f99);
            this.tweens.add({
                targets: [btnBg, btnText, glow],
                scaleX: 1,
                scaleY: 1,
                duration: 120,
                ease: 'Power2',
            });
        });

        btnBg.on('pointerdown', () => {
            this.tweens.add({
                targets: [btnBg, btnText],
                scaleX: 0.96,
                scaleY: 0.96,
                duration: 80,
                ease: 'Power2',
                yoyo: true,
                onComplete: () => {
                    this.cameras.main.fadeOut(600, 0, 0, 0);
                    this.cameras.main.once(
                        Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE,
                        () => this.scene.start('MainScene')
                    );
                },
            });
        });
    }

    private _drawGrid(width: number, height: number): void {
        const g = this.add.graphics();
        g.lineStyle(1, 0x3a7525, 0.22);

        // Vertical lines
        const step = 56;
        for (let x = 0; x <= width; x += step) {
            g.moveTo(x, 0);
            g.lineTo(x, height);
        }

        // Horizontal lines
        for (let y = 0; y <= height; y += step) {
            g.moveTo(0, y);
            g.lineTo(width, y);
        }

        g.strokePath();

        // Dot at each grid intersection
        const dots = this.add.graphics();
        dots.fillStyle(0x4a8f3a, 0.35);
        for (let x = 0; x <= width; x += step) {
            for (let y = 0; y <= height; y += step) {
                dots.fillCircle(x, y, 1.5);
            }
        }
    }

    private _addButtonPulse(btn: Phaser.GameObjects.Rectangle): void {
        this.tweens.add({
            targets: btn,
            alpha: 0.75,
            duration: 1100,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: -1,
        });
    }
}
