import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app" style={{ placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        <div className="eyebrow">404</div>
        <h1 className="page-title">Page not found</h1>
        <div className="muted">The requested workspace page does not exist.</div>
        <Link href="/" className="ctrl blue compact" style={{ textDecoration: "none", margin: "16px auto 0" }}>
          Back to Office
        </Link>
      </div>
    </main>
  );
}
