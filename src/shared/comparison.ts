import type { ComparisonResult, InspectionReport, ReportChange } from './report';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === 'string' && value.length <= max;
const bounded = (value: unknown, max = 100): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
const nullableFee = (value: unknown) => value === null || bounded(value, 10000);
const decimal = (value: unknown) => text(value, 100) && /^\d+(\.\d+)?$/.test(value);
const oneOf = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);

export function isReport(value: unknown): value is InspectionReport {
  if (!object(value) || value.schemaVersion !== 1 || !oneOf(value.source, ['live', 'demo'])
    || !oneOf(value.cluster, ['mainnet-beta', 'devnet']) || !text(value.fetchedAt, 40)
    || !Number.isFinite(Date.parse(value.fetchedAt)) || !(value.slot === null || (Number.isSafeInteger(value.slot) && Number(value.slot) >= 0))) return false;
  const p = value.pool, l = value.launch, m = value.migration;
  if (!object(p) || !object(l) || !object(m)) return false;
  if (!['address', 'configAddress', 'baseMint', 'quoteMint', 'creator'].every(key => text(p[key], 64) && p[key].length > 0)
    || !text(p.quoteSymbol, 20) || !Number.isInteger(p.quoteDecimals) || !bounded(p.quoteDecimals, 18)
    || !decimal(p.quoteReserve) || !decimal(p.migrationThreshold)
    || !(p.progressPercent === null || bounded(p.progressPercent))) return false;
  if (!oneOf(l.stage, ['trading', 'curve-complete', 'migration-ready', 'migrated', 'unknown'])
    || !oneOf(l.migrationTarget, ['DAMM v2', 'DAMM v1', 'Unknown'])
    || !nullableFee(l.startingFeeBps) || !nullableFee(l.endingFeeBps) || typeof l.dynamicFees !== 'boolean'
    || !bounded(l.creatorTradingFeePercent) || !bounded(l.migrationFeePercent)
    || !text(l.feeClaimer, 64) || !text(l.leftoverReceiver, 64) || !Array.isArray(l.allocations) || l.allocations.length !== 2) return false;
  const owners = new Set<string>();
  for (const a of l.allocations) {
    if (!object(a) || !oneOf(a.owner, ['Partner', 'Creator']) || owners.has(String(a.owner))
      || !bounded(a.unlockedPercent) || !bounded(a.permanentLockedPercent) || !bounded(a.vestingPercent)
      || !(a.vestingDescription === null || text(a.vestingDescription))) return false;
    owners.add(String(a.owner));
  }
  return (m.dammPoolAddress === null || text(m.dammPoolAddress, 64))
    && (m.verified === null || typeof m.verified === 'boolean') && text(m.nextStep)
    && Array.isArray(value.checks) && value.checks.length <= 100 && value.checks.every(c => object(c) && text(c.id, 100)
      && text(c.title, 200) && text(c.detail) && oneOf(c.status, ['pass', 'warning', 'fail', 'unknown']))
    && Array.isArray(value.limitations) && value.limitations.length <= 100 && value.limitations.every(v => text(v))
    && Array.isArray(value.evidence) && value.evidence.length <= 100 && value.evidence.every(e => object(e)
      && text(e.label, 200) && text(e.address, 64) && oneOf(e.kind, ['account', 'token']));
}

export function compareReports(baseline: unknown, current: unknown): ComparisonResult {
  if (!isReport(baseline) || !isReport(current)) throw new Error('Import a complete LaunchCheck v1 JSON report.');
  if (baseline.pool.address !== current.pool.address || baseline.cluster !== current.cluster || baseline.source !== current.source) {
    throw new Error('Compare reports for the same pool, network and data source. Sample and live reports cannot be compared.');
  }
  const changes: ReportChange[] = [];
  const add = (field: string, before: unknown, after: unknown, category: ReportChange['category'] = 'configuration') => {
    if (before !== after) changes.push({ field, before: before === null ? 'Unknown' : String(before), after: after === null ? 'Unknown' : String(after), category });
  };
  for (const key of ['configAddress', 'baseMint', 'quoteMint', 'quoteDecimals', 'creator', 'migrationThreshold'] as const) add(`pool.${key}`, baseline.pool[key], current.pool[key]);
  for (const key of ['migrationTarget', 'startingFeeBps', 'endingFeeBps', 'dynamicFees', 'creatorTradingFeePercent', 'migrationFeePercent', 'feeClaimer', 'leftoverReceiver'] as const) add(`launch.${key}`, baseline.launch[key], current.launch[key]);
  for (const owner of ['Partner', 'Creator'] as const) {
    const a = baseline.launch.allocations.find(a => a.owner === owner)!;
    const b = current.launch.allocations.find(a => a.owner === owner)!;
    for (const key of ['unlockedPercent', 'permanentLockedPercent', 'vestingPercent', 'vestingDescription'] as const) add(`liquidity.${owner}.${key}`, a[key], b[key]);
  }
  add('pool.quoteReserve', baseline.pool.quoteReserve, current.pool.quoteReserve, 'state');
  add('launch.stage', baseline.launch.stage, current.launch.stage, 'state');
  add('migration.dammPoolAddress', baseline.migration.dammPoolAddress, current.migration.dammPoolAddress, 'state');
  add('migration.verified', baseline.migration.verified, current.migration.verified, 'state');
  return { baselineTime: baseline.fetchedAt, currentTime: current.fetchedAt, changes };
}
