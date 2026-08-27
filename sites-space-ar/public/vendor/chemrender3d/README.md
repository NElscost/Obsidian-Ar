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
