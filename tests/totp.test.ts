import { describe, expect, it } from "vitest";
import { codeAt, currentStep, generateSecret, otpauthUri, verifyCode } from "@/lib/totp";

describe("two-step codes", () => {
  it("matches the RFC 6238 test vector and accepts one step of drift only", () => {
    // RFC 6238 appendix B, SHA-1 secret "12345678901234567890" at T=59s → 94287082 (8 digits); 6 digits → 287082.
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(codeAt(secret, 1)).toBe("287082");
    const now = 1_111_111_109_000;
    const step = currentStep(now);
    expect(verifyCode(secret, codeAt(secret, step), now)).toBe(step);
    expect(verifyCode(secret, codeAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step + 2), now)).toBeNull();
    expect(verifyCode(secret, "12345", now)).toBeNull();
  });
  it("makes 160-bit secrets and a standard otpauth link", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri(s, "ada@example.com", "Binary Commerce")).toMatch(/^otpauth:\/\/totp\/Binary%20Commerce:ada%40example\.com\?.*secret=/);
  });
});
