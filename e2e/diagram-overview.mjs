// Diagram 1 — the simple story (no jargon). Output: docs/diagrams/1-overview.{excalidraw,png,svg}
import { writeFileSync } from 'node:fs';
import { Diagram, C } from './diagram-lib.mjs';

const d = new Diagram(2420, 1470);
const OUT = new URL('../docs/diagrams/', import.meta.url).pathname;

d.text(60, 28, 'Mohar — what happens when Asha makes a health-insurance claim', { size: 64, font: 'title' });
d.text(62, 108, 'The simple version. Follow the numbers 1 → 7. Purple = Asha (patient) · Teal = hospital · Yellow = the blockchain "robot judge" · Blue = insurer', { size: 24, color: C.muted });

function card(n, x, y, title, body, fill, stroke, w = 520, h = 300) {
  d.box(x, y, w, h, { fill, stroke, sw: 2.5 });
  d.ellipse(x + 16, y + 14, 54, 54, { fill: C.white, solid: true, stroke, text: String(n), size: 28 });
  d.text(x + 84, y + 20, title, { size: 29, color: C.ink });
  d.text(x + 22, y + 88, body, { size: 23, color: C.ink, w: w - 40 });
}

const W = 520, Y1 = 180, Y2 = 590, X = [60, 640, 1220, 1800];
card(1, X[0], Y1, '# Asha proves she is real', "She uses her Aadhaar to prove:\n  ✔ she's a real person, 18+\n  ✘ WITHOUT showing her number,\n     name, photo or birthday\nOne Aadhaar = one account only.", C.violetBg, C.violet);
card(2, X[1], Y1, '# Hospital treats her', 'Diagnosis: breast cancer → chemo.\nThe medical record is locked in a\ndigital safe 🔐 (encrypted).\nOnly Asha holds the key — and\nwhoever she chooses to share with.', C.tealBg, C.teal);
card(3, X[2], Y1, '# Asha checks & signs', 'Hospital asks: "OK to claim ₹73,800?"\nHer phone re-does the maths using\nHER OWN copy of the policy.\nOnly if it all matches, she signs.\nNo signature = no claim, ever.', C.violetBg, C.violet);
card(4, X[3], Y1, '# Hospital seals a proof ✉', 'A maths proof that says "this claim\nfollows ALL the rules": licensed\nhospital, valid policy, covered,\nunder the limit, not claimed before…\n…without showing anything inside.', C.tealBg, C.teal);

card(5, X[3], Y2, '# Robot judge checks it 🤖', 'A messenger hands the sealed proof\nto the blockchain "robot judge"\n(a smart contract). It checks the\nmaths in seconds and decides.\nNo human reads any medical file.', C.yellowBg, C.yellow);
card(6, X[2], Y2, '# Paid to a secret mailbox 📬', 'Money goes to a brand-new address\nthat only the hospital can open.\nNobody can tell WHICH hospital got\npaid — so a cancer hospital\'s name\nnever leaks "Asha has cancer".', C.greenBg, C.green);
card(7, X[1], Y2, '# Insurer sees only… 🏦', '₹73,800   ✓ ✓ ✓ ✓ ✓ ✓\ndiagnosis ██████  hospital ██████\npatient   ██████  bill     ██████\n\nApproved and paid automatically,\nbefore Asha even leaves the hospital.', C.blueBg, C.blue);

// private vs public
d.box(60, Y2, 520, 300, { fill: C.grayBg, stroke: C.gray, sw: 2.5 });
d.text(82, Y2 + 18, '# 🔒 Stays private', { size: 27, color: C.violet });
d.text(82, Y2 + 64, 'diagnosis\nprocedure\nbill details\nwhich hospital\nwho the patient is\npolicy details', { size: 22 });
d.text(330, Y2 + 18, '# 🌍 Public', { size: 27, color: C.teal });
d.text(330, Y2 + 64, 'the amount\na "claim ID" code\n(proves no double\nclaim, means\nnothing else)\n✓ rules passed', { size: 22 });

// flow arrows
for (let i = 0; i < 3; i++) d.arrow(X[i] + W + 6, Y1 + 150, X[i + 1] - 6, Y1 + 150, { stroke: C.ink, sw: 2.5 });
d.arrow(X[3] + 260, Y1 + 306, X[3] + 260, Y2 - 6, { stroke: C.ink, sw: 2.5, label: 'messenger\n(relayer)', labelAt: [X[3] + 380, Y1 + 330], size: 20 });
d.arrow(X[3] - 6, Y2 + 150, X[2] + W + 6, Y2 + 150, { sw: 2.5 });
d.arrow(X[2] - 6, Y2 + 150, X[1] + W + 6, Y2 + 150, { sw: 2.5 });
d.arrow(X[1] - 6, Y2 + 150, 60 + 520 + 6, Y2 + 150, { sw: 2.5, dashed: true, label: 'result', labelAt: [610, Y2 + 104], size: 20 });

// extras
const Y3 = 990;
d.text(60, Y3 - 54, 'Also built in', { size: 40, font: 'title' });
function extra(x, title, body, fill, stroke) {
  d.box(x, Y3, 740, 270, { fill, stroke, sw: 2.5 });
  d.text(x + 24, Y3 + 18, title, { size: 29 });
  d.text(x + 24, Y3 + 72, body, { size: 23, w: 690 });
}
extra(60, '# 🩺 Sharing with a doctor', 'Asha gives Dr. Meera a key that works for 24 hours.\nEvery time the doctor looks, it is written in a\npublic log Asha can read. She can take access\nback anytime — the safe simply gets a new lock.\nOnly government-registered doctors can be added.', C.violetBg, C.violet);
extra(830, '# 🚑 Emergency (Asha is unconscious)', "A paramedic scans the QR on Asha's phone.\nAny 2 of her 3 trusted people (husband, doctor,\nsister) must approve. One alone can't unlock it.\nThen blood group, allergies & medicines open\nfor 24 hours — and every look is logged.", C.redBg, C.red);
extra(1600, '# 🛑 Cheaters get caught (14 / 14)', "Fake hospital? Expired policy? Claiming twice?\nChanging the amount? Splitting a big bill?\nSigning for the patient? Re-using someone\nelse's Aadhaar? → the proof can't even be made,\nor the robot judge rejects it. Live, every time.", C.yellowBg, C.yellow);

d.text(1210, 1320, 'Hiding the diagnosis in a proof isn’t enough if the payment leaks it.', { size: 34, align: 'center', font: 'title' });
d.text(1210, 1370, 'Mohar hides it everywhere.', { size: 44, align: 'center', font: 'title', color: C.violet });

writeFileSync(OUT + '1-overview.excalidraw', JSON.stringify(d.toExcalidraw(), null, 1));
await d.renderPng(OUT + '1-overview.png', new URL('./', import.meta.url).pathname);
console.log('diagram 1 done');
