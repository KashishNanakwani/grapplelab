/**
 * Shared auth validation + error-mapping helpers.
 *
 * Plain module (no "use client"/"use server" directive) so it can be imported by
 * both the client forms (instant inline feedback) and the server actions
 * (defense in depth — never trust the client). Keep messages friendly and in the
 * app's own voice; never surface raw Supabase strings to users.
 */

/** Minimum password length. Deliberately simple — no character-class rules. */
export const PASSWORD_MIN_LENGTH = 8;

/** Single source of truth for the password rule wording (helper text + error). */
export const PASSWORD_REQUIREMENT = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;

const EMAIL_INVALID = "Enter a valid email address.";

/**
 * Requires local@domain.tld with no spaces, exactly one @, and a real TLD of 2+
 * characters. Rejects "kashish@gmail" (no TLD), missing @, missing domain,
 * spaces, and double @ (the middle segment can't contain another @). Accepts any
 * TLD (.com, .edu, .io, …).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Returns a friendly message if the email is invalid, else null. */
export function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Enter your email address.";
  return EMAIL_PATTERN.test(trimmed) ? null : EMAIL_INVALID;
}

/**
 * Signup password rule: at least PASSWORD_MIN_LENGTH characters and not
 * whitespace-only. Does NOT trim the value used for auth — spaces can be a valid
 * part of a password — it only checks that the password isn't entirely spaces.
 */
export function validatePassword(password: string): string | null {
  if (password.trim() === "") return "Password can't be empty or only spaces.";
  if (password.length < PASSWORD_MIN_LENGTH) return PASSWORD_REQUIREMENT;
  return null;
}

/** Login only needs a non-empty password; Supabase verifies the rest. */
export function validateLoginPassword(password: string): string | null {
  return password.length === 0 ? "Enter your password." : null;
}

/**
 * Translates a raw Supabase auth error into friendly, user-facing copy.
 *
 * The default is intentionally generic so login never reveals whether an email
 * is registered (email-enumeration protection). Matching is done on lowercased
 * substrings because Supabase's exact wording can change.
 */
export function friendlyAuthError(raw: string): string {
  const message = raw.toLowerCase();

  if (message.includes("rate limit") || message.includes("too many")) {
    return "Too many attempts. Please wait a minute and try again.";
  }
  if (
    message.includes("at least 6 characters") ||
    message.includes("lengthen") ||
    message.includes("password should be")
  ) {
    return PASSWORD_REQUIREMENT;
  }
  if (message.includes("invalid format") || message.includes("invalid email")) {
    return EMAIL_INVALID;
  }
  if (message.includes("email not confirmed")) {
    return "Please confirm your email first — check your inbox for the link.";
  }
  if (message.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }

  // Generic fallback: say nothing that reveals account existence or internals.
  return "Something went wrong. Please try again.";
}
