import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/users";
import { hashPassword } from "@/lib/auth";
import { resetDb, setPlan } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

const join = (email: string, phone?: string) => registerUser({ name: "Ada Obi", email, phone, password: "password123" });

describe("one account per person", () => {
  it("treats email variations that reach the same inbox as the same email", async () => {
    await join("ada.obi@gmail.com");
    for (const e of ["ADA.OBI@gmail.com", " adaobi@gmail.com ", "a.d.a.o.b.i@googlemail.com", "adaobi+mlm@gmail.com"]) {
      await expect(join(e)).rejects.toThrow(/email address already exists/);
    }
    await join("ada@company.ng");
    await expect(join("ada+second@company.ng")).rejects.toThrow(/email address already exists/);
    // Dots are only ignored for Gmail; elsewhere they make a different mailbox.
    await expect(join("a.da@company.ng")).resolves.toBeTruthy();
  });

  it("treats the same phone written differently as the same phone", async () => {
    await join("first@test.dev", "0803 123 4567");
    for (const p of ["08031234567", "+234 803 123 4567", "2348031234567", "(0803) 123-4567", "8031234567", "002348031234567"]) {
      await expect(join(`x${Math.random()}@test.dev`, p)).rejects.toThrow(/phone number is already linked/);
    }
    await expect(join("second@test.dev", "0803 123 4568")).resolves.toBeTruthy();
    await expect(join("third@test.dev", "")).resolves.toBeTruthy();
    await expect(join("fourth@test.dev")).resolves.toBeTruthy();
  });

  it("rejects phone numbers that are too short or not numbers", async () => {
    await expect(join("short@test.dev", "12345")).rejects.toThrow();
    await expect(join("letters@test.dev", "call me")).rejects.toThrow();
  });

  it("lets only one of two sign-ups at the same moment through", async () => {
    const check = async (attempts: Promise<unknown>[]) => {
      const results = await Promise.allSettled(attempts);
      expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
      for (const r of results) if (r.status === "rejected") expect(String(r.reason?.message)).toMatch(/already/);
    };
    await check([join("race@test.dev"), join("RACE+1@test.dev"), join("race+2@test.dev")]);
    await check([join("p1@test.dev", "08090000000"), join("p2@test.dev", "+2348090000000"), join("p3@test.dev", "8090000000")]);
    expect(await prisma.user.count()).toBe(2);
  });

  it("is enforced by the database for every write, not only the sign-up form", async () => {
    const passwordHash = await hashPassword("x");
    const a = await prisma.user.create({ data: { name: "A", email: "a@test.dev", phone: "0803 000 0000", passwordHash, referralCode: "AAAA0001" } });
    expect(a.emailCanonical).toBe("a@test.dev");
    expect(a.phoneNormalized).toBe("+2348030000000");
    await expect(prisma.user.create({ data: { name: "B", email: "a+b@test.dev", passwordHash, referralCode: "AAAA0002" } })).rejects.toThrow();
    const b = await prisma.user.create({ data: { name: "B", email: "b@test.dev", passwordHash, referralCode: "AAAA0003" } });
    await expect(prisma.user.update({ where: { id: b.id }, data: { phone: "+234 803 000 0000" } })).rejects.toThrow();
    // Changing a phone moves the reservation with it.
    await prisma.user.update({ where: { id: a.id }, data: { phone: "0803 999 9999" } });
    await expect(prisma.user.update({ where: { id: b.id }, data: { phone: "+234 803 000 0000" } })).resolves.toBeTruthy();
  });
});
