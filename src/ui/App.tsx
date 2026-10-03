import { useEffect, useRef, useState } from 'react';
import type { ApiError, Check, Cluster, ComparisonResult, InspectionReport } from '../shared/report';
import { isReport } from '../shared/comparison';

const DEMOS = [
  { id: 'trading', label: 'Curve trading' },
  { id: 'pending', label: 'Migration expected' },
  { id: 'migrated', label: 'DAMM v2 created' },
] as const;
const MIGRATOR_URL = 'https://migrator.meteora.ag/';
type UiError = { title: string; message: string };

function shorten(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-7)}` : value;
}
export function displayAmount(raw: string, symbol: string) {
  try {
    const [integer, fraction = ''] = raw.split('.');
    const whole = BigInt(integer);
    return `${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${symbol}`;
  } catch { return `${raw} ${symbol}`; }
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}
function stageInfo(stage: InspectionReport['launch']['stage']) {
  switch (stage) {
    case 'trading': return { step: 0, title: 'Curve trading', tag: 'On curve' };
    case 'curve-complete': return { step: 1, title: 'Curve complete', tag: 'Complete' };
    case 'migration-ready': return { step: 1, title: 'Migration ready', tag: 'Ready to migrate' };
    case 'migrated': return { step: 2, title: 'DAMM v2 created', tag: 'Migrated' };
    default: return { step: -1, title: 'Stage unknown', tag: 'Unknown' };
  }
}
function solscan(address: string, cluster: Cluster) {
  return `https://solscan.io/account/${encodeURIComponent(address)}${cluster === 'devnet' ? '?cluster=devnet' : ''}`;
}
function Icon({ name }: { name: 'arrow' | 'download' | 'upload' | 'external' | 'chevron' }) {
  const paths = {
    arrow: <><path d="M4 12h15"/><path d="m13 5 7 7-7 7"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/></>,
    external: <><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    chevron: <path d="m7 10 5 5 5-5"/>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
function Address({ value, cluster, label, source }: { value: string; cluster: Cluster; label: string; source?: InspectionReport['source'] }) {
  if (source === 'demo') return <span className="address sample-address" title={value} aria-label={`${label}: ${value}, sample address`}>{shorten(value)}<small>sample</small></span>;
  return <a className="address" href={solscan(value, cluster)} target="_blank" rel="noreferrer" aria-label={`${label}: ${value}, open in Solscan`} title={value}>{shorten(value)}<Icon name="external" /></a>;
}
function CheckMark({ status }: { status: Check['status'] }) {
  return <span className={`check-mark ${status}`} aria-label={status}>{status === 'pass' ? '✓' : status === 'fail' ? '×' : status === 'warning' ? '!' : '?'}</span>;
}
function Lifecycle({ report }: { report: InspectionReport }) {
  const info = stageInfo(report.launch.stage);
  return <section className="lifecycle" aria-label={`Launch lifecycle: ${info.title}`}>
    <div className="lifecycle-head"><div><span className="eyebrow">LIFECYCLE PASSPORT</span><h2>Where this pool stands</h2></div><span className={`stage-tag stage-${report.launch.stage}`}>{info.tag}</span></div>
    <div className={`track step-${info.step}`}>
      <div className="track-line" aria-hidden="true"><span /></div>
      {['DBC trading', 'Curve complete', 'DAMM v2 created'].map((label, i) => <div className={`track-node ${info.step >= i ? 'reached' : ''} ${info.step === i ? 'current' : ''}`} key={label}>
        <span className="node-dot">{info.step > i ? '✓' : i + 1}</span><span className="node-label">{label}</span>
      </div>)}
    </div>
    <p className="stage-note">{report.launch.stage === 'migration-ready' ? 'The curve is complete. A DAMM pool has not been confirmed yet.' : report.launch.stage === 'curve-complete' ? 'The curve reached its threshold; migration is not confirmed.' : report.launch.stage === 'migrated' ? 'A DAMM pool is present. Review the evidence and checks below.' : report.launch.stage === 'trading' ? 'Trading is still progressing toward the migration threshold.' : 'The available account data does not establish a lifecycle stage.'}</p>
  </section>;
}
function Fees({ report }: { report: InspectionReport }) {
  const { launch } = report;
  const fee = (bps: number | null) => bps === null ? 'Unknown' : `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
  return <div className="fee-box">
    <div className="fee-main"><span className="eyebrow">FEE SCHEDULE</span><strong>{fee(launch.startingFeeBps)} <span>→</span> {fee(launch.endingFeeBps)}</strong><span className="muted">Starting → ending</span></div>
    <div className="fee-details"><span>Creator fee share <b>{launch.creatorTradingFeePercent}%</b></span><span>Partner/creator migration fee <b>{launch.migrationFeePercent}%</b></span></div>
    <p className="fee-caveat">Creator share is a share of distributable trading fees. Protocol migration fees are separate from the partner/creator fee shown here.</p>
    {launch.dynamicFees && <p className="fee-caveat"><span aria-hidden="true">i</span> Dynamic fees apply. This schedule does not represent the exact current trade fee.</p>}
  </div>;
}
function Facts({ report }: { report: InspectionReport }) {
  const { pool, launch, migration } = report;
  return <div className="facts-column">
    <section className="panel facts-panel"><div className="panel-title"><div><span className="eyebrow">POOL FACTS</span><h2>On-chain details</h2></div></div>
      <div className="fact-list">
        <div className="fact-row"><span>Pool address</span><Address value={pool.address} cluster={report.cluster} label="Pool address" source={report.source} /></div>
        <div className="fact-row"><span>Config</span><Address value={pool.configAddress} cluster={report.cluster} label="Config address" source={report.source} /></div>
        <div className="fact-row"><span>Base mint</span><Address value={pool.baseMint} cluster={report.cluster} label="Base mint" source={report.source} /></div>
        <div className="fact-row"><span>Quote mint</span><Address value={pool.quoteMint} cluster={report.cluster} label="Quote mint" source={report.source} /></div>
        <div className="fact-row"><span>Creator</span><Address value={pool.creator} cluster={report.cluster} label="Creator" source={report.source} /></div>
      </div>
      <div className="reserve-grid"><div className="reserve"><span className="eyebrow">QUOTE RESERVE</span><strong>{displayAmount(pool.quoteReserve, pool.quoteSymbol)}</strong></div><div className="reserve"><span className="eyebrow">MIGRATION THRESHOLD</span><strong>{displayAmount(pool.migrationThreshold, pool.quoteSymbol)}</strong></div></div>
      <div className="progress-area"><div className="progress-label"><span>Curve progress</span><strong>{pool.progressPercent === null ? 'Unknown' : `${pool.progressPercent.toFixed(1)}%`}</strong></div><div className="progress-track" role="progressbar" aria-label="Curve progress" aria-valuenow={pool.progressPercent ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.max(0, Math.min(100, pool.progressPercent ?? 0))}%` }} /></div></div>
      <Fees report={report} />
    </section>
    <section className="panel"><div className="panel-title"><div><span className="eyebrow">FEE RECIPIENTS</span><h2>Where fees go</h2></div></div><div className="fact-list recipient-list">
      <div className="fact-row"><span>Fee claimer</span><Address value={launch.feeClaimer} cluster={report.cluster} label="Fee claimer" source={report.source} /></div>
      <div className="fact-row"><span>Leftover receiver</span><Address value={launch.leftoverReceiver} cluster={report.cluster} label="Leftover receiver" source={report.source} /></div>
    </div></section>
    <section className="panel"><div className="panel-title"><div><span className="eyebrow">LP ALLOCATION</span><h2>Liquidity split</h2></div></div>
      {launch.allocations.length ? <div className="allocation-list">{launch.allocations.map((a) => <article className="allocation" key={a.owner}><div className="allocation-head"><b>{a.owner}</b><span>{a.unlockedPercent + a.permanentLockedPercent + a.vestingPercent}% total</span></div><div className="allocation-bar" role="img" aria-label={`${a.owner}: ${a.unlockedPercent}% unlocked, ${a.permanentLockedPercent}% permanently locked, ${a.vestingPercent}% vesting`}><span className="unlocked" style={{ width: `${a.unlockedPercent}%` }} /><span className="locked" style={{ width: `${a.permanentLockedPercent}%` }} /><span className="vesting" style={{ width: `${a.vestingPercent}%` }} /></div><div className="allocation-legend"><span><i className="unlocked" />Unlocked {a.unlockedPercent}%</span><span><i className="locked" />Locked {a.permanentLockedPercent}%</span><span><i className="vesting" />Vesting {a.vestingPercent}%</span></div>{a.vestingDescription && <p className="muted allocation-note">{a.vestingDescription}</p>}</article>)}</div> : <p className="muted empty-inline">No allocation data reported.</p>}
    </section>
    <section className="panel migration-panel"><div className="panel-title"><div><span className="eyebrow">MIGRATION</span><h2>{migration.dammPoolAddress ? 'Target pool found' : 'Next step'}</h2></div></div>
      {migration.dammPoolAddress && <div className="fact-row target-row"><span>DAMM pool</span><Address value={migration.dammPoolAddress} cluster={report.cluster} label="DAMM pool" source={report.source} /></div>}
      <p>{migration.nextStep}</p><a className="text-link" href={MIGRATOR_URL} target="_blank" rel="noreferrer">Open Meteora manual migrator <Icon name="external" /></a>
    </section>
  </div>;
}
function ReportView({ report, onDownload }: { report: InspectionReport; onDownload: () => void }) {
  return <>
    <div className="report-meta"><span className={`source-chip ${report.source}`}><i />{report.source === 'demo' ? 'SAMPLE DATA' : 'LIVE READ'}</span><span>{report.cluster}</span><span>Read {time(report.fetchedAt)}</span>{report.slot !== null && <span>Slot {report.slot.toLocaleString()}</span>}<button className="download-btn" onClick={onDownload}><Icon name="download" /> Export JSON</button></div>
    {report.source === 'demo' && <div className="sample-banner"><b>Sample report</b><span>Illustrative data only. No pool was read from the network.</span></div>}
    <Lifecycle report={report} />
    <div className="report-grid"><Facts report={report} /><div className="checks-column">
      <section className="panel checks-panel"><div className="panel-title"><div><span className="eyebrow">ACCOUNT-BASED REVIEW</span><h2>Checks</h2></div><span className="checks-count">{report.checks.length} checks</span></div>
        {report.checks.length ? <ul className="check-list">{report.checks.map((check) => <li className={`check-item ${check.status}`} key={check.id}><CheckMark status={check.status} /><div><b>{check.title}</b><p>{check.detail}</p></div><span className="status-word">{check.status}</span></li>)}</ul> : <p className="muted empty-inline">No checks are available for this report.</p>}
      </section>
      <section className="panel evidence-panel"><div className="panel-title"><div><span className="eyebrow">READ CONTEXT</span><h2>Evidence & limits</h2></div></div><p className="muted">Account addresses read for this snapshot</p><ul className="evidence-list">{report.evidence.map((item, i) => <li key={`${item.address}-${i}`}><span>{item.label}<small>{item.kind}</small></span><Address value={item.address} cluster={report.cluster} label={item.label} source={report.source} /></li>)}</ul>
        <div className="limitations"><b>Limitations</b>{report.limitations.length ? <ul>{report.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>No additional limitations reported.</p>}</div>
      </section>
      <p className="disclaimer">This passport reports observed account data and limited checks. It is not a security audit or a price prediction.</p>
    </div></div>
  </>;
}
async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) {
    const apiError = body as ApiError;
    throw new Error(apiError?.error?.message || `Request failed (${response.status})`);
  }
  return body as T;
}

export default function App() {
  const [address, setAddress] = useState('');
  const [cluster, setCluster] = useState<Cluster>('mainnet-beta');
  const [demo, setDemo] = useState<(typeof DEMOS)[number]['id']>('trading');
  const [report, setReport] = useState<InspectionReport | null>(null);
  const [baseline, setBaseline] = useState<InspectionReport | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UiError | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inFlight = (work: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort();
    const thisId = ++requestId.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setBusy(true); setError(null); setReport(null); setComparison(null); setCompareError(null);
    void work(nextController.signal).finally(() => { if (thisId === requestId.current) setBusy(false); });
  };
  useEffect(() => () => controller.current?.abort(), []);
  const inspect = (event: React.FormEvent) => {
    event.preventDefault();
    const value = address.trim();
    if (!value) { setError({ title: 'Pool address required', message: 'Enter a DBC pool address to inspect.' }); return; }
    inFlight(async (signal) => {
      try {
        const query = new URLSearchParams({ address: value, cluster });
        const result = await fetch(`/api/inspect?${query}`, { signal }).then((r) => responseJson<InspectionReport>(r));
        if (signal.aborted) return;
        setReport(result);
      } catch (e) {
        if (signal.aborted) return;
        setError({ title: 'Pool inspection failed', message: e instanceof Error ? e.message : 'The inspection request could not be completed.' });
      }
    });
  };
  const loadDemo = () => inFlight(async (signal) => {
    try {
      const result = await fetch(`/api/demo?scenario=${encodeURIComponent(demo)}`, { signal }).then((r) => responseJson<InspectionReport>(r));
      if (signal.aborted) return;
      setReport(result); setError(null);
    } catch (e) {
      if (signal.aborted) return;
      setError({ title: 'Sample unavailable', message: e instanceof Error ? e.message : 'Could not load sample data.' });
    }
  });
  const download = () => {
    if (!report) return;
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `launchcheck-${report.cluster}-${report.pool.address.slice(0, 8)}.json`; link.click(); URL.revokeObjectURL(url);
  };
  const importBaseline = async (file?: File) => {
    if (!file) return;
    setComparison(null); setCompareError(null);
    if (file.size > 256 * 1024) { setBaseline(null); setCompareError('This file is larger than the 256 KB import limit.'); return; }
    try {
      const parsed = JSON.parse(await file.text()) as InspectionReport;
      if (!isReport(parsed)) throw new Error('This file is not a complete LaunchCheck report (schema version 1).');
      setBaseline(parsed);
    } catch (e) { setBaseline(null); setCompareError(e instanceof Error ? e.message : 'Could not read this report.'); }
  };
  const compare = () => {
    if (!report || !baseline) return;
    setCompareError(null); setComparison(null);
    const thisId = ++requestId.current;
    controller.current?.abort();
    const nextController = new AbortController(); controller.current = nextController; setBusy(true);
    void fetch('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseline, current: report }), signal: nextController.signal })
      .then((r) => responseJson<ComparisonResult>(r)).then((result) => { if (thisId === requestId.current) setComparison(result); })
      .catch((e) => { if (thisId === requestId.current && !nextController.signal.aborted) setCompareError(e instanceof Error ? e.message : 'Could not compare these reports.'); })
      .finally(() => { if (thisId === requestId.current) setBusy(false); });
  };
  const clearReport = () => { controller.current?.abort(); requestId.current += 1; setBusy(false); setReport(null); setBaseline(null); setComparison(null); setError(null); setCompareError(null); };
  const isDemo = report?.source === 'demo';
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top" aria-label="LaunchCheck home"><span className="brand-mark"><i /><i /><i /></span><span>Launch<span>Check</span></span></a><div className="topbar-right"><span className="read-only"><span />READ ONLY</span><span className="network-caption">Meteora DBC</span></div></header>
    <div className="workspace" id="top">
      <aside className="control-rail"><div className="rail-heading"><span className="eyebrow">POOL INSPECTOR</span><h1>Launch<br />passport</h1><p>Read a DBC pool and follow its path from curve to DAMM v2.</p></div>
        <form className="inspect-form" onSubmit={inspect}>
          <label htmlFor="pool-address">DBC pool address</label><input id="pool-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Paste pool address" autoComplete="off" spellCheck={false} />
          <label htmlFor="cluster">Network</label><div className="select-wrap"><select id="cluster" value={cluster} onChange={(e) => setCluster(e.target.value as Cluster)}><option value="mainnet-beta">Mainnet</option><option value="devnet">Devnet</option></select><Icon name="chevron" /></div>
          <button className="primary-btn" type="submit" disabled={busy}><span>{busy ? 'Reading pool…' : 'Inspect pool'}</span><Icon name="arrow" /></button>
        </form>
        <div className="rail-divider"><span>OR EXPLORE SAMPLES</span></div>
        <div className="sample-picker"><label htmlFor="sample-state">Lifecycle state</label><div className="select-wrap"><select id="sample-state" value={demo} onChange={(e) => setDemo(e.target.value as typeof demo)}>{DEMOS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><Icon name="chevron" /></div><button className="secondary-btn" type="button" disabled={busy} onClick={loadDemo}>Load sample <span className="sample-mini">SAMPLE</span></button><p>Example data only. Samples are never shown as live network reads.</p></div>
        <div className="rail-footer"><span className="shield-icon">✓</span><span><b>No wallet connection</b><small>Read only · no signing or transactions</small></span></div>
      </aside>
      <section className="content-area" aria-live="polite">
        {error && <div className="error-banner" role="alert"><span className="error-symbol">!</span><div><b>{error.title}</b><p>{error.message}</p></div><button aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}
        {report ? <>
          <div className="content-topline"><span>{isDemo ? 'SAMPLE PASSPORT' : 'INSPECTION PASSPORT'}</span><button className="reset-btn" onClick={clearReport}>Clear report</button></div>
          <ReportView report={report} onDownload={download} />
          <section className="compare-panel panel"><div className="compare-intro"><span className="eyebrow">SNAPSHOT COMPARISON</span><h2>Compare a saved report</h2><p>Import a previous LaunchCheck JSON report to see what changed.</p></div><div className="compare-controls"><input ref={fileInput} type="file" accept="application/json,.json" aria-label="Choose baseline report JSON" onChange={(e) => void importBaseline(e.target.files?.[0])} /><button className="secondary-btn import-btn" type="button" onClick={() => fileInput.current?.click()}><Icon name="upload" />{baseline ? 'Replace baseline' : 'Import baseline'}</button><button className="primary-btn compare-btn" type="button" disabled={!baseline || busy} onClick={compare}>Compare reports <Icon name="arrow" /></button></div>
            {baseline && <div className="baseline-label"><span className={`source-chip ${baseline.source}`}><i />{baseline.source === 'demo' ? 'SAMPLE' : 'IMPORTED BASELINE'}</span><span>{shorten(baseline.pool.address)} · {baseline.cluster} · {time(baseline.fetchedAt)}</span></div>}
            {compareError && <p className="compare-error" role="alert">{compareError}</p>}
            {comparison && <div className="comparison-result"><div className="comparison-summary"><b>{comparison.changes.length ? `${comparison.changes.length} changes found` : 'No differences found'}</b><span>Configuration changes are shown separately from state changes.</span></div>{comparison.changes.map((change, i) => <div className="change-row" key={`${change.field}-${i}`}><span className={`change-category ${change.category}`}>{change.category}</span><b>{change.field}</b><span>{change.before}</span><span className="change-arrow">→</span><span>{change.after}</span></div>)}</div>}
            <p className="compare-footnote">Imported reports are user-provided baselines; they are not signed or independently verified.</p>
          </section>
        </> : <div className="empty-workspace">
          <div className="empty-kicker"><span className="live-pulse" />READY FOR A POOL READ</div>
          <div className="empty-track" aria-label="DBC trading to curve complete to DAMM v2 created"><div className="empty-line"/><div className="empty-step"><i>1</i><span>DBC trading</span></div><div className="empty-step"><i>2</i><span>Curve complete</span></div><div className="empty-step"><i>3</i><span>DAMM v2 created</span></div></div>
          <div className="empty-copy"><h2>A pool's progress,<br />read from its accounts.</h2><p>Enter a DBC pool address to build a lifecycle passport with reserves, fee recipients, liquidity allocation, and evidence-based checks.</p><span>NO WALLET · READ ONLY · MAINNET OR DEVNET</span></div>
          <div className="empty-hint"><span>01</span><p><b>Start with a pool address</b><br />Use the inspector on the left, or explore one of the clearly marked sample states.</p></div>
        </div>}
      </section>
    </div>
    <footer className="page-footer"><span>LaunchCheck <b>·</b> DBC lifecycle passport</span><span>Read-only account inspection <b>·</b> No price or safety score</span></footer>
  </main>;
}
