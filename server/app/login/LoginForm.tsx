"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action}>
      {state?.error && <div className="error">{state.error}</div>}
      <div className="field">
        <label htmlFor="token">Token</label>
        <input id="token" name="token" type="password" autoFocus autoComplete="current-password" required />
      </div>
      <button className="primary" type="submit" disabled={pending}>{pending ? "Signing in..." : "Sign in"}</button>
    </form>
  );
}
