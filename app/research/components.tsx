"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ExperimentState, ResearchErrorShape } from "../../solver/research/public/contracts";

export function StatusBadge({ state }: { state: ExperimentState | "healthy" | "degraded" }) {
  const labels: Record<string, string> = {
    created: "Criado", preflight: "Preflight", ready: "Pronto", running: "Executando", cancelling: "Cancelando",
    cancelled: "Cancelado", completed: "Concluído", failed: "Falhou", interrupted: "Interrompido", healthy: "Saudável", degraded: "Atenção",
  };
  return <span className={`rc-status rc-status-${state}`}><i />{labels[state] ?? state}</span>;
}

export function MetricCard({ label, value, detail, tone = "default" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "default" | "green" | "amber" | "red" }) {
  return <article className={`rc-metric rc-tone-${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}

export function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="rc-empty"><div className="rc-empty-mark">∅</div><h3>{title}</h3><p>{copy}</p>{action}</div>;
}

export function ErrorState({ error, retry }: { error: Error | ResearchErrorShape; retry?: () => void }) {
  const code = "code" in error ? error.code : "INTERNAL_ERROR";
  return <div className="rc-error" role="alert"><div><strong>{error.message}</strong><span>{code}</span></div>{retry && <button className="rc-button rc-button-ghost" onClick={retry}>Tentar novamente</button>}</div>;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return <div className="rc-loading" aria-label="Carregando" aria-live="polite">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const percent = Math.max(0, Math.min(100, value * 100));
  return <div className="rc-progress" aria-label={label ?? "Progresso"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} role="progressbar"><i style={{ width: `${percent}%` }} /></div>;
}

export function Dialog({ title, children, confirm, onClose, destructive = false }: { title: string; children: ReactNode; confirm: () => void; onClose: () => void; destructive?: boolean }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="rc-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="rc-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">{title}</h2>{children}<div className="rc-dialog-actions"><button className="rc-button rc-button-ghost" onClick={onClose}>Voltar</button><button className={`rc-button ${destructive ? "rc-button-danger" : "rc-button-primary"}`} onClick={confirm}>Confirmar</button></div></section></div>;
}

export type Toast = { id: number; message: string; tone?: "success" | "error" | "info" };
export function Toasts({ items, dismiss }: { items: Toast[]; dismiss: (id: number) => void }) {
  return <div className="rc-toasts" aria-live="polite">{items.map((item) => <button key={item.id} className={`rc-toast rc-toast-${item.tone ?? "info"}`} onClick={() => dismiss(item.id)}>{item.message}<span>×</span></button>)}</div>;
}

type NumericRow = Readonly<Record<string, number>>;
type ChartSeries = { label: string; color: string; rows: readonly NumericRow[] };

export function ConvergenceChart({ series, metric, xAxis, scale }: { series: ChartSeries[]; metric: string; xAxis: "iteration" | "runtimeMs"; scale: "linear" | "log" }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const points = useMemo(() => series.flatMap((entry) => entry.rows.flatMap((row) => Number.isFinite(row[metric]) && Number.isFinite(row[xAxis]) && (scale === "linear" || row[metric] > 0) ? [{ entry, row }] : [])), [series, metric, xAxis, scale]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    const width = element.clientWidth;
    const height = element.clientHeight;
    element.width = width * ratio;
    element.height = height * ratio;
    const context = element.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const pad = { left: 52, right: 18, top: 18, bottom: 34 };
    context.strokeStyle = "#26352f";
    context.fillStyle = "#819189";
    context.font = "11px var(--font-geist-mono)";
    context.lineWidth = 1;
    for (let line = 0; line <= 4; line += 1) {
      const y = pad.top + (height - pad.top - pad.bottom) * line / 4;
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
    }
    if (!points.length) return;
    const xs = points.map(({ row }) => row[xAxis]);
    const rawYs = points.map(({ row }) => row[metric]);
    const ys = rawYs.map((value) => scale === "log" ? Math.log10(value) : value);
    const xMin = Math.min(...xs); const xMax = Math.max(...xs);
    const yMin = Math.min(...ys); const yMax = Math.max(...ys);
    const px = (value: number) => pad.left + (value - xMin) / Math.max(1e-12, xMax - xMin) * (width - pad.left - pad.right);
    const py = (value: number) => height - pad.bottom - ((scale === "log" ? Math.log10(value) : value) - yMin) / Math.max(1e-12, yMax - yMin) * (height - pad.top - pad.bottom);
    context.fillText(scale === "log" ? `log ${metric}` : metric, 8, 14);
    context.fillText(xAxis === "iteration" ? "iterações" : "tempo (ms)", Math.max(pad.left, width - 98), height - 8);
    for (const item of series) {
      const rows = item.rows.filter((row) => Number.isFinite(row[metric]) && Number.isFinite(row[xAxis]) && (scale === "linear" || row[metric] > 0));
      context.strokeStyle = item.color; context.lineWidth = 2; context.beginPath();
      rows.forEach((row, index) => { const x = px(row[xAxis]); const y = py(row[metric]); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
      context.stroke();
      rows.forEach((row) => { context.fillStyle = item.color; context.beginPath(); context.arc(px(row[xAxis]), py(row[metric]), 2.5, 0, Math.PI * 2); context.fill(); });
    }
    element.dataset.geometry = JSON.stringify({ xMin, xMax, yMin, yMax, width, height, pad, rawYs, xs });
  }, [points, series, metric, xAxis, scale]);
  return <div className="rc-chart-wrap">{points.length ? <><canvas ref={canvas} className="rc-chart" aria-label={`Gráfico de ${metric} por ${xAxis}`} onMouseMove={(event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const nearest = points.reduce((best, point) => {
      const min = Math.min(...points.map(({ row }) => row[xAxis])); const max = Math.max(...points.map(({ row }) => row[xAxis]));
      const projected = 52 + (point.row[xAxis] - min) / Math.max(1e-12, max - min) * (rect.width - 70);
      return Math.abs(projected - mouseX) < best.distance ? { distance: Math.abs(projected - mouseX), point } : best;
    }, { distance: Infinity, point: points[0] });
    setHover({ x: Math.min(rect.width - 170, Math.max(8, mouseX)), y: 12, text: `${nearest.point.entry.label} · ${metric} ${nearest.point.row[metric].toPrecision(5)} · ${xAxis} ${nearest.point.row[xAxis]}` });
  }} onMouseLeave={() => setHover(null)} />{hover && <span className="rc-chart-tooltip" style={{ left: hover.x, top: hover.y }}>{hover.text}</span>}</> : <EmptyState title="Sem série numérica" copy="O motor ainda não registrou pontos para esta métrica." />}</div>;
}

export function ValidationBadge({ level }: { level: string }) {
  const labels: Record<string, string> = { unvalidated: "Não validado", "structurally-validated": "Estrutural", "differentially-validated": "Diferencial", "analytically-validated": "Analítico", "reproducible-research-result": "Reproduzível" };
  return <span className="rc-validation" title="Validação de experimento sintético; não certifica estratégia de poker.">{labels[level] ?? level}</span>;
}

export function formatBytes(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

export function formatDuration(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}
