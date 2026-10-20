import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/auth";

export default async function ContentLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className="container py-12">
      {isAdmin(user) && (
        <p className="mb-6 max-w-3xl rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Admin note: policy and programme pages are starting drafts built from your settings. Have them reviewed by a Nigerian lawyer before launch. Only admins see this note.
        </p>
      )}
      {children}
    </div>
  );
}
