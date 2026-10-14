import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareMigration,hash,firebaseHash} from '../scripts/migration-lib.js';
const data='data:application/octet-stream;base64,'+Buffer.from('file').toString('base64');
const source={usuarios:{u1:{id:'u1',nombre:'Teacher',email:'teacher@thepower.education',roles:['profesor'],pass:'secret'},u2:{id:'u2',nombre:'Pupil',email:'pupil@students.thepower.education',roles:['alumno'],pass:'secret'}},uidIndex:{old:'u1'},grupos:['A'],asignaturas:['Math'],asignaciones:{A:{profesores:{Math:'u1'}}},alumnos:{a1:{id:'a1',nombre:'A',apellidos:'Test',grupo:'A',docs:{d1:{id:'d1',nombre:'file',data}}}},tareas:{a1:{t1:{id:'t1',materia:'Math',cal:8,archivoProf:{nombre:'file',data}}},missing:{t2:{archivoAlumno:{nombre:'orphan',data}}}},auditoria:{old:{tipo:'Cambio',ts:1}},config:{emailjs:{publicKey:'legacy'}}};
const options={sourceSha256:hash(Buffer.from('source')),adminEmails:['admin@thepower.education']};
test('migration deduplicates content and preserves all references, grades and orphan records',()=>{
  const {root,objects,report}=prepareMigration(source,options);
  assert.equal(objects.size,1);assert.equal(report.attachments,3);assert.equal(report.sourceTasks,2);assert.equal(report.tasks,1);assert.equal(report.quarantinedTasks,1);
  assert.equal(root.app.tareas.a1.t1.cal,8);assert.equal(root.app.tareas.missing,undefined);
  assert.equal(root.migrationQuarantine.orphans.tareas.missing.t2.archivoAlumno.fileId,root.app.alumnos.a1.docs.d1.fileId);
  assert.equal(root.app.auditoria.old.origen,'importada');
  assert.equal(JSON.stringify(source).includes('data:application/octet-stream'),true);
});
test('migration removes passwords everywhere and never gives pupils or family access',()=>{
  const {root,report}=prepareMigration(source,options);
  assert.equal(report.credentialsRemoved,2);assert.equal(root.app.usuarios.u2,undefined);assert.equal(root.migrationQuarantine.usuarios.u2.pass,undefined);
  assert.equal(JSON.stringify(root).includes('secret'),false);
  assert.equal(JSON.stringify(root).includes('base64,'),false);
  assert.equal(root.app.config.emailjs,undefined);assert.ok(root.migrationQuarantine.config.emailjs);
});
test('only designated admins keep admin permissions; old IDs and module assignments are preserved',()=>{
  const input=structuredClone(source);input.usuarios.u1.roles=['director','profesor'];
  const {root}=prepareMigration(input,options);
  assert.deepEqual(root.app.usuarios.u1.roles,['profesor']);assert.equal(root.app.asignaciones.A.profesores.Math,'u1');
  assert.equal(Object.values(root.app.usuarios).filter(u=>u.roles.includes('director')).length,1);
});
test('post-import verification tolerates Firebase empty-container and numeric-key normalization',()=>{
  const original={grupos:['A','B'],faltas:{9:{1:'P',2:'A'}},usuarios:{u1:{grupos:[],materias:[],roles:['profesor']}},empty:{},removed:null};
  const stored={usuarios:{u1:{roles:['profesor']}},faltas:{9:[null,'P','A']},grupos:['A','B']};
  assert.equal(firebaseHash(original),firebaseHash(stored));
  stored.faltas[9][1]='J';assert.notEqual(firebaseHash(original),firebaseHash(stored));
});
