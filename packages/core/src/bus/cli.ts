import { readFileSync, writeFileSync } from 'node:fs';
import { osmToBusLines } from './osm.js';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: tsx src/bus/cli.ts <overpass.json> <lines.json>');
  process.exit(1);
}
const file = osmToBusLines(JSON.parse(readFileSync(input, 'utf8')));
writeFileSync(output, JSON.stringify(file, null, 2), 'utf8');
console.log(`routes: ${file.routes.length}, dropped: ${file.dropped.length}`);
