import LoginForm from "@/app/admin/login/LoginForm";

export const metadata = { title: "Dock crew sign in" };

export default function DockLogin() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-4">
      <div className="w-full max-w-sm">
        <div className="mb-1 text-center text-xl font-bold tracking-wide text-white">PORT A · DOCK</div>
        <div className="mb-6 text-center text-sm text-white/80">Check boats out and in</div>
        <LoginForm next="/dock" />
      </div>
    </div>
  );
}
