export interface ExamCenter {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
  status: 'SECURE' | 'PRINTING' | 'LOCKED_DOWN' | 'IDLE';
  candidatesCount: number;
  superintendent: string;
  observer: string;
  shardsReceived: number;
  dualAuthComplete: boolean;
  geofenceVerified: boolean;
}

export interface SecurityIncident {
  id: string;
  timestamp: string;
  examName: string;
  centerId: string;
  centerName: string;
  room: string;
  deskId: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  status: 'CONTAINED' | 'UNDER_INVESTIGATION' | 'RESOLVED';
  leakChannel: string;
  watermarkConfidence: number;
  actionTaken: string;
}

export interface ExamShard {
  id: string;
  name: string;
  serverLocation: string;
  cloudNode: string;
  status: 'DISTRIBUTED' | 'VERIFIED' | 'STAGED';
  fingerprint: string;
  sizeKb: number;
}

export const EXAM_CENTERS: ExamCenter[] = [
  {
    id: 'C-412',
    name: 'Sri Krishna Institute of Technology (SKIT Campus)',
    city: 'Bengaluru',
    state: 'Karnataka',
    lat: 13.0722,
    lng: 77.4984,
    status: 'SECURE',
    candidatesCount: 650,
    superintendent: 'Prof. Dr. R. K. Hegde',
    observer: 'K. S. Narayanan (IAS, Observer)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
  {
    id: 'C-108',
    name: 'Kendriya Vidyalaya IIT Powai',
    city: 'Mumbai',
    state: 'Maharashtra',
    lat: 19.1334,
    lng: 72.9133,
    status: 'SECURE',
    candidatesCount: 820,
    superintendent: 'Dr. Meera Deshmukh',
    observer: 'P. V. Kulkarni (IPS)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
  {
    id: 'C-205',
    name: 'Delhi Public School R.K. Puram',
    city: 'New Delhi',
    state: 'Delhi NCR',
    lat: 28.5672,
    lng: 77.1788,
    status: 'SECURE',
    candidatesCount: 1200,
    superintendent: 'Dr. Sanjeev Varma',
    observer: 'Anita Roy (Joint Secretary)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
  {
    id: 'C-319',
    name: 'St. Xavier\'s College Campus',
    city: 'Kolkata',
    state: 'West Bengal',
    lat: 22.5497,
    lng: 88.3569,
    status: 'SECURE',
    candidatesCount: 780,
    superintendent: 'Fr. Dominic Gomes',
    observer: 'S. Bhattacharya (WBCS)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
  {
    id: 'C-504',
    name: 'Jawaharlal Nehru Tech University (JNTU)',
    city: 'Hyderabad',
    state: 'Telangana',
    lat: 17.4933,
    lng: 78.3914,
    status: 'SECURE',
    candidatesCount: 950,
    superintendent: 'Prof. V. Srinivas',
    observer: 'M. Anuradha (IAS)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
  {
    id: 'C-622',
    name: 'Patna Science College Auditorium',
    city: 'Patna',
    state: 'Bihar',
    lat: 25.6207,
    lng: 85.1724,
    status: 'SECURE',
    candidatesCount: 890,
    superintendent: 'Dr. Rajeshwar Prasad',
    observer: 'Alok Kumar (BPSC Observer)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
  {
    id: 'C-715',
    name: 'Anna University Guindy Campus',
    city: 'Chennai',
    state: 'Tamil Nadu',
    lat: 13.0102,
    lng: 80.2356,
    status: 'SECURE',
    candidatesCount: 1100,
    superintendent: 'Dr. S. Thilagavathi',
    observer: 'K. Parthiban (IAS)',
    shardsReceived: 5,
    dualAuthComplete: true,
    geofenceVerified: true,
  },
];

export const INITIAL_INCIDENTS: SecurityIncident[] = [
  {
    id: 'INC-2026-0842',
    timestamp: '09:14:22 IST (T - 16m)',
    examName: 'NEET-UG 2026 (Physics/Chemistry)',
    centerId: 'C-412',
    centerName: 'SKIT Campus, Bengaluru',
    room: 'Room 204',
    deskId: 'Desk #42 (Roll: 88219)',
    severity: 'CRITICAL',
    status: 'CONTAINED',
    leakChannel: 'Encrypted Telegram Channel (Target Alpha)',
    watermarkConfidence: 99.4,
    actionTaken: 'Center 412 room locked down. Autonomous Paper Variant C deployed to 4,820 centers nationwide.',
  },
  {
    id: 'INC-2026-0791',
    timestamp: 'Yesterday 14:20 IST',
    examName: 'UPSC Civil Services Prelims GS-1',
    centerId: 'C-622',
    centerName: 'Patna Science College, Patna',
    room: 'Hall B',
    deskId: 'Desk #11 (Roll: 10423)',
    severity: 'MEDIUM',
    status: 'RESOLVED',
    leakChannel: 'Simulated Darknet Scraping Test',
    watermarkConfidence: 98.2,
    actionTaken: 'Forensic integrity verified. Pre-exam physical seal breach detected & reported to district magistrate.',
  },
];

export const SHARD_NODES: ExamShard[] = [
  {
    id: 'SHARD-ALPHA-01',
    name: 'Shard 1 (K-Polynomial Base)',
    serverLocation: 'NIC National Data Center, Shastri Park, New Delhi',
    cloudNode: 'GovCloud-North-1 (Air-Gapped)',
    status: 'DISTRIBUTED',
    fingerprint: '9f82a1b4e8703c12d991bce0458a10e782bc34',
    sizeKb: 412,
  },
  {
    id: 'SHARD-BETA-02',
    name: 'Shard 2 (Homomorphic Matrix)',
    serverLocation: 'C-DAC Supercomputing Facility, Pune',
    cloudNode: 'GovCloud-West-1 (Zero-Trust)',
    status: 'DISTRIBUTED',
    fingerprint: 'b3310ce9802fd1a44e568f121b6d08c5820f19',
    sizeKb: 398,
  },
  {
    id: 'SHARD-GAMMA-03',
    name: 'Shard 3 (Lattice Key-Exchange)',
    serverLocation: 'CERT-In Cyber Complex, Electronic City, Bengaluru',
    cloudNode: 'GovCloud-South-1 (Quantum-Resistant)',
    status: 'DISTRIBUTED',
    fingerprint: 'e8140ab12f459c771da210ee44589bb12480ac',
    sizeKb: 405,
  },
  {
    id: 'SHARD-DELTA-04',
    name: 'Shard 4 (Threshold Entropy Mask)',
    serverLocation: 'ISRO Master Control Facility, Hyderabad',
    cloudNode: 'GovCloud-Central-1 (Satellite Sync)',
    status: 'DISTRIBUTED',
    fingerprint: '77ac4901f402ed194a872bc0091ef450912cb8',
    sizeKb: 410,
  },
  {
    id: 'SHARD-EPSILON-05',
    name: 'Shard 5 (Shamir Secret Recovery)',
    serverLocation: 'STQC Standardization Complex, Salt Lake, Kolkata',
    cloudNode: 'GovCloud-East-1 (Encrypted Vault)',
    status: 'DISTRIBUTED',
    fingerprint: '4109ba22ff81ce4990ae31889c02ff8812c300',
    sizeKb: 401,
  },
];

export interface LeakedSampleCase {
  id: string;
  title: string;
  description: string;
  imageThumbnail: string;
  expectedCenter: string;
  expectedRoom: string;
  expectedDesk: string;
  expectedCandidate: string;
  noiseLevel: string;
  resolution: string;
}

export const SAMPLE_LEAK_CASES: LeakedSampleCase[] = [
  {
    id: 'CASE-01',
    title: 'Telegram Photo: Q.14 Electrostatics (Corner Crop)',
    description: 'Blurry camera photo snapped inside a classroom corner 18 minutes prior to exam commencement. Heavy lens distortion, high glare.',
    imageThumbnail: '/samples/leak_sample_1.png',
    expectedCenter: 'Center #412 (SKIT Campus, Bengaluru)',
    expectedRoom: 'Room 204',
    expectedDesk: 'Desk #42',
    expectedCandidate: 'Roll No: #88219 (K. R. Varma)',
    noiseLevel: 'High Gaussian & Motion Blur (Sigma: 2.8)',
    resolution: '720 x 1280 (Compressed)',
  },
  {
    id: 'CASE-02',
    title: 'WhatsApp Group Snapshot: Section B Calculus',
    description: 'Skewed phone photo with partial thumb occlusion and low-light shadows. Sourced from an unauthorized coaching center broadcast group.',
    imageThumbnail: '/samples/leak_sample_2.png',
    expectedCenter: 'Center #108 (KV IIT Powai, Mumbai)',
    expectedRoom: 'Hall 3, Row C',
    expectedDesk: 'Desk #18',
    expectedCandidate: 'Roll No: #44910 (P. S. Deshmukh)',
    noiseLevel: 'Medium Shadow & Vignetting',
    resolution: '1080 x 1920 (WhatsApp Compressed)',
  },
  {
    id: 'CASE-03',
    title: 'Counterfeit Public Test Paper (No Forensic Watermark)',
    description: 'A mock question paper circulating on social media claiming to be the actual exam. Intended to test system false-positive rejection.',
    imageThumbnail: '/samples/leak_sample_3.png',
    expectedCenter: 'NO EMBEDDED WATERMARK DETECTED',
    expectedRoom: 'N/A (Counterfeit / Hoax Paper)',
    expectedDesk: 'N/A',
    expectedCandidate: 'N/A',
    noiseLevel: 'Clean Digital Scan',
    resolution: '1440 x 2560',
  },
];
