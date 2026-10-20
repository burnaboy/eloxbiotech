import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export function Alert({ tone = "info", children, className }: { tone?: "info" | "error" | "success"; children: React.ReactNode; className?: string }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex gap-2 rounded-md border p-3 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        tone === "success" && "border-success/30 bg-success/5 text-success",
        tone === "info" && "bg-muted text-foreground",
        className,
      )}
    >
      <Icon aria-hidden />
      <div>{children}</div>
    </div>
  );
}
