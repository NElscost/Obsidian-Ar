import { NUCLEOTIDE_BONDS } from './nucleotide-topology.js';

function atomAt(residue, name) {
  return residue.atoms.get(name) || residue.atoms.get(name.replace(/'/g, '*')) ||
    residue.atoms.get(({ OP1:'O1P', OP2:'O2P', OP3:'O3P' })[name]);
}
function plausible(a,b,max=2.25) {
  if(!a||!b)return false;
  const d=Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  return Number.isFinite(d)&&d>.4&&d<max;
}

// Local CCD topology, not all-pairs inference: no water or inter-strand bonds.
export function nucleotideBonds(residues, limit=9000) {
  const bonds=[], chains=new Map();
  for(const residue of residues){
    if(residue.kind!=='nucleic')continue;
    const topology=NUCLEOTIDE_BONDS[residue.name] || NUCLEOTIDE_BONDS[residue.letter==='T'?'DT':residue.letter];
    if(!topology)continue;
    for(const [left,right,order,aromatic] of topology){
      const a=atomAt(residue,left),b=atomAt(residue,right);
      if(plausible(a,b))bonds.push({a,b,order,aromatic,base:residue.letter,kind:'residue'});
      if(bonds.length>=limit)return bonds;
    }
    if(!chains.has(residue.chain))chains.set(residue.chain,[]);
    chains.get(residue.chain).push(residue);
  }
  for(const chain of chains.values()){
    for(let i=1;i<chain.length;i++){
      const a=atomAt(chain[i-1],"O3'"),b=atomAt(chain[i],'P');
      // Distance guard preserves chain breaks and incomplete experimental models.
      if(plausible(a,b,2.1))bonds.push({a,b,order:1,aromatic:false,base:chain[i].letter,kind:'phosphodiester'});
      if(bonds.length>=limit)return bonds;
    }
  }
  return bonds;
}

export function addNucleotideBonds(THREE,target,residues,center,scale,baseColors,polygons){
  const batches=new Map(),colors={N:0x527dff,O:0xf06464,P:0xf4a448,S:0xf1d348};
  const point=a=>new THREE.Vector3((a.x-center.x)*scale,(a.y-center.y)*scale,(a.z-center.z)*scale);
  const add=(a,b,color,radius)=>{const key=color+':'+radius;if(!batches.has(key))batches.set(key,{color,radius,segments:[]});batches.get(key).segments.push([a,b]);};
  const ringCenters=new Map();
  for(const polygon of polygons){
    const c=polygon.points.reduce((v,p)=>v.add(point(p)),new THREE.Vector3()).multiplyScalar(1/polygon.points.length);
    polygon.points.forEach(p=>{if(!ringCenters.has(p))ringCenters.set(p,c);});
  }
  const radius=Math.min(.0016,Math.max(.00045,scale*.11));
  for(const bond of nucleotideBonds(residues)){
    const a=point(bond.a),b=point(bond.b),axis=b.clone().sub(a),mid=a.clone().add(b).multiplyScalar(.5);
    const c=ringCenters.get(bond.a)||ringCenters.get(bond.b);
    let side=c?c.clone().sub(mid):new THREE.Vector3(0,0,1).cross(axis);
    side.addScaledVector(axis,-side.dot(axis)/axis.lengthSq());
    if(side.lengthSq()<1e-12)side=new THREE.Vector3(1,0,0).cross(axis);
    side.normalize().multiplyScalar(scale*.18);
    // Aromatic bonds: solid outer bond plus dashed inset resonance indicator.
    const lanes=bond.aromatic?1:bond.order;
    for(let lane=0;lane<lanes;lane++){
      const offset=side.clone().multiplyScalar(lanes===1?0:lane-.5),start=a.clone().add(offset),end=b.clone().add(offset),half=start.clone().add(end).multiplyScalar(.5);
      add(start,half,colors[bond.a.element]||baseColors[bond.base],radius);
      add(half,end,colors[bond.b.element]||baseColors[bond.base],radius);
    }
    if(bond.aromatic&&c){
      const start=a.clone().lerp(c,.18),end=b.clone().lerp(c,.18);
      for(let dash=0;dash<3;dash++)add(start.clone().lerp(end,(dash+.15)/3),start.clone().lerp(end,(dash+.68)/3),baseColors[bond.base],radius*.6);
    }
  }
  const transform=new THREE.Object3D(),up=new THREE.Vector3(0,1,0),direction=new THREE.Vector3();
  for(const {color,radius,segments} of batches.values()){
    const geometry=new THREE.CylinderGeometry(radius,radius,1,5),material=new THREE.MeshBasicMaterial({color,toneMapped:false});
    const mesh=new THREE.InstancedMesh(geometry,material,segments.length);
    mesh.name='nucleotide-chemical-bonds';
    segments.forEach(([a,b],i)=>{direction.copy(b).sub(a);transform.position.copy(a).add(b).multiplyScalar(.5);transform.quaternion.setFromUnitVectors(up,direction.clone().normalize());transform.scale.set(1,direction.length(),1);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);});
    mesh.instanceMatrix.needsUpdate=true;mesh.frustumCulled=false;target.add(mesh);
  }
}
