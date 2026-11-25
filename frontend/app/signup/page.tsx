import { SignupForm } from "./signup-form";

export default function SignupPage() {
  // Auth errors live in the form's own state, not the URL.
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SignupForm />
    </main>
  );
}
