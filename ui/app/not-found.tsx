import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Не знайдено</h1>
      <p className="text-sm text-ink-mute">Такої сторінки або бізнеса немає.</p>
      <Link href="/inbox" className="btn-outline no-underline mt-2">
        До Вхідних
      </Link>
    </div>
  );
}
