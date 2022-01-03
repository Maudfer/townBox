# townBox

Simple city builder in javascript using Phaser engine

# Usage

npm install -g parcel-bundler
npm install -g browser-sync

cd src
parcel watch index.html --out-dir ../dist

cd dist
browser-sync start --server --files "."
