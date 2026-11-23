import {readdirSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');

function duplicates(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?duplicates(path.join(directory,entry.name)):/ \d+\.[^.]+$/.test(entry.name)?[path.relative(root,path.join(directory,entry.name))]:[]);}

const found=['dist','src','electron','scripts'].flatMap(directory=>duplicates(path.join(root,directory)));

if(found.length)throw new Error(`Build/source contains ${found.length} sync-conflict duplicate files. Compare and archive them before packaging. Examples: ${found.slice(0,5).join(', ')}`);

console.log('PASS build/source artifacts: no sync-conflict duplicate files');
