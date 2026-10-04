import {
  BarChart3,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Info,
  Store,
  TriangleAlert,
  UsersRound,
} from "lucide-react";

import type { EvalResult, EvalRow, UpperStatus } from "../lib/types";
import { Sheet, Skeleton, Stat, Chip } from "../ui";
import { cn } from "../ui/utils";

export interface EvalDialogProps {
  /** The response from GET /api/eval. A null response renders a useful loading/empty state. */
  result: EvalResult | null;
  open: boolean;
  onClose: () => void;
  loading?: boolean;
  error?: Error | string | null;
  className?: string;
}

function errorMessage(error: EvalDialogProps["error"]) {
  if (!error) return null;
  return typeof error === "string" ? error : error.message;
}

function EvaluationSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading evaluation">
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((index) => (
          <div key={index} className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="mt-3 h-7 w-3/5" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
      <Skeleton shape="rect" className="h-52 w-full" />
    </div>
  );
}

function EvaluationStatus({ status }: { status: UpperStatus | null }) {
  if (!status) {
    return <span className="text-dusk-xs text-dusk-muted">—</span>;
  }

  return <Chip status={status} className="whitespace-nowrap" />;
}

function HumanOrQueue({ row }: { row: EvalRow }) {
  if (row.human) return <EvaluationStatus status={row.human} />;

  if (row.escalated) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-dusk-xs text-status-review">
        <Clock3 aria-hidden="true" size={13} />
        Queued
      </span>
    );
  }

  return <span className="text-dusk-xs text-dusk-muted">Not screened</span>;
}

function formattedDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function EvaluationTable({ rows }: { rows: EvalRow[] }) {
  if (!rows.length) {
    return (
      <div className="grid min-h-32 place-items-center rounded-card border border-dashed border-white/[0.12] px-5 text-center">
        <div>
          <CircleDashed aria-hidden="true" size={22} className="mx-auto text-dusk-muted" />
          <p className="mt-2 text-sm text-dusk-muted">No screened facades are available yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-white/[0.07]" tabIndex={0} aria-label="Evaluation screening table">
      <table className="min-w-[610px] w-full border-collapse text-left text-dusk-xs">
        <thead className="bg-white/[0.035] text-dusk-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-medium">Facade</th>
            <th scope="col" className="px-3 py-2.5 font-medium">AI</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Verifier</th>
            <th scope="col" className="px-3 py-2.5 font-medium">Human / queue</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.07]">
          {rows.map((row) => (
            <tr key={row.id} className="align-middle">
              <th scope="row" className="max-w-36 px-3 py-2.5 font-medium text-dusk-text">
                <span className="block truncate" title={row.label ?? row.id}>{row.label ?? row.id}</span>
                <span className="mt-0.5 block font-mono text-[10px] font-normal text-dusk-muted">{row.id}</span>
              </th>
              <td className="px-3 py-2.5"><EvaluationStatus status={row.ai} /></td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <EvaluationStatus status={row.verifier} />
                  {row.verifier_agrees === false ? (
                    <TriangleAlert aria-label="Disagreement" size={14} className="shrink-0 text-status-review" />
                  ) : row.verifier_agrees === true ? (
                    <CheckCircle2 aria-label="Agreement" size={14} className="shrink-0 text-[#5EE0A1]" />
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2.5"><HumanOrQueue row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A read-only, honest evaluation view. The page owns fetching so this works
 * equally with the live API response and the deterministic static export.
 */
export function EvalDialog({
  result,
  open,
  onClose,
  loading = false,
  error,
  className,
}: EvalDialogProps) {
  const problem = errorMessage(error);
  const generatedAt = formattedDate(result?.generated_at);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      placement="right"
      title="Screening agreement"
      description="A transparent snapshot of model readings and human screening."
      ariaLabel="Evaluation results"
      className={cn("!w-[min(34rem,94vw)]", className)}
      contentClassName="pb-6"
    >
      {problem ? (
        <div role="alert" className="mb-4 flex gap-2 rounded-card border border-status-review/50 bg-status-review/10 p-3 text-sm leading-5 text-dusk-text">
          <TriangleAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-status-review" />
          <span>{result ? "The latest evaluation could not be refreshed; showing the previous snapshot." : problem}</span>
        </div>
      ) : null}

      {loading && !result ? <EvaluationSkeleton /> : null}

      {!loading && !result && !problem ? (
        <div className="grid min-h-56 place-items-center rounded-card border border-dashed border-white/[0.12] px-6 text-center">
          <div>
            <BarChart3 aria-hidden="true" size={26} className="mx-auto text-dusk-primary" />
            <h3 className="mt-3 text-base font-semibold text-dusk-text">Evaluation is not available yet</h3>
            <p className="mt-1 text-sm leading-5 text-dusk-muted">Run screening first, then this view will show its agreement snapshot.</p>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="space-y-5">
          <section aria-label="Evaluation summary" className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-3">
            <div className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
              <Stat label="Agreement" value={result.agreement} detail="with human screening" icon={<UsersRound size={14} />} />
            </div>
            <div className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
              <Stat label="Escalated automatically" value={result.escalated} detail="for human review" icon={<TriangleAlert size={14} />} />
            </div>
            <div className="rounded-card border border-white/[0.07] bg-white/[0.03] p-3">
              <Stat label="Confirmed by shop staff" value={result.shop_confirmed} detail="of answers received" icon={<Store size={14} />} />
            </div>
          </section>

          <section className="rounded-card border border-dusk-primary/25 bg-dusk-primary/[0.07] p-3" aria-label="Evaluation caveat">
            <div className="flex gap-2 text-sm leading-5 text-dusk-text">
              <Info aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-dusk-primary" />
              <p>Agreement with human screening is not accuracy. {result.note ?? "Shop-staff answers are the only real-world confirmation, and the sample is small."}</p>
            </div>
          </section>

          <section aria-labelledby="evaluation-table-heading">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="evaluation-table-heading" className="text-sm font-semibold text-dusk-text">Screening record</h3>
              <span className="font-mono text-dusk-xs text-dusk-muted">
                {result.buildings_read_by_ai ?? result.rows.length} read by AI{generatedAt ? ` · ${generatedAt}` : ""}
              </span>
            </div>
            <EvaluationTable rows={result.rows} />
          </section>
        </div>
      ) : null}
    </Sheet>
  );
}

export default EvalDialog;
