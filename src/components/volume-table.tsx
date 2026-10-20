import type { VolumeSummary } from "@/lib/volume";
import { formatDate } from "@/lib/utils";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";

const fmt = (n: number) => `${n.toLocaleString()} PV`;

/** Lifetime, period, refunded, qualifying and pending volume for one position, from the volume ledger. */
export function VolumeTable({ v }: { v: VolumeSummary }) {
  const rows: { label: string; hint: string; get: (x: VolumeSummary["left"] | (VolumeSummary["personal"] & { qualifyingPv?: number })) => number | null }[] = [
    { label: "Pending", hint: "Paid orders still inside the refund window. Not counted anywhere yet.", get: (x) => x.pendingPv },
    { label: "Credited", hint: "Volume from orders that passed the refund window.", get: (x) => x.creditedPv },
    { label: "Refunded", hint: "Credited volume taken back after a refund or chargeback.", get: (x) => x.reversedPv },
    { label: "Lifetime (net)", hint: "Credited minus refunded.", get: (x) => x.netPv },
    { label: "This period", hint: v.periodStart ? `Net volume credited since the last binary run on ${formatDate(v.periodStart)}.` : "Net volume credited so far (no binary run yet).", get: (x) => x.periodPv },
    { label: "Currently qualifying", hint: "Unpaired volume the next binary run can match.", get: (x) => ("qualifyingPv" in x && x.qualifyingPv !== undefined ? x.qualifyingPv : null) },
  ];
  return (
    <Table>
      <THead><tr><Th>Volume</Th><Th className="text-right">Personal</Th><Th className="text-right">Left</Th><Th className="text-right">Right</Th></tr></THead>
      <TBody>
        {rows.map((r) => (
          <tr key={r.label}>
            <Td><span className="font-medium">{r.label}</span><span className="block text-xs text-muted-foreground">{r.hint}</span></Td>
            {[v.personal, v.left, v.right].map((x, i) => {
              const val = r.get(x);
              return <Td key={i} className="text-right tabular-nums">{val === null ? "—" : fmt(val)}</Td>;
            })}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
