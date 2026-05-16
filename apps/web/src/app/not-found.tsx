import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-4 py-24">
      <h1 className="text-xl font-semibold text-foreground">Not found</h1>
      <p className="text-sm text-muted">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link
        href="/"
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-base transition-opacity hover:opacity-90"
      >
        Go home
      </Link>
    </div>
  );
}
