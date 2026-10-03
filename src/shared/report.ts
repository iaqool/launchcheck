export type Cluster = 'mainnet-beta' | 'devnet';
export type CheckStatus = 'pass' | 'warning' | 'fail' | 'unknown';
export type Stage = 'trading' | 'curve-complete' | 'migration-ready' | 'migrated' | 'unknown';

export interface Check {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
}

export interface Allocation {
  owner: 'Partner' | 'Creator';
  unlockedPercent: number;
  permanentLockedPercent: number;
  vestingPercent: number;
  vestingDescription: string | null;
}

export interface InspectionReport {
  schemaVersion: 1;
  source: 'live' | 'demo';
  cluster: Cluster;
  fetchedAt: string;
  slot: number | null;
  pool: {
    address: string;
    configAddress: string;
    baseMint: string;
    quoteMint: string;
    creator: string;
    quoteSymbol: string;
    quoteDecimals: number;
    /** Decimal token amounts, already scaled by quoteDecimals (not raw lamports). */
    quoteReserve: string;
    migrationThreshold: string;
    progressPercent: number | null;
  };
  launch: {
    stage: Stage;
    migrationTarget: 'DAMM v2' | 'DAMM v1' | 'Unknown';
    startingFeeBps: number | null;
    endingFeeBps: number | null;
    dynamicFees: boolean;
    creatorTradingFeePercent: number;
    migrationFeePercent: number;
    feeClaimer: string;
    leftoverReceiver: string;
    allocations: Allocation[];
  };
  migration: {
    dammPoolAddress: string | null;
    verified: boolean | null;
    nextStep: string;
  };
  checks: Check[];
  limitations: string[];
  evidence: { label: string; address: string; kind: 'account' | 'token' }[];
}

export interface ReportChange {
  field: string;
  before: string;
  after: string;
  category: 'configuration' | 'state';
}

export interface ComparisonResult {
  baselineTime: string;
  currentTime: string;
  changes: ReportChange[];
}

export interface ApiError {
  error: { code: string; message: string };
}
