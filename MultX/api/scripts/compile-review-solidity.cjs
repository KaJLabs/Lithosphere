'use strict';
const solc=require('solc');
if(!solc.version().startsWith('0.8.24+'))throw Error('review fixture requires solc 0.8.24');
const chunks=[];
process.stdin.on('data',chunk=>chunks.push(chunk));
process.stdin.on('end',()=>process.stdout.write(solc.compile(Buffer.concat(chunks).toString('utf8'))));
