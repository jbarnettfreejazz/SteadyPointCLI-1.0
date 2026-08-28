These six WAV files are sourced from VSCO 2 Community Edition by
Versilian Studios (https://github.com/sgossner/VSCO-2-CE), licensed
under CC0 1.0 Universal (public domain) — verified directly against
the LICENSE file in that repository. No attribution is legally
required, but it's noted here for the record:

Soft (gentle bowing) layer:
- cello.wav  — Strings/Cello Section/susvib/susvib_C1_v1_1.wav
- viola.wav  — Strings/Viola Section/susvib/ViolaEns_susvib_G2_v1_1.wav
- violin.wav — Strings/Solo Violin/Arco Vib/LLVln_ArcoVib_A4_p.wav

Loud (aggressive bowing) layer — same notes, recorded at a louder/
more vigorous bow velocity, used to crossfade toward as movement
intensity rises rather than just turning up the volume on the soft
layer:
- cello_loud.wav  — Strings/Cello Section/susvib/susvib_C1_v3_1.wav
- viola_loud.wav  — Strings/Viola Section/susvib/ViolaEns_susvib_G2_v2_1.wav
- violin_loud.wav — Strings/Solo Violin/Arco Vib/LLVln_ArcoVib_A4_f.wav

See src/services/audio.js for how these are pitch-shifted, gain-
controlled, and crossfaded (REFERENCE_FREQ constants there are a best
guess at each file's actual recorded pitch — see the note in that
file for why).
