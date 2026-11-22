// Minimal HL7 FHIR R4 builders — records are stored as FHIR Bundles so labs, pharmacies and other
// hospitals can consume them (bonus: cross-hospital sharing).

export interface EncounterInput {
  patientName: string;
  patientId: string;
  hospitalName: string;
  hfrId: string; // ABDM Health Facility Registry id
  diagnosis: { code: string; display: string };
  procedure: { code: string; display: string };
  medications: string[];
  allergies: string[];
  bloodGroup: string;
  observations: { code: string; display: string; value: number; unit: string }[];
  date: string; // ISO date
  billItems: { label: string; amount: number }[]; // paise
}

let n = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`;

export function encounterBundle(e: EncounterInput) {
  const pRef = { reference: `Patient/${e.patientId}` };
  const entries: any[] = [
    { resource: { resourceType: 'Patient', id: e.patientId, name: [{ text: e.patientName }] } },
    {
      resource: {
        resourceType: 'Organization',
        id: e.hfrId,
        identifier: [{ system: 'https://facility.abdm.gov.in', value: e.hfrId }],
        name: e.hospitalName,
      },
    },
    {
      resource: {
        resourceType: 'Condition',
        id: id('cond'),
        subject: pRef,
        code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', code: e.diagnosis.code, display: e.diagnosis.display }] },
        recordedDate: e.date,
      },
    },
    {
      resource: {
        resourceType: 'Procedure',
        id: id('proc'),
        status: 'completed',
        subject: pRef,
        code: { coding: [{ system: 'urn:kavach:procedure', code: e.procedure.code, display: e.procedure.display }] },
        performedDateTime: e.date,
      },
    },
    ...e.medications.map((m) => ({
      resource: { resourceType: 'MedicationRequest', id: id('med'), status: 'active', intent: 'order', subject: pRef, medicationCodeableConcept: { text: m } },
    })),
    ...e.allergies.map((a) => ({
      resource: { resourceType: 'AllergyIntolerance', id: id('alg'), patient: pRef, code: { text: a } },
    })),
    ...e.observations.map((o) => ({
      resource: {
        resourceType: 'Observation',
        id: id('obs'),
        status: 'final',
        subject: pRef,
        code: { coding: [{ system: 'http://loinc.org', code: o.code, display: o.display }] },
        valueQuantity: { value: o.value, unit: o.unit },
      },
    })),
    {
      resource: {
        resourceType: 'Claim',
        id: id('claim'),
        status: 'active',
        use: 'claim',
        patient: pRef,
        provider: { reference: `Organization/${e.hfrId}` },
        item: e.billItems.map((b, i) => ({ sequence: i + 1, productOrService: { text: b.label }, net: { value: b.amount / 100, currency: 'INR' } })),
        total: { value: e.billItems.reduce((a, b) => a + b.amount, 0) / 100, currency: 'INR' },
      },
    },
  ];
  return { resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), entry: entries, meta: { bloodGroup: e.bloodGroup } };
}

/** The minimum a first responder needs — stored separately, unlocked via break-glass. */
export function emergencyCard(e: Pick<EncounterInput, 'patientName' | 'bloodGroup' | 'allergies' | 'medications'> & { conditions: string[]; emergencyContact: string }) {
  return { resourceType: 'Bundle', type: 'collection', meta: { profile: ['urn:kavach:emergency-card'] }, card: e };
}
