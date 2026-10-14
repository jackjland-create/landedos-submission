const defaultOperatorPath = "/projects/helios/overview";

/**
 * Keep post-authentication navigation on this application origin.
 * Public, authentication and protocol-relative targets are never accepted.
 */
export function operatorReturnPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) {
    return defaultOperatorPath;
  }

  if (
    !value.startsWith("/projects/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return defaultOperatorPath;
  }

  try {
    const url = new URL(value, "https://landed.invalid");
    return url.origin === "https://landed.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : defaultOperatorPath;
  } catch {
    return defaultOperatorPath;
  }
}

export function loginPathFor(returnPath: unknown, message: string) {
  const query = new URLSearchParams({
    error: message,
    next: operatorReturnPath(returnPath),
  });

  return `/login?${query.toString()}`;
}
