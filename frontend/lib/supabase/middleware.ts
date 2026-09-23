import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Route prefixes that require an authenticated user. */
const PROTECTED_PREFIXES = [
  "/profile",
  "/techniques",
  "/review",
  "/quiz",
  "/progress",
  "/coach",
  "/study-plan",
];

/**
 * Refreshes the Supabase auth session on every request and guards protected
 * routes. Called from the root `proxy.ts` (Next.js 16's renamed middleware).
 *
 * IMPORTANT: always return the `supabaseResponse` object as-is so the refreshed
 * auth cookies are propagated to the browser. Do not create a new response
 * without copying its cookies.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser() — it refreshes the
  // session and a stray await can cause hard-to-debug logout bugs.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-in users get their dashboard, not the marketing page. Doing this
  // here rather than in app/page.tsx is what lets "/" stay a static Server
  // Component: `user` is already in hand from the session refresh above.
  // Exact match — startsWith("/") would capture every route in the app.
  //
  // This is the one redirect that fires while a session EXISTS, so getUser()
  // above may have just rotated the refresh token. A bare NextResponse.redirect
  // would drop those Set-Cookie headers and could sign the user out, so copy
  // them across — see the cookie warning in this function's docstring.
  if (user && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/profile";
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
