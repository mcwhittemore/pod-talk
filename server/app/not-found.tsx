import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty">
      <h1>Not found</h1>
      <Link href="/">Back to the queue</Link>
    </div>
  );
}
