"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="max-w-xl mx-auto p-10">
      <h1>We couldn’t complete that action.</h1>
      <p className="muted my-5">
        Your existing records are safe. Check your connection and account
        access, then refresh before retrying. If you were approving a proposal,
        check its current version.
      </p>
      <Button onClick={reset}>Try again</Button>
      <Link href="/" className="ml-5 underline">
        Engagements
      </Link>
    </main>
  );
}
