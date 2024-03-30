import Road from './Road.js';

export default class Person {
   constructor(x, y, row, col) {
      this.row = row;
      this.col = col;
      this.x = x;
      this.y = y;
      this.speed = 1;
      this.direction = { x: 0, y: 0 };
      this.image = null;

      this.updateDepth();
   }

   update(){
      this.walk();

      let tilePosition = this.getTilePosition(person.x, person.y);
      person.updateTile(tilePosition.row, tilePosition.col);

      // If the person reaches the center of the tile, decide the new direction
      if (person.isAtTileCenter(this)) {
          person.decideNewDirection(this.field);
      }
   }

   updateDepth() {
      if (!this.image) return;
      this.image.setDepth((this.row * 10) + 1);
   }

   decideNewDirection(field, offRoad = false) {
      let currentTile = field.getTile(this.row, this.col);

      if (offRoad) {
         // Logic to put the pedestrian back on the road
      } else {

         let possibleDirections = currentTile.getPossibleDirections(field);
         if (possibleDirections.length) {
            let selectedDirection = Phaser.Math.RND.pick(possibleDirections);
            this.direction = this.calculateDirectionVector(selectedDirection);
         }
      }
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

   walk() {
      const potentialX = this.x + this.direction.x * this.speed;
      const potentialY = this.y + this.direction.y * this.speed;
   
      let tilePosition = scene.getTilePosition(potentialX, potentialY);
   
      // If the tile position is valid and is a road, update the pedestrian's position
      if (tilePosition) {
         let tile = field.getTile(tilePosition.row, tilePosition.col);
         if (tile && tile instanceof Road) {
            // Continue walking
            this.x = potentialX;
            this.y = potentialY;
            this.image.setPosition(this.x, this.y);
         } else {
            this.decideNewDirection(field, true);
         }
      }
   }

   isAtTileCenter(scene) {
      // Get the center pixel position of the current tile
      const tileCenter = scene.getCellPosition(this.row, this.col);
      if (!tileCenter) return false; // In case the tileCenter could not be retrieved

      const distance = Phaser.Math.Distance.Between(this.x, this.y, tileCenter.x, tileCenter.y);
      return distance < 1;
  }

   getPosition() {
      return { x: this.x, y: this.y };
   }

   setPosition(x, y) {
      this.x = x;
      this.y = y;
   }

   getTilePosition() {
      return { row: this.row, col: this.col };
   }

   setTilePosition(row, col) {
      this.row = row;
      this.col = col;

      this.updateDepth();
   }

   setImage(image) {
      this.image = image;
   }

   getImage() {
      return this.image;
   }
}