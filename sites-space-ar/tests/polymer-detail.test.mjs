import test from 'node:test';
import assert from 'node:assert/strict';
import { polymerResidues, polymerSequences, basePolygons, addBasePolygons, sequenceLines } from '../public/vendor/chemrender3d/polymer-detail.js';

const ringNames = ['N1','C2','N3','C4','C5','C6','N7','C8','N9',"C4'"];
function residue(name, number, chain='A') {
  return ringNames.map((atomName,i) => ({ atomName, residue:name, residueNumber:String(number), chain, x:Math.cos(i), y:Math.sin(i), z:0 }));
}
test('polymer sequence deduplicates conformations and excludes water/ligands', () => {
  const atoms = [...residue('DC',1), ...residue('DG',2), ...residue('DT',3), ...residue('DC',1), ...residue('DA',1,'B'), ...residue('HOH',1,'C')];
  assert.deepEqual(polymerSequences(polymerResidues(atoms)), [
    {chain:'A', kind:'nucleic', sequence:'CGT'}, {chain:'B', kind:'nucleic', sequence:'A'}
  ]);
  assert.equal(polymerResidues([{residue:'DA',residueNumber:'?',atomName:"C4'"}]).length,0);
  assert.equal(polymerSequences(polymerResidues([{residue:'ALA',residueNumber:'1',chain:'A',atomName:'CA'}]))[0].sequence,'A');
});
test('bases use one pyrimidine ring and two purine rings without inventing missing atoms', () => {
  const atoms = [...residue('DC',1), ...residue('DG',2)];
  const before = JSON.stringify(atoms), rings = basePolygons(polymerResidues(atoms));
  assert.deepEqual(rings.polygons.map(p=>p.points.length), [6,6,5]);
  assert.equal(rings.covered.size,15);
  assert.equal(JSON.stringify(atoms),before);
  assert.equal(basePolygons(polymerResidues(atoms),1).polygons.length,1);
  assert.equal(basePolygons(polymerResidues(residue('DC',1).filter(a=>a.atomName!=='N1'))).polygons.length,0);
});
test('polygon batches have bounded finite geometry and sequence preview preserves letters', () => {
  class Geometry { setAttribute(key,value){this[key]=value;} computeVertexNormals(){} }
  class Attribute { constructor(values,size){this.array=values;this.itemSize=size;} }
  class Material { constructor(options){Object.assign(this,options);} }
  class Mesh { constructor(geometry,material){Object.assign(this,{geometry,material});} }
  const THREE={BufferGeometry:Geometry,Float32BufferAttribute:Attribute,MeshPhongMaterial:Material,Mesh,DoubleSide:2};
  const children=[], target={add:m=>children.push(m)};
  addBasePolygons(THREE,target,polymerResidues([...residue('DC',1),...residue('DG',2)]),{x:0,y:0,z:0},.1,false);
  assert.equal(children.length,2);
  assert.ok(children.every(m=>m.geometry.position.array.every(Number.isFinite)));
  assert.equal(children.reduce((n,m)=>n+m.geometry.position.array.length/9,0),11);
  const lines=sequenceLines([{chain:'A',kind:'nucleic',sequence:'CGTGAATTCACG'}]);
  assert.equal(lines[1].text,'CGTGAATTCACG');
  assert.equal(sequenceLines([{chain:'A',kind:'protein',sequence:'A'.repeat(100)}])[1].text.length,49);
});

test('labels identify each base once, and spheres select only water oxygen', async () => {
  const {baseLabelDescriptors,waterAtoms}=await import('../public/vendor/chemrender3d/polymer-detail.js');
  const residues=polymerResidues([...residue('DG',2),...residue('DC',3,'B')]);
  const labels=baseLabelDescriptors(residues);
  assert.deepEqual(labels.map(l=>l.text),['G2 · A','C3 · B']);
  assert.ok(labels.every(l=>Number.isFinite(l.x+l.y+l.z)));
  assert.equal(baseLabelDescriptors(residues,1).length,1);
  const water={residue:'HOH',element:'O'};
  assert.deepEqual(waterAtoms([water,{residue:'DA',element:'O'},{residue:'HOH',element:'H'},{residue:'NA',element:'NA'}]),[water]);
});
