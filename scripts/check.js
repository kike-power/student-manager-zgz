import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
for (const dir of ['server','client','scripts']) for (const file of await readdir(dir)) if (file.endsWith('.js')) {
  const check=spawnSync(process.execPath,['--check',`${dir}/${file}`],{encoding:'utf8'});
  if (check.status!==0) throw new Error(check.stderr);
}
const html=await readFile('index.html','utf8');
if (/signInAnonymously|signInWithEmailAndPassword|director123|gestio-aula-colegio|firebasejs/.test(html)) throw new Error('Hay acceso o configuración Firebase heredados.');
JSON.parse(await readFile('database.rules.json','utf8'));
console.log('Sintaxis y comprobación de acceso heredado correctas.');
