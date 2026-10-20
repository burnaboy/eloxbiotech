import Link from "next/link";
import type { Prisma, Role } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Pager } from "@/components/admin/pager";
import { FilterBar } from "@/components/admin/filter-bar";
import { dateWhere, pageOf, parseRange, searchText } from "@/lib/admin-filters";

const ROLES: Role[] = ["CUSTOMER", "AFFILIATE", "ADMIN", "SUPER_ADMIN"];
const PAGE = 50;

export default async function Members({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; page?: string; from?: string; to?: string }> }) {
  await requireAdmin("MEMBERS");
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const q = searchText(sp.q);
  const joined = dateWhere(parseRange(sp.from, sp.to));
  const where: Prisma.UserWhereInput = {
    ...(joined ? { createdAt: joined } : {}),
    ...(ROLES.includes(sp.role as Role) ? { role: sp.role as Role } : {}),
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { referralCode: { contains: q.toUpperCase() } }, { phone: { contains: q } }] } : {}),
  };
  const users = await prisma.user.findMany({ where, include: { sponsor: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
      <FilterBar sp={sp} search={{ placeholder: "Name, email, phone or code" }} exportReport="members">
        <div className="space-y-1">
          <label htmlFor="role" className="block text-xs font-medium text-muted-foreground">Role</label>
          <Select id="role" name="role" defaultValue={sp.role ?? ""} className="w-40">
            <option value="">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ").toLowerCase()}</option>)}
          </Select>
        </div>
      </FilterBar>
      <p className="text-xs text-muted-foreground">Dates filter by join date.</p>
      {users.length === 0 ? <Empty>No members match these filters.</Empty> : (
        <Table>
          <THead><tr><Th>Member</Th><Th>Role</Th><Th>Code</Th><Th>Sponsor</Th><Th>Joined</Th><Th>Status</Th></tr></THead>
          <TBody>
            {users.slice(0, PAGE).map((u) => (
              <tr key={u.id}>
                <Td><Link href={`/admin/users/${u.id}`} className="font-medium text-primary hover:underline">{u.name}</Link><span className="block text-xs text-muted-foreground">{u.email}</span></Td>
                <Td><Badge tone={u.role === "CUSTOMER" ? "neutral" : "primary"}>{u.role.replace("_", " ").toLowerCase()}</Badge></Td>
                <Td>{u.referralCode}</Td>
                <Td>{u.sponsor?.name ?? "—"}</Td>
                <Td>{formatDate(u.createdAt)}</Td>
                <Td><StatusBadge status={u.status} /></Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={users.length > PAGE} params={{ q: sp.q, role: sp.role, from: sp.from, to: sp.to }} />
    </>
  );
}
