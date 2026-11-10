import {readdirSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../dist');
function duplicates(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?duplicates(path.join(directory,entry.name)):/ \d+\.[^.]+$/.test(entry.name)?[path.relative(root,path.join(directory,entry.name))]:[]);}
const found=duplicates(root);
if(found.length)throw new Error(`Build contains ${found.length} sync-conflict duplicate files. Build from a non-synced checkout before packaging. Examples: ${found.slice(0,5).join(', ')}`);
console.log('PASS build artifacts: no sync-conflict duplicate files');
