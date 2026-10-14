All WAV files in this folder are sourced from VSCO 2 Community Edition by
Versilian Studios (https://github.com/sgossner/VSCO-2-CE), licensed under
CC0 1.0 Universal (public domain) — verified directly against the LICENSE
file in that repository. No attribution is legally required, but it's
noted here for the record.

Each string voice is multi-sampled (see ZonedSampleVoice and the
CELLO_ZONES / VIOLA_ZONES / VIOLIN_ZONES tables in src/services/audio.js):
the voice hands off between these notes as pitch rises, so each recording
is only pitch-shifted a few semitones. All are the soft (gentle bowing)
dynamic layer.

Pitches below were MEASURED (YIN pitch tracking over each file's 20%-80%
loop region; violin G3 confirmed from its harmonic series because its
fundamental is weak), not taken from file names. VSCO's Cello Section and
Viola Section labels are consistently one octave BELOW standard notation
("C1" = C2); the Solo Violin labels match standard notation.

Cello — Strings/Cello Section/susvib/
- cello.wav     — susvib_C1_v1_1.wav — C2   65.40Hz
- cello_g2.wav  — susvib_G1_v1_1.wav — G2   97.98Hz
- cello_d3.wav  — susvib_D2_v1_1.wav — D3  146.84Hz
- cello_a3.wav  — susvib_A2_v1_1.wav — A3  219.91Hz
- cello_e4.wav  — susvib_E3_v1_1.wav — E4  329.43Hz
- cello_b4.wav  — susvib_B3_v1_1.wav — B4  493.87Hz
- cello_f5.wav  — susvib_F4_v1_1.wav — F5  699.14Hz

Viola — Strings/Viola Section/susvib/
- viola_c3.wav  — ViolaEns_susvib_C2_v1_1.wav — C3  130.83Hz
- viola.wav     — ViolaEns_susvib_G2_v1_1.wav — G3  196.07Hz
- viola_d4.wav  — ViolaEns_susvib_D3_v1_1.wav — D4  293.75Hz
- viola_a4.wav  — ViolaEns_susvib_A3_v1_1.wav — A4  440.06Hz
- viola_e5.wav  — ViolaEns_susvib_E4_v1_1.wav — E5  659.54Hz
- viola_b5.wav  — ViolaEns_susvib_B4_v1_1.wav — B5  989.03Hz

Violin — Strings/Solo Violin/Arco Vib/
- violin_g3.wav — LLVln_ArcoVib_G3_p.wav — G3  195.5Hz
- violin_c4.wav — LLVln_ArcoVib_C4_p.wav — C4  264.79Hz (+21 cents)
- violin_g4.wav — LLVln_ArcoVib_G4_p.wav — G4  391.82Hz
- violin_c5.wav — LLVln_ArcoVib_C5_p.wav — C5  522.80Hz
- violin_g5.wav — LLVln_ArcoVib_G5_p.wav — G5  786.28Hz
- violin_c6.wav — LLVln_ArcoVib_C6_p.wav — C6 1043.09Hz
- violin_g6.wav — LLVln_ArcoVib_G6_p.wav — G6 1579.92Hz (+13 cents)

Removed in the Twenty-second follow-up (no longer used once the original
single-sample engine was retired): cello_loud.wav, viola_loud.wav,
violin_loud.wav (the "loud" velocity layers, unused since
DUAL_LAYER_ENABLED was turned off) and violin.wav (Solo Violin A4 p — not
one of the violin zones). Measured loop-region loudness of every file is
recorded in the zone tables in src/services/audio.js.
