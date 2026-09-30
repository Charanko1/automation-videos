"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="app" style={{ placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <div className="eyebrow">APPLICATION ERROR</div>
        <h1 className="page-title">Something went wrong</h1>
        <div className="muted">The page could not complete the requested operation.</div>
        <button className="ctrl blue compact" onClick={() => reset()} style={{ margin: "16px auto 0" }}>
          Try again
        </button>
      </div>
    </main>
  );
}
