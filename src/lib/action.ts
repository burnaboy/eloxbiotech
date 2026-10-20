import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "./errors";

export type ActionState = { error?: string; ok?: string; fieldErrors?: Record<string, string[] | undefined> } | null;

/** Runs a server action body and turns expected failures into a message for the form. */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? null;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { error: e.message };
    if (e instanceof ZodError) {
      const f = e.flatten();
      return { error: f.formErrors[0] ?? "Please check the highlighted fields.", fieldErrors: f.fieldErrors };
    }
    console.error(e);
    return { error: "Something went wrong. Please try again." };
  }
}

export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}
