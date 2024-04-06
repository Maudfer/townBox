# townBox

Simple city builder in javascript using Phaser engine

# Usage

```
npm install -g parcel
npm install -g browser-sync

parcel watch ./src/app/main.ts --dist-dir ./dist

cp ./src/html/index.html ./dist/
cp ./src/css/styles.css ./dist/
cp ./src/img/sprites/ ./dist/sprites/ -r

cd dist
browser-sync start --server --files "./"
```