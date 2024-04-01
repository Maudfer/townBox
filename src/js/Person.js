import Road from './Road.js';

export default class Person {
   constructor(x, y) {
      this.x = x;
      this.y = y;
      this.depth = 0;
      this.speed = 1;
      this.direction = { x: 0, y: 0 };
      this.asset = null;
      this.hasTargetDirection = false;
   }

   updateDepth(currentTile) {
      if (!this.asset) {
         return;
      }

      const row = currentTile.getRow();
      this.depth = (row * 10) + 1;
      this.asset.setDepth(this.depth);
   }

   walk(currentTile, timeDelta) {
      if (!currentTile || !(currentTile instanceof Road)) {
         return;
      }

      if (!this.asset) {
         return;
      }

      // TODO: implement timeDelta to make the movement frame-independent
      const potentialX = this.x + this.direction.x * this.speed; // * timeDelta;
      const potentialY = this.y + this.direction.y * this.speed; // * timeDelta;

      // If the tile position is valid and is a road, update the pedestrian's position
      this.x = potentialX;
      this.y = potentialY;
      this.asset.setPosition(this.x, this.y);
      this.updateDepth(currentTile);
   }

   updateTargetDirection(currentTile, neighbors) {
      if (!currentTile || !(currentTile instanceof Road)) {
         // TODO: handle offroad movement and behavior
         return;
      }

      if (this.isTargetDirectionReached(currentTile) || !this.hasTargetDirection) {
         let possibleDirections = currentTile.getConnectingRoads(neighbors);

         if (possibleDirections.length) {
            const selectedDirection = Phaser.Math.RND.pick(possibleDirections);
            this.direction = this.calculateDirectionVector(selectedDirection);
            this.hasTargetDirection = true;
         } else {
            this.hasTargetDirection = false;
         }
      }
   }

   isTargetDirectionReached(currentTile) {
      const tileCenter = currentTile.getCenter();
      const distance = Phaser.Math.Distance.Between(this.x, this.y, tileCenter.x, tileCenter.y);
      return distance < 1;
   }

   calculateDirectionVector(direction) {
      const directions = {
         left: { x: -1, y: 0 },
         right: { x: 1, y: 0 },
         up: { x: 0, y: -1 },
         down: { x: 0, y: 1 }
      };
      return directions[direction];
   }

   getPosition() {
      return { x: this.x, y: this.y };
   }

   setPosition(x, y) {
      this.x = x;
      this.y = y;
   }

   setAsset(asset) {
      this.asset = asset;
   }

   getAsset() {
      return this.asset;
   }
}