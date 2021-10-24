export default class Person {
   constructor(x, y, imageEntity) {
      this.row = null;
      this.col = null;
      this.x = x;
      this.y = y;
      this.image = imageEntity;
   }

   updateTile(row, col){
      this.row = row;
      this.col = col;
      this.image.setDepth(row + 1);
   }

   walk() {
      this.x = this.x + 1;
      this.y = this.y + 1;
      this.image.setPosition(this.x, this.y);
   }

   getPosition(){
      return {x: this.x, y: this.y};
   }

}