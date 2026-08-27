import { addNucleotideBonds } from './nucleotide-bonds.js?v=1';

// Built once per structure. No layout, canvas work or atom traversal per XR frame.
const BASES = { A:'A', C:'C', G:'G', T:'T', U:'U', DA:'A', DC:'C', DG:'G', DT:'T', DU:'U' };
const AMINO = { ALA:'A', ARG:'R', ASN:'N', ASP:'D', CYS:'C', GLN:'Q', GLU:'E', GLY:'G', HIS:'H', ILE:'I', LEU:'L', LYS:'K', MET:'M', PHE:'F', PRO:'P', SER:'S', THR:'T', TRP:'W', TYR:'Y', VAL:'V', MSE:'M' };
export const BASE_COLORS = { A:0xf0bc48, C:0x57a5fa, G:0x54c78b, T:0xef7485, U:0xb694ee };
const HEXAGON = ['N1','C2','N3','C4','C5','C6'];
const PENTAGON = ['C4','C5','N7','C8','N9'];

export function polymerResidues(atoms) {
  const residues = new Map();
  for (const atom of atoms) {
    const name = String(atom.residue || '').toUpperCase();
    if (!BASES[name] && !AMINO[name]) continue;
    const number = String(atom.residueNumber ?? '');
    if (!number || number === '.' || number === '?') continue;
    const key = JSON.stringify([atom.chain || '_', number, name]);
    let residue = residues.get(key);
    if (!residue) {
      residue = { chain:atom.chain || '_', number, name, letter:BASES[name] || AMINO[name], kind:BASES[name] ? 'nucleic' : 'protein', atoms:new Map() };
      residues.set(key, residue);
    }
    // Alternate conformations/models must not duplicate letters or ring vertices.
    if (!residue.atoms.has(atom.atomName)) residue.atoms.set(atom.atomName, atom);
  }
  return [...residues.values()].filter(r => r.kind === 'nucleic'
    ? r.atoms.has("C4'") || r.atoms.has('C4*')
    : r.atoms.has('CA'));
}

export function polymerSequences(residues) {
  const chains = new Map();
  for (const residue of residues) {
    const key = JSON.stringify([residue.chain, residue.kind]);
    if (!chains.has(key)) chains.set(key, { chain:residue.chain, kind:residue.kind, sequence:'' });
    chains.get(key).sequence += residue.letter;
  }
  // This is the observed coordinate sequence, not an assertion of missing residues.
  return [...chains.values()].sort((a,b) => a.chain.localeCompare(b.chain));
}

export function basePolygons(residues, limit = 1200) {
  const polygons = [], covered = new Set();
  for (const residue of residues) {
    if (residue.kind !== 'nucleic') continue;
    for (const names of (residue.letter === 'A' || residue.letter === 'G' ? [HEXAGON, PENTAGON] : [HEXAGON])) {
      if (polygons.length >= limit) return { polygons, covered };
      const points = names.map(name => residue.atoms.get(name));
      // Never fabricate a ring when the coordinate file is incomplete.
      if (points.some(p => !p || !Number.isFinite(p.x + p.y + p.z))) continue;
      polygons.push({ base:residue.letter, chain:residue.chain, number:residue.number, points });
      points.forEach(point => covered.add(point));
    }
  }
  return { polygons, covered };
}

export function waterAtoms(atoms) {
  return atoms.filter(atom => ['HOH','WAT','DOD','H2O'].includes(String(atom.residue || '').toUpperCase()) && atom.element === 'O');
}

export function baseLabelDescriptors(residues, limit = 48) {
  const entries = new Map();
  for (const polygon of basePolygons(residues).polygons) {
    const key = JSON.stringify([polygon.chain, polygon.number, polygon.base]);
    if (!entries.has(key)) entries.set(key, { text:polygon.base + polygon.number + ' · ' + polygon.chain, points:new Set() });
    polygon.points.forEach(point => entries.get(key).points.add(point));
  }
  const values = [...entries.values()], step = Math.max(1, Math.ceil(values.length / Math.max(1, limit)));
  return values.filter((_,index) => index % step === 0).map(entry => {
    const points = [...entry.points];
    return { text:entry.text, x:points.reduce((n,p)=>n+p.x,0)/points.length, y:points.reduce((n,p)=>n+p.y,0)/points.length, z:points.reduce((n,p)=>n+p.z,0)/points.length };
  });
}

export function addBasePolygons(THREE, target, residues, center, scale, chemicalDetail = true) {
  const { polygons, covered } = basePolygons(residues), batches = new Map();
  for (const polygon of polygons) {
    if (!batches.has(polygon.base)) batches.set(polygon.base, []);
    const vertices = batches.get(polygon.base), original = polygon.points;
    const centroid = {x:0,y:0,z:0};
    for(const p of original){centroid.x+=p.x/original.length;centroid.y+=p.y/original.length;centroid.z+=p.z/original.length;}
    const points = original.map(p=>({x:centroid.x+(p.x-centroid.x)*.62,y:centroid.y+(p.y-centroid.y)*.62,z:centroid.z+(p.z-centroid.z)*.62}));
    // Each chemical ring is convex; triangulate using its real CIF/PDB coordinates.
    for (let i = 1; i < points.length - 1; i++) {
      for (const p of [points[0], points[i], points[i + 1]]) vertices.push((p.x-center.x)*scale, (p.y-center.y)*scale, (p.z-center.z)*scale);
    }
  }
  for (const [base, vertices] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshPhongMaterial({ color:BASE_COLORS[base], emissive:BASE_COLORS[base], emissiveIntensity:.12, shininess:18, side:THREE.DoubleSide, toneMapped:false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'nucleotide-polygons-' + base;
    target.add(mesh);
  }
  if(chemicalDetail)addNucleotideBonds(THREE,target,residues,center,scale,BASE_COLORS,polygons);
  return covered;
}

export function sequenceLines(sequences) {
  const lines = [];
  for (const item of sequences.slice(0, 4)) {
    lines.push({ text:'>' + item.chain + ' | observed ' + (item.kind === 'nucleic' ? 'DNA/RNA' : 'protein'), header:true });
    const preview = item.sequence.slice(0, 48);
    lines.push({ text:preview + (preview.length < item.sequence.length ? '…' : ''), header:false });
  }
  if (sequences.length > 4) lines.push({ text:'+' + (sequences.length - 4) + ' chains', header:true });
  return lines;
}

export function addSequenceLabel(THREE, target, residues, width) {
  const lines = sequenceLines(polymerSequences(residues));
  if (!lines.length) return;
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = lines.length * 38 + 12;
  const ctx = canvas.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    ctx.font = (line.header ? '20' : '28') + 'px monospace';
    ctx.fillStyle = line.header ? '#bccbdd' : '#ffffff';
    ctx.fillText(line.text, canvas.width / 2, i * 38 + 25);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map:texture, transparent:true, depthTest:true, depthWrite:false, toneMapped:false }));
  const height = width * canvas.height / canvas.width;
  label.name = 'polymer-sequence';
  label.scale.set(width, height, 1);
  label.position.set(0, .19 + height / 2, .055);
  label.raycast = () => {};
  target.add(label);
}
