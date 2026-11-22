// Demo reference data: ICD-10 diagnoses, procedure codes (PM-JAY HBP-style), hospitals.
export const DIAGNOSES = [
  { code: 'C50.9', display: 'Breast cancer, unspecified', sensitive: true },
  { code: 'K35.80', display: 'Acute appendicitis', sensitive: false },
  { code: 'I21.9', display: 'Acute myocardial infarction', sensitive: false },
  { code: 'B20', display: 'HIV disease', sensitive: true },
  { code: 'F32.9', display: 'Major depressive disorder', sensitive: true },
  { code: 'N97.9', display: 'Female infertility', sensitive: true },
  { code: 'S72.0', display: 'Fracture of neck of femur', sensitive: false },
  { code: 'E11.9', display: 'Type 2 diabetes mellitus', sensitive: false },
  { code: 'Z41.1', display: 'Cosmetic surgery', sensitive: false },
];

export const PROCEDURES = [
  { code: 'SG039', display: 'Laparoscopic appendicectomy' },
  { code: 'MO012', display: 'Chemotherapy cycle (breast)' },
  { code: 'SO051', display: 'Modified radical mastectomy' },
  { code: 'MC011', display: 'PTCA with stent' },
  { code: 'OR004', display: 'Hip hemiarthroplasty' },
  { code: 'MG053', display: 'Inpatient psychiatric care' },
  { code: 'IV001', display: 'IVF cycle' },
  { code: 'PL007', display: 'Rhinoplasty (cosmetic)' },
];

export const HOSPITALS = [
  { name: 'AIIMS Raipur', hfrId: 'IN2210000101', city: 'Raipur', specialty: 'Multi-speciality' },
  { name: 'Balco Medical Centre', hfrId: 'IN2210000202', city: 'Naya Raipur', specialty: 'Oncology' },
  { name: 'Ramkrishna Care Hospital', hfrId: 'IN2210000303', city: 'Raipur', specialty: 'Cardiac' },
  { name: 'Sunrise IVF Clinic', hfrId: 'IN2210000404', city: 'Bilaspur', specialty: 'Fertility' },
];

export const BILL_TEMPLATES: Record<string, { label: string; amount: number }[]> = {
  SG039: [
    { label: 'Room (3 days)', amount: 900000 },
    { label: 'Surgeon fee', amount: 3500000 },
    { label: 'OT charges', amount: 2000000 },
    { label: 'Anaesthesia', amount: 800000 },
    { label: 'Medicines', amount: 450000 },
    { label: 'Diagnostics', amount: 350000 },
  ],
  MO012: [
    { label: 'Day-care bed', amount: 300000 },
    { label: 'Chemotherapy drugs', amount: 6500000 },
    { label: 'Oncologist fee', amount: 1500000 },
    { label: 'Lab tests', amount: 400000 },
  ],
  MC011: [
    { label: 'ICU (2 days)', amount: 3000000 },
    { label: 'Stent', amount: 3000000 },
    { label: 'Cath lab', amount: 4500000 },
    { label: 'Medicines', amount: 900000 },
  ],
};

export const formatINR = (paise: number) =>
  '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
