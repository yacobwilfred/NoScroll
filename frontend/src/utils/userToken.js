const KEY = "noscroll_user_token";

/**
 * When VITE_USE_DEMO_USER=true (production demo deploy), everyone shares one token
 * so seeded friends/collections match. Set VITE_DEMO_USER_TOKEN to the same UUID as
 * DEMO_USER_TOKEN on the API.
 */
export function getUserToken() {
  const useDemo = import.meta.env.VITE_USE_DEMO_USER === "true";
  const demoToken = import.meta.env.VITE_DEMO_USER_TOKEN;
  if (useDemo && demoToken) {
    return demoToken;
  }
  let token = localStorage.getItem(KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(KEY, token);
  }
  return token;
}
