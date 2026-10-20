"use client";

import { PageError } from "@/components/page-states";

export default function ErrorPage(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <PageError {...props} />;
}
