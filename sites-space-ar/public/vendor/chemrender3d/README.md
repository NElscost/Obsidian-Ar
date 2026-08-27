# Molecular detail in WebXR

DNA/RNA structures combine the existing chain backbone with colored nucleotide
ring polygons and atomic detail outside those rings. A/G use fused five- and
six-membered rings; C/T/U use six-membered rings. Vertices come from the loaded
CIF/PDB coordinates. Incomplete rings remain atomic; missing coordinates are
never invented. Colors identify bases, not validation quality scores.

The sequence above the structure uses a single transparent canvas texture,
outside the rotating molecular group. It shows the observed residues per chain
in FASTA-style text. This is not a full canonical FASTA export: unresolved
residues are absent. The display is limited to four chains and 48 letters per
chain, with explicit truncation indicators. Standard protein residue names are
also converted to one-letter sequence codes; protein geometry is unchanged.

Geometry is prepared only on opening, batched into at most five base-color
meshes, capped at 1,200 rings and disposed on closing. There is no per-frame
sequence layout or polygon calculation and no additional dependency or server
request. The public 1D28 structure produces 24 residues, 36 rings and 132
triangles, with CGTGAATTCACG in both chains.

Nucleotide labels show base, residue number and chain (e.g. G2 · A). They follow
the base while facing the viewer, obey depth testing and are capped at 48 labels.
In DNA/RNA ribbon mode, spheres now represent only water oxygen sites
(HOH/WAT/DOD/H2O), colored blue; other polymer atoms are not drawn as spheres.

## Nucleotide chemical detail

Local RCSB CCD bond tables for DA/DC/DG/DT and A/C/G/U describe sugar, phosphate,
base rings and substituents. DNA/RNA CIF/PDB files use the same residue-based
rendering, independent of filenames. Legacy prime/star and O1P/OP1 atom names
are accepted. Chemical bonds are drawn as instanced sticks colored by element
(carbon follows base color), with double bonds and dashed aromatic indicators
according to CCD annotations. Base polygons are inset to leave bonds visible.
The base connects through sugar, never directly to phosphate. Adjacent residues
are linked only by a plausible same-chain O3'-P bond; missing atoms and chain
breaks are not bridged. Water remains separate blue oxygen spheres.

Preparation happens once on opening, capped at 9,000 bonds. No server work or
runtime CCD download is required. Modified nucleotides and nonstandard atom
naming are not fully supported; this is a standard DNA/RNA renderer, not a
general crystallographic chemistry engine.
