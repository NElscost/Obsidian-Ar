# MIDI score and playback

The score renderer (`public/midi-score.js`) prepares a static page only when
the displayed page changes. Its independent transparent, curved overlay draws
the same glyphs for all sounding notes: noteheads, stems, accidentals, dots,
ties and ledger lines. The overlay texture changes only when the active note
set changes, sampled at most 25 times per second. It uses exact MIDI times,
not display quantization or the piano roll's duration cap.

Notation improvements:

- Key signatures establish default alterations. Local accidents persist within
  their staff, octave and measure, with naturals to cancel them.
- Enharmonic spelling determines staff position, including flat notes and
  key-implied E-sharp/B-sharp/C-flat. Within-page key changes are represented
  through local accidents relative to the displayed system signature.
- Ledger lines start outside the five-line staff.
- Staff clefs and explicitly labeled 8va/8vb registers minimize excessive
  ledger lines. Second-interval chord heads are staggered horizontally.
- Measures receive widths based on event density, with margins around barlines.

The Rust bridge supplies sorted start/end events and page-to-note indices.
Older bridges remain compatible: the browser builds equivalent indices once
per loaded MIDI. Sequential playback processes only events crossed by the
clock; seeking rebuilds the active set. The piano roll uses that active set
and a binary-searched lookahead, rather than scanning all earlier notes.

Restart the local bridge after updating its Rust source to rebuild it and use
the server-generated indices. Playback timing and audio synthesis are unchanged.

Limitations: raw MIDI does not preserve the original engraved score. This is
still a simplified transcription: voice assignment, beams, tuplets, cross-system
ties, pedal notation and changing time signatures need further work. The
renderer does not claim MuseScore-level engraving fidelity. Tests cover pitch
spelling, accidentals, ledger lines, chords, seeks, glyph reuse and bridge events;
Quest visual/performance testing remains necessary.
