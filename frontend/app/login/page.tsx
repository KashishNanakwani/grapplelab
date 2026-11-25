import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; next?: string }>;
}) {
  // `message` carries the "check your email" notice after signup. Auth errors are
  // no longer passed via the URL — they live in the form's own state.
  const { message } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <LoginForm message={message} />
    </main>
  );
}
