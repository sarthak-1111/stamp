'use client';

import { Check, DownloadSimple, Robot, X } from '@phosphor-icons/react';
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ColGroupDef,
  type GridApi,
  type GridState,
  type ICellRendererParams,
  type ValueFormatterParams,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HoldStamp, StateBadge } from '@/components/StateBadge';
import { AbsoluteTime } from '@/components/Time';
import type { LedgerEvent, LedgerRow } from '@/lib/views';

ModuleRegistry.registerModules([AllCommunityModule]);

const ICON = { size: 16, weight: 'bold' } as const;
const STATE_KEY = 'stamp-ledger-columns-v2';

/** AG Grid themed with Stamp's own tokens (Theming API), so it follows light and dark mode with the app. */
const stampTheme = themeQuartz.withParams({
  fontFamily: 'var(--font-geist), system-ui, sans-serif',
  headerFontFamily: 'var(--font-geist), system-ui, sans-serif',
  fontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 500,
  backgroundColor: 'var(--card)',
  foregroundColor: 'var(--ink)',
  textColor: 'var(--ink)',
  subtleTextColor: 'var(--ink-3)',
  borderColor: 'var(--line)',
  chromeBackgroundColor: 'var(--card)',
  headerBackgroundColor: 'var(--card)',
  headerTextColor: 'var(--ink-3)',
  rowHoverColor: 'var(--paper-2)',
  selectedRowBackgroundColor: 'var(--stamp-soft)',
  accentColor: 'var(--stamp)',
  inputFocusBorder: { color: 'var(--focus)' },
  wrapperBorderRadius: 16,
  borderRadius: 8,
  rowBorder: { color: 'var(--line)' },
  spacing: 7,
  cellHorizontalPadding: 14,
  headerHeight: 40,
});
const holdsTheme = stampTheme.withParams({ rowHeight: 56 });
const eventsTheme = stampTheme.withParams({ rowHeight: 44 });

// ---------------------------------------------------------------- formatting

const money = (v: unknown) => (v === null || v === undefined || v === '' ? '' : `$${Number(v).toFixed(2)}`);
const moneyFmt = (p: ValueFormatterParams) => money(p.value);
const whenFmt = (p: ValueFormatterParams) =>
  p.value ? new Date(p.value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }) : '';

type Tone = 'neutral' | 'held' | 'good' | 'donated' | 'bad';
const STATE: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Awaiting approval', tone: 'neutral' },
  APPROVED: { label: 'Approved', tone: 'neutral' },
  AUTHORIZED: { label: 'Held', tone: 'held' },
  VOIDED: { label: 'Released', tone: 'good' },
  CAPTURED: { label: 'Captured', tone: 'donated' },
  DONATED: { label: 'Donated', tone: 'donated' },
  EXPIRED: { label: 'Not sent', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'bad' },
  'FREE LANE': { label: 'Free lane', tone: 'neutral' },
  'FREE PASS': { label: 'Free pass', tone: 'neutral' },
  'NOT SENT': { label: 'Not sent', tone: 'neutral' },
};
const REC: Record<string, string> = { reply: 'Reply', worth_it: 'Release', review: 'Review', spam: 'Spam' };
const DEC: Record<string, string> = {
  reply: 'Replied',
  worth_it: 'Worth it',
  spam: 'Spam',
  auto_release: 'Auto-released',
  grant: 'Granted',
  decline: 'Declined',
};

const isTotal = (p: ICellRendererParams) => p.node.rowPinned === 'bottom';
const Cell = ({ children }: { children: React.ReactNode }) => <span className="flex h-full min-w-0 flex-col justify-center leading-tight">{children}</span>;
const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-ink-3">{children}</span>;

// ---------------------------------------------------------------- cell renderers

function SenderCell(p: ICellRendererParams<LedgerRow>) {
  const r = p.data;
  if (!r) return null;
  if (isTotal(p)) return <Cell><span className="font-medium">{r.sender}</span></Cell>;
  const sub = r.agentName ? `agent: ${r.agentName}` : r.payer ? `PayPal: ${r.payer}` : r.lane === 'free' ? 'free lane' : r.lane === 'request' ? 'asked for a free pass' : '';
  return (
    <Cell>
      <span className="truncate">{r.sender}</span>
      <span className="flex items-center gap-1 truncate text-[12px] text-ink-3">
        {r.via !== 'web' ? <Robot size={12} weight="bold" aria-label="Sent by an agent" /> : null}
        {sub}
      </span>
    </Cell>
  );
}

function HoldCell(p: ICellRendererParams<LedgerRow>) {
  if (isTotal(p)) return <Cell><span className="font-mono tabular-nums">{money(p.value)}</span></Cell>;
  if (p.value === null || p.value === undefined) return <Cell><Muted>No hold</Muted></Cell>;
  return (
    <Cell>
      <HoldStamp cents={Math.round(Number(p.value) * 100)} className="self-start" />
    </Cell>
  );
}

function StateCell(p: ICellRendererParams<LedgerRow>) {
  if (isTotal(p) || !p.value) return null;
  const s = STATE[String(p.value)] ?? { label: String(p.value), tone: 'neutral' as Tone };
  return (
    <Cell>
      <span className="self-start">
        <StateBadge tone={s.tone} label={s.label} />
      </span>
    </Cell>
  );
}

function AiCell(p: ICellRendererParams<LedgerRow>) {
  const r = p.data;
  if (!r || isTotal(p)) return null;
  if (!r.aiRecommendation) return <Cell><Muted>Pending</Muted></Cell>;
  return (
    <Cell>
      <span className="flex items-center gap-1.5">
        <span className={r.aiRecommendation === 'spam' ? 'text-bad' : ''}>{REC[r.aiRecommendation] ?? r.aiRecommendation}</span>
        {r.injection ? <span className="rounded bg-bad-bg px-1 text-[11px] text-bad">injection</span> : null}
      </span>
      <span className="font-mono text-[12px] text-ink-3 tabular-nums">
        fit {r.aiFit} · risk {r.aiRisk} · {r.aiSource === 'model' ? 'model' : 'rules'}
      </span>
    </Cell>
  );
}

function DecisionCell(p: ICellRendererParams<LedgerRow>) {
  const r = p.data;
  if (!r || isTotal(p)) return null;
  if (!r.decision) return <Cell><Muted>Undecided</Muted></Cell>;
  return (
    <Cell>
      <span>{DEC[r.decision] ?? r.decision}</span>
      <span className="truncate text-[12px] text-ink-3">{r.reason ? r.reason : `by ${r.decidedBy}`}</span>
    </Cell>
  );
}

function AgreementCell(p: ICellRendererParams<LedgerRow>) {
  const a = p.data?.agreement;
  if (!a || isTotal(p)) return null;
  return a === 'agree' ? (
    <Cell>
      <span className="flex items-center gap-1.5 text-good">
        <Check {...ICON} aria-hidden /> Agree
      </span>
    </Cell>
  ) : (
    <Cell>
      <span className="flex items-center gap-1.5 text-held">
        <X {...ICON} aria-hidden /> Differ
      </span>
    </Cell>
  );
}

function IdCell(p: ICellRendererParams) {
  if (isTotal(p)) return null;
  return p.value ? (
    <Cell>
      <span className="truncate font-mono text-[12px]" title={String(p.value)}>
        {String(p.value)}
      </span>
    </Cell>
  ) : null;
}

function MoneyCell(p: ICellRendererParams) {
  return (
    <Cell>
      <span className={`font-mono tabular-nums ${isTotal(p) ? 'font-medium' : ''}`}>{money(p.value)}</span>
    </Cell>
  );
}

// ---------------------------------------------------------------- filters

type FilterKey = 'all' | 'held' | 'released' | 'donated' | 'free' | 'requests' | 'injection' | 'differ';
const FILTERS: Array<{ key: FilterKey; label: string; test: (r: LedgerRow) => boolean }> = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'held', label: 'Held', test: (r) => r.state === 'AUTHORIZED' },
  { key: 'released', label: 'Released', test: (r) => r.state === 'VOIDED' },
  { key: 'donated', label: 'Donated', test: (r) => r.state === 'CAPTURED' || r.state === 'DONATED' },
  { key: 'free', label: 'Free lane', test: (r) => r.lane === 'free' },
  { key: 'requests', label: 'Free passes', test: (r) => r.lane === 'request' },
  { key: 'injection', label: 'Injection attempts', test: (r) => r.injection },
  { key: 'differ', label: 'AI disagreed', test: (r) => r.agreement === 'differ' },
];

const NARROW_HIDDEN = ['subject', 'outcome', 'paypalFee', 'payoutFee', 'authorizationId', 'captureId', 'payoutBatchId', 'lastVerifiedAt'];

function loadState(): GridState | undefined {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (raw) return JSON.parse(raw) as GridState;
  } catch {
    // storage blocked: fall through to defaults
  }
  if (window.innerWidth < 900) return { columnVisibility: { hiddenColIds: NARROW_HIDDEN } };
  return undefined;
}

// ---------------------------------------------------------------- component

export function LedgerGrid({ initialRows, initialEvents }: { initialRows: LedgerRow[]; initialEvents: LedgerEvent[] }) {
  const [rows, setRows] = useState(initialRows);
  const [events, setEvents] = useState(initialEvents);
  const [view, setView] = useState<'holds' | 'events'>('holds');
  const [quick, setQuick] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [totals, setTotals] = useState<LedgerRow[]>([]);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [gridState, setGridState] = useState<GridState | undefined | null>(null);
  const holdsApi = useRef<GridApi<LedgerRow> | null>(null);
  const eventsApi = useRef<GridApi<LedgerEvent> | null>(null);
  const filterRef = useRef<FilterKey>('all');
  const sheetRef = useRef<HTMLDialogElement>(null);

  useEffect(() => setGridState(loadState()), []);

  // Live: poll the ledger; AG Grid applies the delta by row id and flashes the cells that changed.
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      const res = await fetch('/api/ledger', { cache: 'no-store' }).catch(() => null);
      if (!res?.ok) return;
      const j = (await res.json()) as { rows: LedgerRow[]; events: LedgerEvent[] };
      setRows(j.rows);
      setEvents(j.events);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (selected) sheetRef.current?.showModal();
    else sheetRef.current?.close();
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const fresh = rows.find((r) => r.messageId === selected.messageId);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [rows, selected]);

  const recomputeTotals = useCallback(() => {
    const api = holdsApi.current;
    if (!api) return;
    let n = 0;
    let amount = 0;
    let fee = 0;
    let donated = 0;
    let payoutFee = 0;
    api.forEachNodeAfterFilter((node) => {
      const r = node.data;
      if (!r) return;
      n += 1;
      if (r.state === 'AUTHORIZED') amount += r.amount ?? 0;
      fee += r.paypalFee ?? 0;
      donated += r.donated ?? 0;
      payoutFee += r.payoutFee ?? 0;
    });
    setTotals([
      {
        messageId: '__total',
        sender: `Total, ${n} ${n === 1 ? 'row' : 'rows'}`,
        amount: amount || null,
        paypalFee: fee || null,
        donated: donated || null,
        payoutFee: payoutFee || null,
      } as LedgerRow,
    ]);
  }, []);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.test).length])) as Record<FilterKey, number>, [rows]);

  const stats = useMemo(() => {
    const holds = rows.filter((r) => r.holdId && r.state !== 'DRAFT' && r.state !== 'EXPIRED' && r.state !== 'NOT SENT');
    const decided = rows.filter((r) => r.agreement);
    const agree = decided.filter((r) => r.agreement === 'agree').length;
    return {
      holds: holds.length,
      held: holds.filter((r) => r.state === 'AUTHORIZED').reduce((s, r) => s + (r.amount ?? 0), 0),
      released: holds.filter((r) => r.state === 'VOIDED').length,
      donated: rows.reduce((s, r) => s + (r.donated ?? 0), 0),
      agreement: decided.length ? Math.round((agree / decided.length) * 100) : null,
      decided: decided.length,
    };
  }, [rows]);

  const holdCols = useMemo<(ColDef<LedgerRow> | ColGroupDef<LedgerRow>)[]>(
    () => [
      { field: 'sender', headerName: 'From', cellRenderer: SenderCell, minWidth: 220, width: 260, pinned: 'left' },
      {
        headerName: 'Message',
        children: [
          { field: 'receivedAt', headerName: 'Received', valueFormatter: whenFmt, sort: 'desc', width: 150, cellClass: 'font-mono text-[12px]' },
          { field: 'subject', headerName: 'Subject', minWidth: 200, flex: 1, tooltipField: 'subject' },
        ],
      },
      {
        headerName: 'Money',
        children: [
          { field: 'amount', headerName: 'Hold', cellRenderer: HoldCell, width: 96 },
          { field: 'state', headerName: 'State', cellRenderer: StateCell, width: 150, filter: true, enableCellChangeFlash: true },
          { field: 'paypalFee', headerName: 'PayPal fee', cellRenderer: MoneyCell, width: 116, type: 'rightAligned', enableCellChangeFlash: true },
          { field: 'donated', headerName: 'Donated', cellRenderer: MoneyCell, width: 110, type: 'rightAligned', enableCellChangeFlash: true },
          { field: 'payoutFee', headerName: 'Payout fee', headerTooltip: 'PayPal Payouts fee, paid by Stamp so the charity gets the full net amount', cellRenderer: MoneyCell, width: 120, type: 'rightAligned' },
        ],
      },
      {
        headerName: 'AI and you',
        children: [
          { field: 'aiRecommendation', headerName: 'AI suggested', cellRenderer: AiCell, width: 200, filter: true, enableCellChangeFlash: true },
          { field: 'decision', headerName: 'Your decision', cellRenderer: DecisionCell, width: 190, filter: true, enableCellChangeFlash: true },
          { field: 'agreement', headerName: 'AI vs you', cellRenderer: AgreementCell, width: 116, filter: true },
        ],
      },
      {
        headerName: 'PayPal',
        children: [
          { field: 'outcome', headerName: 'Outcome', width: 230, tooltipField: 'outcome' },
          { field: 'authorizationId', headerName: 'Authorization', cellRenderer: IdCell, width: 180 },
          { field: 'captureId', headerName: 'Capture', cellRenderer: IdCell, width: 180 },
          { field: 'payoutBatchId', headerName: 'Payout batch', cellRenderer: IdCell, width: 150 },
          { field: 'lastVerifiedAt', headerName: 'Checked with PayPal', valueFormatter: whenFmt, width: 170, enableCellChangeFlash: true, cellClass: 'font-mono text-[12px]' },
        ],
      },
    ],
    [],
  );

  const eventCols = useMemo<ColDef<LedgerEvent>[]>(
    () => [
      { field: 'at', headerName: 'Time', valueFormatter: whenFmt, sort: 'desc', width: 160, cellClass: 'font-mono text-[12px]' },
      { field: 'holdId', headerName: 'Hold', cellRenderer: IdCell, width: 210 },
      { field: 'kind', headerName: 'Kind', width: 110, filter: true },
      { field: 'actor', headerName: 'Actor', width: 120, filter: true },
      { field: 'change', headerName: 'Change or call', width: 230 },
      { field: 'detail', headerName: 'Detail', flex: 1, minWidth: 360, cellRenderer: IdCell, tooltipField: 'detail' },
    ],
    [],
  );

  const selectedEvents = useMemo(
    () => (selected?.holdId ? events.filter((e) => e.holdId === selected.holdId).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : []),
    [events, selected],
  );

  function chooseFilter(k: FilterKey) {
    setFilter(k);
    filterRef.current = k;
    holdsApi.current?.onFilterChanged();
  }

  return (
    <div className="mt-8">
      <dl className="grid grid-cols-2 border-y border-line sm:grid-cols-5">
        {[
          ['Holds placed', String(stats.holds), 'text-ink'],
          ['Held right now', money(stats.held) || '$0.00', stats.held ? 'text-held' : 'text-ink'],
          ['Released, $0 charged', String(stats.released), 'text-ink'],
          ['Donated to charity', money(stats.donated) || '$0.00', stats.donated ? 'text-donated' : 'text-ink'],
          ['AI agreed with you', stats.agreement === null ? 'n/a' : `${stats.agreement}%`, 'text-ink', stats.decided ? `${stats.decided} decisions` : 'no decisions yet'],
        ].map(([k, v, tone, hint], i) => (
          <div key={k} className={`py-4 ${i > 0 ? 'sm:border-l sm:border-line sm:pl-6' : ''} ${i % 2 === 1 ? 'max-sm:border-l max-sm:border-line max-sm:pl-4' : ''} ${i >= 2 ? 'max-sm:border-t max-sm:border-line' : ''}`}>
            <dt className="text-[13px] leading-5 text-ink-3">{k}</dt>
            <dd className={`mt-1 font-mono text-[24px] leading-8 tabular-nums ${tone}`}>{v}</dd>
            {hint ? <dd className="text-[13px] leading-5 text-ink-3">{hint}</dd> : null}
          </div>
        ))}
      </dl>

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Ledger view" className="inline-flex self-start rounded-xl border border-line bg-card p-1">
          {(
            [
              ['holds', 'Messages and holds', rows.length],
              ['events', 'PayPal event log', events.length],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`rounded-lg px-3 py-2 text-[14px] leading-5 font-medium transition-colors ${view === k ? 'bg-paper-2 text-ink' : 'text-ink-3 hover:text-ink'}`}
            >
              {label} <span className="font-mono text-[12px] text-ink-3 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label htmlFor="ledger-search" className="sr-only">
            Search the ledger
          </label>
          <input id="ledger-search" type="search" className="field !min-h-9 !py-1.5 sm:!w-64" placeholder="Search" value={quick} onChange={(e) => setQuick(e.target.value)} />
          <button
            type="button"
            className="btn btn-secondary btn-sm shrink-0"
            onClick={() =>
              view === 'holds'
                ? holdsApi.current?.exportDataAsCsv({ fileName: 'stamp-ledger.csv', skipPinnedBottom: true })
                : eventsApi.current?.exportDataAsCsv({ fileName: 'stamp-paypal-events.csv' })
            }
          >
            <DownloadSimple {...ICON} aria-hidden />
            CSV
          </button>
        </div>
      </div>

      {view === 'holds' ? (
        <div role="group" aria-label="Filter rows" className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => chooseFilter(f.key)}
              className={`shrink-0 rounded-lg border px-2.5 py-1 text-[13px] leading-5 transition-colors ${filter === f.key ? 'border-line-2 bg-paper-2 text-ink' : 'border-line text-ink-2 hover:bg-paper-2'}`}
            >
              {f.label} <span className="font-mono text-[12px] text-ink-3 tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* The grid is as tall as its rows (group header, header, rows, totals row), up to 620px, then it scrolls. */}
      <div className="mt-3" style={{ height: view === 'holds' ? Math.min(620, Math.max(264, 80 + (rows.length + 1) * 56)) : Math.min(620, Math.max(220, 64 + events.length * 44)) }}>
        {gridState === null ? (
          <div className="h-full animate-none rounded-2xl border border-line bg-card" aria-hidden />
        ) : view === 'holds' ? (
          <AgGridReact<LedgerRow>
            theme={holdsTheme}
            rowData={rows}
            columnDefs={holdCols}
            defaultColDef={{ sortable: true, resizable: true }}
            initialState={gridState}
            onStateUpdated={(e) => {
              const { columnVisibility, columnSizing, columnOrder, columnPinning, sort } = e.state;
              try {
                window.localStorage.setItem(STATE_KEY, JSON.stringify({ columnVisibility, columnSizing, columnOrder, columnPinning, sort }));
              } catch {
                // storage blocked: layout just will not persist
              }
            }}
            quickFilterText={quick}
            isExternalFilterPresent={() => filterRef.current !== 'all'}
            doesExternalFilterPass={(node) => (node.data ? (FILTERS.find((f) => f.key === filterRef.current)?.test(node.data) ?? true) : true)}
            pinnedBottomRowData={totals}
            onFilterChanged={recomputeTotals}
            onRowDataUpdated={recomputeTotals}
            onGridReady={(e) => {
              holdsApi.current = e.api;
              recomputeTotals();
            }}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            onRowClicked={(e) => {
              if (e.data && !e.node.rowPinned) setSelected(e.data);
            }}
            getRowClass={(p) => (p.node.rowPinned ? 'font-medium' : 'cursor-pointer')}
            groupHeaderHeight={32}
            tooltipShowDelay={300}
            getRowId={(p) => p.data.messageId}
            overlayNoRowsTemplate="No messages yet. Share your page to receive some."
          />
        ) : (
          <AgGridReact<LedgerEvent>
            theme={eventsTheme}
            rowData={events}
            columnDefs={eventCols}
            defaultColDef={{ sortable: true, resizable: true }}
            quickFilterText={quick}
            tooltipShowDelay={300}
            onGridReady={(e) => {
              eventsApi.current = e.api;
            }}
            overlayNoRowsTemplate="No PayPal events yet."
          />
        )}
      </div>

      <dialog
        ref={sheetRef}
        aria-labelledby="sheet-title"
        onClose={() => setSelected(null)}
        className="sheet m-0 ml-auto h-dvh max-h-dvh w-[min(100vw,480px)] max-w-none border-l border-line bg-card p-0 text-ink"
      >
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-line p-5">
              <div className="min-w-0">
                <p className="truncate text-[13px] leading-5 text-ink-3">{selected.sender}</p>
                <h2 id="sheet-title" className="mt-1 text-[18px] leading-7 font-medium text-balance">
                  {selected.subject}
                </h2>
              </div>
              <button type="button" className="btn btn-quiet btn-sm shrink-0" onClick={() => setSelected(null)} aria-label="Close details">
                <X {...ICON} aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-[14px] leading-5">
                <div>
                  <dt className="text-ink-3">Hold</dt>
                  <dd className="mt-1">{selected.amount !== null ? <HoldStamp cents={Math.round(selected.amount * 100)} /> : 'No hold'}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">State</dt>
                  <dd className="mt-1">
                    <StateBadge tone={(STATE[selected.state] ?? STATE.DRAFT!).tone} label={(STATE[selected.state] ?? { label: selected.state }).label} />
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-3">AI suggested</dt>
                  <dd className="mt-1">{selected.aiRecommendation ? `${REC[selected.aiRecommendation]}, fit ${selected.aiFit}, risk ${selected.aiRisk}` : 'Pending'}</dd>
                </div>
                <div>
                  <dt className="text-ink-3">Your decision</dt>
                  <dd className="mt-1">{selected.decision ? `${DEC[selected.decision] ?? selected.decision}${selected.reason ? `: ${selected.reason}` : ''}` : 'Undecided'}</dd>
                </div>
                {selected.paypalFee !== null ? (
                  <div>
                    <dt className="text-ink-3">PayPal fee</dt>
                    <dd className="mt-1 font-mono tabular-nums">{money(selected.paypalFee)}</dd>
                  </div>
                ) : null}
                {selected.donated !== null ? (
                  <div>
                    <dt className="text-ink-3">Donated</dt>
                    <dd className="mt-1 font-mono text-donated tabular-nums">{money(selected.donated)}</dd>
                  </div>
                ) : null}
              </dl>

              <h3 className="mt-8 text-[15px] leading-6 font-medium">PayPal calls and state changes</h3>
              {selectedEvents.length === 0 ? (
                <p className="mt-2 text-[14px] leading-6 text-ink-3">{selected.holdId ? 'No events yet.' : 'This message had no hold, so nothing went to PayPal.'}</p>
              ) : (
                <ol className="mt-3 grid gap-3">
                  {selectedEvents.map((e, i) => {
                    let d: Record<string, unknown> = {};
                    try {
                      d = JSON.parse(e.detail) as Record<string, unknown>;
                    } catch {
                      d = {};
                    }
                    const rid = typeof d.request_id === 'string' ? d.request_id : null;
                    return (
                      <li key={`${e.at}-${i}`} className="rounded-xl border border-line p-3">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[14px] leading-5 font-medium">{e.change || e.kind}</span>
                          <AbsoluteTime iso={e.at} className="shrink-0 font-mono text-[12px] text-ink-3" />
                        </div>
                        <p className="mt-1 text-[13px] leading-5 text-ink-3">
                          {e.kind} by {e.actor}
                          {typeof d.http === 'number' || typeof d.http === 'string' ? `, HTTP ${String(d.http)}` : ''}
                        </p>
                        {rid ? (
                          <p className="mt-1 truncate font-mono text-[12px] text-ink-2" title={rid}>
                            PayPal-Request-Id {rid}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
