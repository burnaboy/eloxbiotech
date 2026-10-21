"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 11, fill: "rgb(var(--muted-foreground))" };
const grid = "rgb(var(--border))";

export function RevenueChart({ data, currency }: { data: { day: string; revenue: number; commissions: number }[]; currency: string }) {
  const fmt = (v: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, notation: "compact" }).format(v);
  return (
    <div className="h-64" role="img" aria-label="Revenue and commissions over the last 30 days">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={fmt} width={64} />
          <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ background: "rgb(var(--card))", border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12, color: "rgb(var(--foreground))" }} labelStyle={{ color: "rgb(var(--foreground))" }} />
          <Line type="monotone" dataKey="revenue" name="Paid revenue" stroke="rgb(var(--primary))" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="commissions" name="Commissions earned" stroke="rgb(var(--accent))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatusChart({ data }: { data: { status: string; count: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Orders by status">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="status" tick={axis} tickLine={false} axisLine={false} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} width={32} />
          <Tooltip contentStyle={{ background: "rgb(var(--card))", border: `1px solid ${grid}`, borderRadius: 8, fontSize: 12, color: "rgb(var(--foreground))" }} labelStyle={{ color: "rgb(var(--foreground))" }} />
          <Bar dataKey="count" name="Orders" fill="rgb(var(--primary))" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
