import test from 'node:test';
import assert from 'node:assert/strict';
import { nucleotideBonds } from '../public/vendor/chemrender3d/nucleotide-bonds.js';
import { NUCLEOTIDE_BONDS } from '../public/vendor/chemrender3d/nucleotide-topology.js';

const atom=(atomName,x,element='C')=>({atomName,x,y:0,z:0,element});
const residue=(name,chain,points)=>({kind:'nucleic',name,letter:name.replace(/^D/,''),chain,atoms:new Map(points.map(p=>[p.atomName,p]))});
test('CCD connects base to sugar and sugar to phosphate, not base directly to P',()=>{
 const r=residue('DA','A',[atom('N9',0,'N'),atom("C1'",1.45),atom("C4'",10),atom("C5'",11.45),atom("O5'",12.9,'O'),atom('P',14.5,'P')]);
 const bonds=nucleotideBonds([r]);
 assert.ok(bonds.some(b=>new Set([b.a.atomName,b.b.atomName]).has('N9')&&new Set([b.a.atomName,b.b.atomName]).has("C1'")));
 assert.ok(bonds.some(b=>new Set([b.a.atomName,b.b.atomName]).has('P')&&new Set([b.a.atomName,b.b.atomName]).has("O5'")));
 assert.ok(!bonds.some(b=>[b.a.atomName,b.b.atomName].includes('P')&&[b.a.atomName,b.b.atomName].includes('N9')));
 assert.equal(nucleotideBonds([r],1).length,1);
});
test('phosphodiester links respect chains, distance, missing coordinates and legacy names',()=>{
 const left=residue('DC','A',[atom('O3*',0,'O')]),right=residue('DG','A',[atom('P',1.6,'P')]);
 assert.equal(nucleotideBonds([left,right]).filter(b=>b.kind==='phosphodiester').length,1);
 assert.equal(nucleotideBonds([left,{...right,chain:'B'}]).length,0);
 assert.equal(nucleotideBonds([left,residue('DG','A',[atom('P',9,'P')])]).length,0);
 assert.equal(nucleotideBonds([left,residue('DG','A',[])]).length,0);
 const phosphate=residue('DG','A',[atom('P',0,'P'),atom('O1P',1.5,'O')]);
 assert.equal(nucleotideBonds([phosphate]).length,1);
});
test('dictionary retains aromatic flags and double bonds for DNA and RNA',()=>{
 for(const key of ['DA','DC','DG','DT','A','C','G','U'])assert.ok(NUCLEOTIDE_BONDS[key].length>15);
 assert.ok(NUCLEOTIDE_BONDS.DA.some(b=>b[3]));
 assert.ok(NUCLEOTIDE_BONDS.DC.some(([a,b,o])=>o===2&&[a,b].includes('O2')));
 assert.ok(NUCLEOTIDE_BONDS.U.some(([a,b])=>[a,b].includes("O2'")));
 assert.ok(!NUCLEOTIDE_BONDS.DT.some(([a,b])=>[a,b].includes("O2'")));
});
