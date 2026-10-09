import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await isLoggedIn()) redirect("/");
  return (
    <div className="login-wrap">
      <div className="card">
        <h1>Log in</h1>
        <p className="muted small">Enter the shared Pod Talk token.</p>
        <LoginForm />
      </div>
    </div>
  );
}
