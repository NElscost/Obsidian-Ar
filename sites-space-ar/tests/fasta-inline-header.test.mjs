import test from "node:test";
import assert from "node:assert/strict";
import { createFastaExtension } from "../public/vendor/fasta/fasta-ar.js";

test("accepts sequence tokens appended to FASTA headers and skips empty records", () => {
  const extension = createFastaExtension({}, {});
  const model = extension.parse(`>gi|GenBank|Pitangus_ND2 Fragment ATGAACGAAAATCTATACAAAAGCCT AACATTCATCACCATC\n>\n>gi|GenBank|Philohydor_ND2 Fragment ATGAACGAAAATCTATACAAAAGCCT AACATTCATCACCACC`);
  assert.equal(model.sequences.length, 2);
  assert.equal(model.sequences[0].title, "gi|GenBank|Pitangus_ND2 Fragment");
  assert.equal(model.sequences[0].sequence, "ATGAACGAAAATCTATACAAAAGCCTAACATTCATCACCATC");
});
