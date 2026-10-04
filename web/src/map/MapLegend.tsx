import { useId, type ChangeEvent, type ComponentType } from "react";
import {
  Building2,
  CircleAlert,
  CircleHelp,
  ClipboardCheck,
  House,
  Landmark,
  ShieldCheck,
  type LucideProps,
} from "lucide-react";

import { STATUS_COLORS, STATUS_LABELS } from "../lib/status";
import { DISPLAY_STATUSES, type DisplayStatus } from "../lib/types";
import { duskColors, tokens } from "../theme/tokens";
import { cn } from "../ui/utils";

export type RegisterLayer = "derelict" | "protected";

/** Visibility values consumed directly by the register overlay layers. */
export type RegisterLayerVisibility = Partial<Record<RegisterLayer, boolean>>;

export interface MapLayerControlsProps {
  /** Controlled values for the two optional civic-register overlays. */
  visibility?: RegisterLayerVisibility;
  /** Called before CityMap rebuilds the relevant overlay layer. */
  onLayerChange?: (layer: RegisterLayer, visible: boolean) => void;
  className?: string;
}

export interface MapLegendProps extends MapLayerControlsProps {
  /** A reduced legend can be supplied when space is at a premium. */
  statuses?: readonly DisplayStatus[];
  /** Walker maps deliberately suppress status information. */
  showStatuses?: boolean;
  /** Set false for contexts that need only the status key. */
  showLayerControls?: boolean;
}

type StatusIcon = ComponentType<LucideProps>;

const STATUS_ICONS: Record<DisplayStatus, StatusIcon> = {
  likely_underused: Building2,
  review: CircleAlert,
  unclear: CircleHelp,
  likely_used: Building2,
  confirmed: ClipboardCheck,
  home: House,
};

const REGISTER_ROWS: ReadonlyArray<{
  layer: RegisterLayer;
  label: string;
  description: string;
  Icon: StatusIcon;
  color: string;
}> = [
  {
    layer: "derelict",
    label: "DCC derelict register",
    description: "Show nearby entries from the Derelict Sites Register",
    Icon: Landmark,
    color: "#8B5CF6",
  },
  {
    layer: "protected",
    label: "Protected structure",
    description: "Show nearby entries from the Record of Protected Structures",
    Icon: ShieldCheck,
    color: duskColors.primary,
  },
];

/**
 * Small, controlled register toggles which can also be placed without the
 * legend in a dense map toolbar.
 */
export function MapLayerControls({
  visibility = {},
  onLayerChange,
  className,
}: MapLayerControlsProps) {
  const idPrefix = useId();

  const onChange = (layer: RegisterLayer) => (event: ChangeEvent<HTMLInputElement>) => {
    onLayerChange?.(layer, event.currentTarget.checked);
  };

  return (
    <fieldset className={cn("m-0 min-w-0 border-0 p-0", className)}>
      <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-dusk-muted">
        Civic registers
      </legend>
      <div className="grid gap-1">
        {REGISTER_ROWS.map(({ layer, label, description, Icon, color }) => {
          const id = `${idPrefix}-${layer}`;
          const enabled = visibility[layer] ?? false;

          return (
            <label
              className={cn(
                "flex min-h-8 cursor-pointer items-center gap-2 rounded-card px-1.5 py-1 text-left transition-colors duration-dusk-fast",
                "hover:bg-white/5 focus-within:bg-white/5",
                !onLayerChange && "cursor-default opacity-70",
              )}
              htmlFor={id}
              key={layer}
              title={description}
            >
              <input
                checked={enabled}
                className="size-3.5 shrink-0 cursor-pointer accent-dusk-primary disabled:cursor-default"
                disabled={!onLayerChange}
                id={id}
                onChange={onChange(layer)}
                type="checkbox"
              />
              <Icon aria-hidden="true" color={color} size={14} strokeWidth={2} />
              <span className="min-w-0 flex-1 text-xs leading-4 text-dusk-text">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A floating, non-modal map key. Every status has a pictogram and a label so
 * colour never carries meaning on its own. It is intentionally controlled:
 * CityMap owns overlay visibility and can memoise deck.gl layers accordingly.
 */
export function MapLegend({
  statuses = DISPLAY_STATUSES,
  showStatuses = true,
  showLayerControls = true,
  visibility,
  onLayerChange,
  className,
}: MapLegendProps) {
  return (
    <aside
      aria-label="Map legend and layers"
      className={cn(
        "absolute bottom-3 left-3 z-10 w-52 rounded-panel border border-white/10 bg-[rgba(18,25,51,0.78)] p-3 shadow-panel backdrop-blur-glass",
        className,
      )}
      style={{ fontFamily: tokens.font.ui }}
    >
      {showStatuses ? (
        <section aria-label="Building status legend">
          <h2 className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-dusk-muted">
            Floors above shops
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-y-1 p-0">
            {statuses.map((status) => {
              const Icon = STATUS_ICONS[status];
              const color = STATUS_COLORS[status];

              return (
                <li className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-dusk-text" key={status}>
                  <Icon aria-hidden="true" color={color} size={13} strokeWidth={2.25} />
                  <span className="truncate" title={STATUS_LABELS[status]}>
                    {STATUS_LABELS[status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {showStatuses && showLayerControls ? <div className="my-2 border-t border-white/10" /> : null}
      {showLayerControls ? (
        <MapLayerControls onLayerChange={onLayerChange} visibility={visibility} />
      ) : null}
    </aside>
  );
}

export default MapLegend;
