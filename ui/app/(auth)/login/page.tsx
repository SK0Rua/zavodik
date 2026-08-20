export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = '/inbox', error } = await searchParams;
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form
        action="/api/auth/login"
        method="post"
        className="card w-full max-w-sm p-6 space-y-4"
      >
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Фабрика</h1>
          <p className="text-sm text-ink-mute mt-1">Панель керування</p>
        </div>

        <input type="hidden" name="next" value={next} />
        <div>
          <label className="label" htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="w-full"
          />
        </div>

        {error && (
          <p className="text-sm text-dot-stop" role="alert">Невірний пароль</p>
        )}

        <button type="submit" className="btn-primary w-full">Увійти</button>
      </form>
    </div>
  );
}
