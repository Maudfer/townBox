import Road from './Road.js';

export default class Person {
   constructor(x, y) {
      this.x = x;
      this.y = y;
      this.depth = 0;
      this.speed = 1;
      this.currentTarget = null;
      this.movingAxis = 'x';
      this.asset = null;
   }

   walk(currentTile, timeDelta) {
      if (!this.currentTarget || !(currentTile instanceof Road)) return;

      const targetCenter = this.currentTarget.getCenter();

      // TODO: implement timeDelta to make the movement frame-independent
      const speedX = this.speed * Math.sign(targetCenter.x - this.x); // * timeDelta;
      const speedY = this.speed * Math.sign(targetCenter.y - this.y); // * timeDelta;

      let potentialX = this.x + speedX;
      let potentialY = this.y + speedY;

      if (this.movingAxis === 'x') {
         this.x = potentialX;
         if (this.isCurrentTargetXReached()) {
            this.movingAxis = 'y';
         }
      } else if (this.movingAxis === 'y') {
         this.y = potentialY;
         if (this.isCurrentTargetYReached()) {
            this.movingAxis = 'x';
         }
      }

      this.asset.setPosition(this.x, this.y);
   }

   updateCurrentTarget(currentTile, neighbors) {
      if (!currentTile || !(currentTile instanceof Road)) {
         // TODO: handle offroad movement and behavior
         return;
      }

      if (this.currentTarget && !this.isCurrentTargetReached()) {
         return; // Still moving towards the current target
      }

      const possibleTargets = currentTile.getConnectingRoads(neighbors);

      if (possibleTargets.length > 0) {
         const nextTarget = Phaser.Math.RND.pick(possibleTargets);
         this.setNewTarget(nextTarget);
      } else {
         this.currentTarget = null; // No valid targets, stop moving
      }
   }

   setNewTarget(targetTile) {
      this.currentTarget = targetTile;
      const targetCenter = this.currentTarget.getCenter();

      // Decide whether to move in x or y direction based on the closer axis to the target
      const deltaX = Math.abs(targetCenter.x - this.x);
      const deltaY = Math.abs(targetCenter.y - this.y);

      this.movingAxis = deltaX > deltaY ? 'x' : 'y';
   }

   isCurrentTargetXReached() {
      const targetX = this.currentTarget.getCenter().x;
      const distance = Math.abs(this.x - targetX);
      return distance < 1;
   }

   isCurrentTargetYReached() {
      const targetY = this.currentTarget.getCenter().y;
      const distance = Math.abs(this.y - targetY);
      return distance < 1;
   }

   isCurrentTargetReached() {
      return this.isCurrentTargetXReached() && this.isCurrentTargetYReached();
   }

   updateDepth(currentTile) {
      if (!this.asset) {
         return;
      }

      const row = currentTile.getRow();
      this.depth = (row * 10) + 1;
      this.asset.setDepth(this.depth);
   }

   getPosition() {
      return { x: this.x, y: this.y };
   }

   setPosition(x, y) {
      this.x = x;
      this.y = y;
   }

   getAsset() {
      return this.asset;
   }

   setAsset(asset) {
      this.asset = asset;
   }
}