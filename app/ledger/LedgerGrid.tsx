'use client';

import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type ICellRendererParams,
  type ValueFormatterParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo, useRef, useState } from 'react';
import type { LedgerEvent, LedgerRow } from '@/lib/views';

ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Grid themed with Stamp's own tokens, so it follows light/dark mode with the rest of the app. */
const stampTheme = themeQuartz.withParams({
  fontFamily: 'var(--font-inter), system-ui, sans-serif',
  headerFontFamily: 'var(--font-inter), system-ui, sans-serif',
  fontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 600,
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--ink)',
  textColor: 'var(--ink)',
  subtleTextColor: 'var(--ink-3)',
  borderColor: 'var(--line)',
  chromeBackgroundColor: 'var(--paper)',
  headerBackgroundColor: 'var(--paper)',
  headerTextColor: 'var(--ink-2)',
  rowHoverColor: 'var(--paper-2)',
  selectedRowBackgroundColor: 'var(--stamp-soft)',
  accentColor: 'var(--stamp)',
  inputFocusBorder: { color: 'var(--focus)' },
  wrapperBorderRadius: 16,
  rowBorder: { color: 'var(--line)' },
  spacing: 7,
});

const money = (p: ValueFormatterParams) => (p.value === null || p.value === undefined ? '' : `$${Number(p.value).toFixed(2)}`);
const when = (p: ValueFormatterParams) =>
  p.value ? new Date(p.value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

const STATE_TONE: Record<string, string> = {
  AUTHORIZED: 'bg-held-bg text-held',
  VOIDED: 'bg-good-bg text-good',
  CAPTURED: 'bg-donated-bg text-donated',
  DONATED: 'bg-donated-bg text-donated',
  FAILED: 'bg-bad-bg text-bad',
  'FREE LANE': 'bg-paper-2 text-ink-2',
};

function StateCell(p: ICellRendererParams<LedgerRow>) {
  const v = String(p.value ?? '');
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATE_TONE[v] ?? 'bg-paper-2 text-ink-2'}`}>{v}</span>;
}

const REC: Record<string, string> = { reply: 'Reply', worth_it: 'Release', review: 'Review', spam: 'Spam' };
const DEC: Record<string, string> = { reply: 'Replied', worth_it: 'Worth it', spam: 'Spam', auto_release: 'Auto-released' };

function AiCell(p: ICellRendererParams<LedgerRow>) {
  const r = p.data;
  if (!r?.aiRecommendation) return <span className="text-ink-3">–</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-semibold">
        {REC[r.aiRecommendation] ?? r.aiRecommendation}
        {r.injection ? <span className="ml-1.5 rounded bg-bad-bg px-1 text-[11px] text-bad">injection</span> : null}
      </span>
      <span className="text-xs text-ink-3">
        fit {r.aiFit} · risk {r.aiRisk} · {r.aiSource === 'model' ? 'model' : 'rules'}
      </span>
    </span>
  );
}

function DecisionCell(p: ICellRendererParams<LedgerRow>) {
  const r = p.data;
  if (!r?.decision) return <span className="text-ink-3">–</span>;
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-semibold">{DEC[r.decision] ?? r.decision}</span>
      <span className="text-xs text-ink-3">by {r.decidedBy}</span>
    </span>
  );
}

function AgreementCell(p: ICellRendererParams<LedgerRow>) {
  const a = p.data?.agreement;
  if (!a) return <span className="text-ink-3">–</span>;
  return a === 'agree' ? (
    <span className="font-semibold text-good">✓ agree</span>
  ) : (
    <span className="font-semibold text-held">≠ differ</span>
  );
}

function SenderCell(p: ICellRendererParams<LedgerRow>) {
  const r = p.data;
  if (!r) return null;
  return (
    <span className="flex flex-col leading-tight">
      <span className="truncate">{r.sender}</span>
      <span className="text-xs text-ink-3">{r.payer ? `PayPal: ${r.payer}` : r.lane === 'free' ? 'free lane' : ''}</span>
    </span>
  );
}

function Mono(p: ICellRendererParams) {
  return p.value ? <span className="font-mono text-xs">{String(p.value)}</span> : <span className="text-ink-3">–</span>;
}

export function LedgerGrid({ rows, events }: { rows: LedgerRow[]; events: LedgerEvent[] }) {
  const [view, setView] = useState<'holds' | 'events'>('holds');
  const [quick, setQuick] = useState('');
  const holdsApi = useRef<GridApi<LedgerRow> | null>(null);
  const eventsApi = useRef<GridApi<LedgerEvent> | null>(null);

  const stats = useMemo(() => {
    const holds = rows.filter((r) => r.holdId && r.state !== 'NOT SENT');
    const decided = rows.filter((r) => r.agreement);
    const agree = decided.filter((r) => r.agreement === 'agree').length;
    return {
      holds: holds.length,
      held: holds.filter((r) => r.state === 'AUTHORIZED').reduce((s, r) => s + (r.amount ?? 0), 0),
      released: holds.filter((r) => r.state === 'VOIDED').length,
      donated: rows.reduce((s, r) => s + (r.donated ?? 0), 0),
      fees: rows.reduce((s, r) => s + (r.paypalFee ?? 0), 0),
      agreement: decided.length ? Math.round((agree / decided.length) * 100) : null,
      decided: decided.length,
    };
  }, [rows]);

  const holdCols = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: 'receivedAt', headerName: 'Received', valueFormatter: when, sort: 'desc', width: 150 },
      { field: 'sender', headerName: 'From', cellRenderer: SenderCell, minWidth: 220, flex: 1 },
      { field: 'subject', headerName: 'Subject', minWidth: 200, flex: 1, tooltipField: 'subject' },
      { field: 'amount', headerName: 'Hold', valueFormatter: money, width: 90, type: 'rightAligned' },
      { field: 'state', headerName: 'State', cellRenderer: StateCell, width: 130, filter: true },
      { field: 'aiRecommendation', headerName: 'AI suggested', cellRenderer: AiCell, width: 180, filter: true },
      { field: 'decision', headerName: 'Decision', cellRenderer: DecisionCell, width: 140, filter: true },
      { field: 'agreement', headerName: 'AI vs human', cellRenderer: AgreementCell, width: 120, filter: true },
      { field: 'outcome', headerName: 'Outcome', width: 220, tooltipField: 'outcome' },
      { field: 'paypalFee', headerName: 'PayPal fee', valueFormatter: money, width: 110, type: 'rightAligned' },
      { field: 'donated', headerName: 'Donated', valueFormatter: money, width: 100, type: 'rightAligned' },
      { field: 'payoutFee', headerName: 'Payout fee (Stamp)', valueFormatter: money, width: 150, type: 'rightAligned' },
      { field: 'authorizationId', headerName: 'Authorization', cellRenderer: Mono, width: 190 },
      { field: 'captureId', headerName: 'Capture', cellRenderer: Mono, width: 190 },
      { field: 'payoutBatchId', headerName: 'Payout batch', cellRenderer: Mono, width: 160 },
      { field: 'lastVerifiedAt', headerName: 'Checked with PayPal', valueFormatter: when, width: 170 },
    ],
    [],
  );

  const eventCols = useMemo<ColDef<LedgerEvent>[]>(
    () => [
      { field: 'at', headerName: 'Time', valueFormatter: when, sort: 'desc', width: 160 },
      { field: 'holdId', headerName: 'Hold', cellRenderer: Mono, width: 220 },
      { field: 'kind', headerName: 'Kind', width: 110, filter: true },
      { field: 'actor', headerName: 'Actor', width: 120, filter: true },
      { field: 'change', headerName: 'Change / call', width: 220 },
      { field: 'detail', headerName: 'Detail', flex: 1, minWidth: 360, cellRenderer: Mono, tooltipField: 'detail' },
    ],
    [],
  );

  const tiles = [
    { label: 'Holds placed', value: String(stats.holds), tone: 'text-ink' },
    { label: 'Held right now', value: `$${stats.held.toFixed(2)}`, tone: 'text-held' },
    { label: 'Released, $0 charged', value: String(stats.released), tone: 'text-good' },
    { label: 'Donated to charity', value: `$${stats.donated.toFixed(2)}`, tone: 'text-donated' },
    { label: 'AI agreed with you', value: stats.agreement === null ? '–' : `${stats.agreement}%`, tone: 'text-ink', hint: stats.decided ? `${stats.decided} decisions` : 'no decisions yet' },
  ];

  return (
    <div className="mt-6">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <dt className="text-sm text-ink-3">{t.label}</dt>
            <dd className={`font-display mt-1 text-2xl font-semibold ${t.tone}`}>{t.value}</dd>
            {t.hint ? <dd className="text-xs text-ink-3">{t.hint}</dd> : null}
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Ledger view" className="inline-flex rounded-full border border-line bg-card p-1">
          {(
            [
              ['holds', `Holds (${rows.length})`],
              ['events', `Event log (${events.length})`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${view === k ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="ledger-search" className="sr-only">
            Search the ledger
          </label>
          <input id="ledger-search" className="field !py-2 sm:!w-64" placeholder="Search…" value={quick} onChange={(e) => setQuick(e.target.value)} />
          <button
            type="button"
            className="btn btn-ghost !min-h-10 shrink-0 !py-2 text-sm"
            onClick={() =>
              view === 'holds'
                ? holdsApi.current?.exportDataAsCsv({ fileName: 'stamp-ledger.csv' })
                : eventsApi.current?.exportDataAsCsv({ fileName: 'stamp-events.csv' })
            }
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mt-4 h-[600px]">
        {view === 'holds' ? (
          <AgGridReact<LedgerRow>
            theme={stampTheme}
            rowData={rows}
            columnDefs={holdCols}
            defaultColDef={{ sortable: true, resizable: true }}
            quickFilterText={quick}
            rowHeight={56}
            tooltipShowDelay={300}
            getRowId={(p) => p.data.messageId}
            onGridReady={(e) => {
              holdsApi.current = e.api;
            }}
            overlayNoRowsTemplate="No messages yet."
          />
        ) : (
          <AgGridReact<LedgerEvent>
            theme={stampTheme}
            rowData={events}
            columnDefs={eventCols}
            defaultColDef={{ sortable: true, resizable: true }}
            quickFilterText={quick}
            rowHeight={44}
            tooltipShowDelay={300}
            onGridReady={(e) => {
              eventsApi.current = e.api;
            }}
            overlayNoRowsTemplate="No events yet."
          />
        )}
      </div>
    </div>
  );
}
